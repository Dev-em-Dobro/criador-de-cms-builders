// @cms-core/cli — adapter Resend (S4.5, §7.3 passo 3).
//
//   3a. POST /domains → registrar senderDomain → retorna registros DKIM/SPF
//   3b. (semi-manual) publicar os registros DNS no provedor do cliente
//   3c. poll GET /domains/{id} até status "verified" (pode exigir intervenção)
//   3d. a RESEND_API_KEY é de conta (a sua), reusada — não criada por cliente
//
// A verificação de DNS é semi-manual: no poll, se não verificar dentro do limite,
// o adapter emite as instruções de DNS e marca o recurso como `created` (não
// `verified`) para que `--resume` retome depois que o DNS propagar — em vez de
// falhar "duro" e disparar rollback por causa de propagação de DNS pendente.
// HTTP injetável — testado com FakeHttpClient sem token.

import type { ProviderAdapter, ProvisionCtx } from "./types.js";
import { HttpError } from "./http.js";
import type { HttpClient } from "./http.js";

const API = "https://api.resend.com";

interface ResendDomain {
  id: string;
  name: string;
  status: string;
  records?: Array<{ record: string; name: string; type: string; value: string }>;
}

function authHeaders(key: string): Record<string, string> {
  return { authorization: `Bearer ${key}` };
}

async function findDomainByName(
  http: HttpClient,
  key: string,
  name: string,
): Promise<ResendDomain | undefined> {
  const res = await http.request({
    method: "GET",
    url: `${API}/domains`,
    headers: authHeaders(key),
  });
  if (res.status >= 400) {
    throw new HttpError(`Resend list domains falhou (${res.status})`, res.status, res.body);
  }
  const body = res.body as { data?: ResendDomain[] };
  return (body.data ?? []).find((d) => d.name === name);
}

function emitDnsInstructions(
  records: ResendDomain["records"],
  log: ProvisionCtx["log"],
): void {
  if (!records?.length) return;
  log.info("Resend: publique estes registros DNS no provedor do domínio do cliente:");
  for (const r of records) {
    log.info(`  ${r.type}  ${r.name}  →  ${r.value}`);
  }
}

export function createResendAdapter(): ProviderAdapter {
  return {
    id: "resend",
    label: "Resend (email)",
    async ensure(ctx: ProvisionCtx): Promise<void> {
      const { config, http, tokens, state, env, log } = ctx;
      const domain = config.providers.email.senderDomain;

      if (ctx.dryRun) {
        log.plan(`Resend: procurar domínio "${domain}"; se ausente, registrar → DKIM/SPF.`);
        log.plan(`Resend: emitir instruções DNS; poll até "verified" (semi-manual).`);
        state.resources.resend = { status: "pending", name: domain };
        return;
      }

      const key = tokens.resendApiKey;
      if (!key) throw new Error("Resend: RESEND_API_KEY ausente (rode o preflight).");

      // 3a. registrar (idempotente por nome).
      let dom = await findDomainByName(http, key, domain);
      let createdThisRun = false;
      if (!dom) {
        const res = await http.request({
          method: "POST",
          url: `${API}/domains`,
          headers: authHeaders(key),
          body: { name: domain },
        });
        if (res.status >= 400) {
          throw new HttpError(`Resend registrar domínio falhou (${res.status})`, res.status, res.body);
        }
        dom = res.body as ResendDomain;
        createdThisRun = true;
        log.info(`Resend: domínio "${domain}" registrado (id=${dom.id}).`);
      } else {
        log.info(`Resend: domínio "${domain}" já registrado (id=${dom.id}, status=${dom.status}).`);
      }

      env.resendDomainId = dom.id;
      emitDnsInstructions(dom.records, log);

      // 3c. poll até verified (best-effort). Não falha "duro" por DNS pendente.
      const maxPolls = ctx.maxPolls ?? 3;
      const intervalMs = ctx.pollIntervalMs ?? 5000;
      let verified = dom.status === "verified";
      for (let attempt = 1; attempt <= maxPolls && !verified; attempt++) {
        // dispara a verificação, depois consulta.
        await http.request({
          method: "POST",
          url: `${API}/domains/${dom.id}/verify`,
          headers: authHeaders(key),
        });
        const st = await http.request({
          method: "GET",
          url: `${API}/domains/${dom.id}`,
          headers: authHeaders(key),
        });
        const cur = st.body as ResendDomain;
        env.resendDomainStatus = cur?.status;
        if (cur?.status === "verified") verified = true;
        else if (attempt < maxPolls && intervalMs > 0) {
          await new Promise((r) => setTimeout(r, intervalMs));
        }
      }

      state.resources.resend = {
        status: verified ? "verified" : "created",
        externalId: dom.id,
        name: domain,
        createdThisRun,
        createdAt: new Date().toISOString(),
        meta: { status: env.resendDomainStatus ?? dom.status },
      };
      if (verified) {
        log.info(`Resend: domínio "${domain}" verificado.`);
      } else {
        log.warn(
          `Resend: domínio "${domain}" ainda não verificado (DNS pode não ter propagado). ` +
            `Publique os registros e retome com --resume.`,
        );
      }
    },

    async rollback(ctx: ProvisionCtx): Promise<void> {
      const { http, tokens, state, log } = ctx;
      const r = state.resources.resend;
      if (!r?.createdThisRun || !r.externalId) {
        log.info("Resend: nada a reverter (não criado nesta run).");
        return;
      }
      if (ctx.dryRun) {
        log.plan(`Resend: DELETE domínio ${r.externalId} (só criado nesta run).`);
        return;
      }
      const key = tokens.resendApiKey;
      if (!key) {
        log.warn(`Resend: ÓRFÃO — domínio ${r.externalId} não removido (sem key). Limpar à mão.`);
        return;
      }
      const res = await http.request({
        method: "DELETE",
        url: `${API}/domains/${r.externalId}`,
        headers: authHeaders(key),
      });
      if (res.status >= 400) {
        log.warn(`Resend: ÓRFÃO — falha ao deletar domínio ${r.externalId} (${res.status}). Limpar à mão.`);
        return;
      }
      log.info(`Resend: domínio ${r.externalId} revertido.`);
    },
  };
}
