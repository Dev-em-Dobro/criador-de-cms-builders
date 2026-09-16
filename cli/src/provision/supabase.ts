// @cms-core/cli — adapter Supabase (S4.3, §7.3 passos 1/1a-1e; §13.3 auth-only).
//
// Responsabilidades:
//   • criar projeto via Management API (org, region, plano, db password gerada)
//   • poll status até ACTIVE_HEALTHY
//   • coletar api-keys (publishable/anon + service_role/secret)
//   • montar DATABASE_URL/DIRECT_URL (SÓ no papel content-and-auth)
//   • configurar SMTP com a RESEND_API_KEY
//   • MODO AUTH-ONLY (§13.3): NÃO monta URLs de conteúdo — só auth keys + SMTP.
//
// Idempotência (§7.5): procura o projeto pelo nome determinístico antes de criar
//   (papel content-and-auth → `<slug>-cms`; papel auth-only → `<slug>-auth`).
//
// HTTP injetável — testado com FakeHttpClient sem token.

import { adminOrigin, buildAuthHardening, buildAuthEmailTemplates } from "./auth-config.js";
import { resourceName } from "./types.js";
import type { ProviderAdapter, ProvisionCtx, SupabaseRole } from "./types.js";
import { HttpError } from "./http.js";
import type { HttpClient } from "./http.js";
import { pollUntil } from "./poll.js";

const API = "https://api.supabase.com";

interface SupabaseProject {
  id: string; // project-ref
  name: string;
  status: string;
  region?: string;
}

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function findProjectByName(
  http: HttpClient,
  token: string,
  name: string,
): Promise<SupabaseProject | undefined> {
  const res = await http.request({
    method: "GET",
    url: `${API}/v1/projects`,
    headers: authHeaders(token),
  });
  if (res.status >= 400) {
    throw new HttpError(`Supabase list projects falhou (${res.status})`, res.status, res.body);
  }
  const list = Array.isArray(res.body) ? (res.body as SupabaseProject[]) : [];
  return list.find((p) => p.name === name);
}

export function createSupabaseAdapter(role: SupabaseRole): ProviderAdapter {
  const label = role === "auth-only" ? "Supabase (auth-only)" : "Supabase (conteúdo+auth)";
  const stateKey = role === "auth-only" ? "supabase-auth" : "supabase";

  return {
    id: "supabase",
    label,
    async ensure(ctx: ProvisionCtx): Promise<void> {
      const { config, http, tokens, vault, state, env, log } = ctx;
      const name = resourceName(config.slug, role);
      const token = tokens.supabaseAccessToken;
      const region = config.providers.auth.region;
      const plan = config.providers.auth.plan ?? "free";

      if (ctx.dryRun) {
        log.plan(`${label}: procurar projeto "${name}"; se ausente, criar (region=${region}, plan=${plan}).`);
        log.plan(`${label}: poll até ACTIVE_HEALTHY; coletar anon + service_role keys.`);
        if (role !== "auth-only")
          log.plan(`${label}: montar DATABASE_URL/DIRECT_URL a partir do project-ref + db password (CSPRNG).`);
        log.plan(
          `${label}: endurecer auth (site_url=${adminOrigin(config)}, cadastro fechado, senha mín. 12).`,
        );
        log.plan(`${label}: configurar SMTP com RESEND_API_KEY.`);
        log.plan(`${label}: gravar templates de convite/recuperação (token_hash) — depois do SMTP.`);
        state.resources[stateKey] = { status: "pending", name };
        return;
      }

      if (!token) throw new Error("Supabase: SUPABASE_ACCESS_TOKEN ausente (rode o preflight).");

      // 1a. idempotência: procurar por nome determinístico.
      let project = await findProjectByName(http, token, name);
      let createdThisRun = false;

      if (!project) {
        const dbPassword = vault.ensureGenerated("supabaseDbPassword", 24);
        const res = await http.request({
          method: "POST",
          url: `${API}/v1/projects`,
          headers: authHeaders(token),
          body: {
            name,
            organization_id: tokens.supabaseOrgId,
            region,
            plan,
            db_pass: dbPassword,
          },
        });
        if (res.status >= 400) {
          throw new HttpError(`Supabase criar projeto falhou (${res.status})`, res.status, res.body);
        }
        project = res.body as SupabaseProject;
        createdThisRun = true;
        log.info(`${label}: projeto "${name}" criado (ref=${project.id}).`);
      } else {
        log.info(`${label}: projeto "${name}" já existe (ref=${project.id}) — reconciliando.`);
      }

      // 1b. poll até ACTIVE_HEALTHY.
      const ref = project.id;
      await pollUntil(
        async () => {
          const st = await http.request({
            method: "GET",
            url: `${API}/v1/projects/${ref}`,
            headers: authHeaders(token),
          });
          const p = st.body as SupabaseProject;
          return p?.status === "ACTIVE_HEALTHY" ? p : null;
        },
        { maxPolls: ctx.maxPolls ?? 40, intervalMs: ctx.pollIntervalMs ?? 3000 },
        (n) => log.info(`${label}: aguardando ACTIVE_HEALTHY (poll ${n})…`),
      );

      // 1c. coletar api-keys.
      const keysRes = await http.request({
        method: "GET",
        url: `${API}/v1/projects/${ref}/api-keys`,
        headers: authHeaders(token),
      });
      if (keysRes.status >= 400) {
        throw new HttpError(`Supabase api-keys falhou (${keysRes.status})`, keysRes.status, keysRes.body);
      }
      const keys = (Array.isArray(keysRes.body) ? keysRes.body : []) as Array<{
        name: string;
        api_key: string;
      }>;
      const anon = keys.find((k) => k.name === "anon")?.api_key;
      const serviceRole = keys.find((k) => k.name === "service_role")?.api_key;
      if (anon) vault.set("supabasePublishableKey", anon);
      if (serviceRole) vault.set("supabaseServiceRoleKey", serviceRole);

      // envs de auth (comuns aos dois papéis).
      env.supabaseUrl = `https://${ref}.supabase.co`;
      env.supabaseAuthProjectRef = ref;

      // 1d. URLs de CONTEÚDO — só no papel content-and-auth (§13.3: auth-only NÃO monta).
      if (role !== "auth-only") {
        env.supabaseProjectRef = ref;
      }

      // 1e. endurecimento de Auth — não depende de e-mail, então roda sempre.
      // Fecha o cadastro público e corrige o `site_url`, que num projeto novo
      // aponta para `http://localhost:3000` e mandaria o cliente para o
      // localhost dele ao clicar no link de recuperação.
      const hardening = await http.request({
        method: "PATCH",
        url: `${API}/v1/projects/${ref}/config/auth`,
        headers: authHeaders(token),
        body: buildAuthHardening(config),
      });
      if (hardening.status >= 400) {
        throw new HttpError(
          `Supabase endurecimento de auth falhou (${hardening.status})`,
          hardening.status,
          hardening.body,
        );
      }

      // 1f. SMTP com Resend (best-effort; a chave Resend é de conta).
      //
      // O remetente é `noreply@<senderDomain>` — o domínio verificado no Resend
      // pelo adapter de e-mail. Usar o endereço do seed admin (como era antes)
      // manda de um domínio que o Resend não conhece, e o envio é recusado.
      if (tokens.resendApiKey) {
        const smtp = await http.request({
          method: "PATCH",
          url: `${API}/v1/projects/${ref}/config/auth`,
          headers: authHeaders(token),
          body: {
            smtp_admin_email: `noreply@${config.providers.email.senderDomain}`,
            smtp_host: "smtp.resend.com",
            smtp_pass: tokens.resendApiKey,
            smtp_user: "resend",
            smtp_sender_name: config.providers.email.fromName ?? config.displayName,
            // O default do provedor embutido é 2/hora NO PROJETO INTEIRO: a
            // terceira tentativa de reset seguida não sairia.
            rate_limit_email_sent: 30,
          },
        });
        if (smtp.status >= 400) {
          throw new HttpError(`Supabase SMTP falhou (${smtp.status})`, smtp.status, smtp.body);
        }

        // 1g. templates — SÓ depois do SMTP: no Free, `mailer_*` é recusado
        // enquanto o projeto usa o provedor de e-mail padrão. Sem este passo o
        // convite e a recuperação de senha chegam e NÃO funcionam (o link volta
        // para a tela de login) — ver auth-config.ts.
        const tpl = await http.request({
          method: "PATCH",
          url: `${API}/v1/projects/${ref}/config/auth`,
          headers: authHeaders(token),
          body: buildAuthEmailTemplates(config),
        });
        if (tpl.status >= 400) {
          throw new HttpError(
            `Supabase templates de e-mail falharam (${tpl.status})`,
            tpl.status,
            tpl.body,
          );
        }
      } else {
        log.warn(
          `${label}: sem RESEND_API_KEY — SMTP e templates não configurados. ` +
            `Convite e recuperação de senha vão CHEGAR mas o link cairá no login.`,
        );
      }

      state.resources[stateKey] = {
        status: "verified",
        externalId: ref,
        name,
        createdThisRun,
        createdAt: new Date().toISOString(),
        meta: { role },
      };
      log.info(`${label}: verificado (ref=${ref}).`);
    },

    async rollback(ctx: ProvisionCtx): Promise<void> {
      const { http, tokens, state, log } = ctx;
      const r = state.resources[stateKey];
      if (!r?.createdThisRun || !r.externalId) {
        log.info(`${label}: nada a reverter (não criado nesta run).`);
        return;
      }
      if (ctx.dryRun) {
        log.plan(`${label}: DELETE projeto ${r.externalId} (só criado nesta run).`);
        return;
      }
      const token = tokens.supabaseAccessToken;
      if (!token) {
        log.warn(`${label}: ÓRFÃO — projeto ${r.externalId} não removido (sem token). Limpar à mão.`);
        return;
      }
      const res = await http.request({
        method: "DELETE",
        url: `${API}/v1/projects/${r.externalId}`,
        headers: authHeaders(token),
      });
      if (res.status >= 400) {
        log.warn(`${label}: ÓRFÃO — falha ao deletar projeto ${r.externalId} (${res.status}). Limpar à mão.`);
        return;
      }
      log.info(`${label}: projeto ${r.externalId} revertido.`);
    },
  };
}
