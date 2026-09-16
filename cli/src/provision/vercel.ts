// @cms-core/cli — adapter Vercel (S4.6, §7.3 passo 4).
//
//   4a. POST /v9/projects → criar projeto (framework nextjs, teamSlug) COM
//       rootDirectory = "clients/<slug>" (D1 monorepo — o único passo que o
//       monorepo muda; §7.3 nota)
//   4b. POST /v10/projects/{id}/env → gravar TODAS as envs (conteúdo do Neon OU
//       Supabase; auth do Supabase; + secrets gerados)
//   4c. POST /v10/projects/{id}/domains → apontar adminSubdomain
//   4d. deploy
//
// A montagem de DATABASE_URL/DIRECT_URL REUSA `buildDbUrls` do gen-env (D5) —
// não reescreve a lógica de connection string. Os secrets vêm do vault; o
// project-ref/host vêm do CollectedEnv preenchido pelos adapters de banco.
// HTTP injetável — testado com FakeHttpClient sem token.

import type { ProviderAdapter, ProvisionCtx } from "./types.js";
import { HttpError } from "./http.js";
import type { HttpClient } from "./http.js";
import { buildDbUrls, type EnvSecrets } from "../codegen/gen-env.js";
import { resourceName } from "./types.js";

const API = "https://api.vercel.com";

interface VercelProject {
  id: string;
  name: string;
}

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function teamQuery(teamId?: string): string {
  return teamId ? `?teamId=${teamId}` : "";
}

/**
 * Monta o conjunto completo de envs do projeto Vercel a partir do CollectedEnv +
 * vault. Reusa `buildDbUrls` (D5) para DATABASE_URL/DIRECT_URL. Retorna pares
 * {key,value,type} prontos p/ a env API. NÃO loga valores (secrets).
 */
export function buildVercelEnv(ctx: ProvisionCtx): Array<{ key: string; value: string; type: "encrypted" | "plain" }> {
  const { config, env, vault } = ctx;
  // secrets p/ o buildDbUrls: no caso neon o host/user vêm do Neon; no caso
  // supabase o project-ref vem do Supabase de conteúdo. A senha vem do vault.
  const secrets: EnvSecrets = {
    dbPassword:
      config.providers.database.kind === "neon"
        ? vault.get("neonPassword")
        : vault.get("supabaseDbPassword"),
    supabaseProjectRef: env.supabaseProjectRef,
    neonHost: env.neonHost,
    neonDbName: env.neonDbName,
    neonUser: env.neonUser,
    supabaseUrl: env.supabaseUrl,
    supabasePublishableKey: vault.get("supabasePublishableKey"),
    supabaseServiceRoleKey: vault.get("supabaseServiceRoleKey"),
    bunnyStorageKey: vault.get("bunnyStorageKey"),
    resendApiKey: ctx.tokens.resendApiKey,
    readApiKey: vault.ensureGenerated("readApiKey"),
    webhookSigningKey: vault.ensureGenerated("webhookSigningKey"),
    previewTokenSecret: vault.ensureGenerated("previewTokenSecret"),
  };
  const { databaseUrl, directUrl } = buildDbUrls(config, secrets);
  const media = config.providers.media;

  const encrypted = (key: string, value: string | undefined): { key: string; value: string; type: "encrypted" } => ({
    key,
    value: value ?? "",
    type: "encrypted",
  });
  const plain = (key: string, value: string): { key: string; value: string; type: "plain" } => ({
    key,
    value,
    type: "plain",
  });

  /**
   * Variáveis de mídia por provedor (storage plugável). Com Vercel Blob a
   * própria plataforma injeta `BLOB_READ_WRITE_TOKEN` quando o store está
   * ligado ao projeto, então não há nada a enviar daqui — criar o store é o
   * passo que falta automatizar (hoje é manual no dashboard).
   */
  const mediaEnv =
    media.provider === "bunny"
      ? [
          plain("BUNNY_STORAGE_ZONE", media.storageZone),
          plain("BUNNY_CDN_URL", env.bunnyCdnUrl ?? media.cdnUrl),
          encrypted("BUNNY_STORAGE_KEY", secrets.bunnyStorageKey),
        ]
      : [];

  return [
    encrypted("DATABASE_URL", databaseUrl),
    encrypted("DIRECT_URL", directUrl),
    plain("NEXT_PUBLIC_SUPABASE_URL", env.supabaseUrl ?? ""),
    encrypted("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", secrets.supabasePublishableKey),
    encrypted("SUPABASE_SERVICE_ROLE_KEY", secrets.supabaseServiceRoleKey),
    ...mediaEnv,
    encrypted("RESEND_API_KEY", secrets.resendApiKey),
    plain("SITE_URL", config.domains.siteUrl),
    encrypted("READ_API_KEY", secrets.readApiKey),
    encrypted("WEBHOOK_SIGNING_KEY", secrets.webhookSigningKey),
    encrypted("PREVIEW_TOKEN_SECRET", secrets.previewTokenSecret),
  ];
}

async function findProjectByName(
  http: HttpClient,
  token: string,
  name: string,
  teamId?: string,
): Promise<VercelProject | undefined> {
  const res = await http.request({
    method: "GET",
    url: `${API}/v9/projects/${name}${teamQuery(teamId)}`,
    headers: authHeaders(token),
  });
  if (res.status === 404) return undefined;
  if (res.status >= 400) {
    throw new HttpError(`Vercel get project falhou (${res.status})`, res.status, res.body);
  }
  return res.body as VercelProject;
}

export function createVercelAdapter(): ProviderAdapter {
  return {
    id: "vercel",
    label: "Vercel (deploy)",
    async ensure(ctx: ProvisionCtx): Promise<void> {
      const { config, http, tokens, state, env, log } = ctx;
      const name = resourceName(config.slug, "vercel"); // `<slug>-cms`
      const rootDirectory = `clients/${config.slug}`;
      const teamId = tokens.vercelTeamId;

      if (ctx.dryRun) {
        log.plan(`Vercel: procurar projeto "${name}"; se ausente, criar (nextjs, rootDirectory=${rootDirectory}).`);
        log.plan(`Vercel: gravar ${buildVercelEnv(ctx).length} envs (conteúdo do ${config.providers.database.kind}; auth do Supabase).`);
        log.plan(`Vercel: apontar domínio ${config.domains.adminSubdomain}; deploy.`);
        state.resources.vercel = { status: "pending", name };
        return;
      }

      const token = tokens.vercelToken;
      if (!token) throw new Error("Vercel: VERCEL_TOKEN ausente (rode o preflight).");

      // 4a. projeto (idempotente por nome).
      let project = await findProjectByName(http, token, name, teamId);
      let createdThisRun = false;
      if (!project) {
        const res = await http.request({
          method: "POST",
          url: `${API}/v9/projects${teamQuery(teamId)}`,
          headers: authHeaders(token),
          body: { name, framework: "nextjs", rootDirectory },
        });
        if (res.status >= 400) {
          throw new HttpError(`Vercel criar projeto falhou (${res.status})`, res.status, res.body);
        }
        project = res.body as VercelProject;
        createdThisRun = true;
        log.info(`Vercel: projeto "${name}" criado (id=${project.id}).`);
      } else {
        log.info(`Vercel: projeto "${name}" já existe (id=${project.id}) — reconciliando.`);
      }

      // 4b. envs.
      const envs = buildVercelEnv(ctx);
      const envRes = await http.request({
        method: "POST",
        url: `${API}/v10/projects/${project.id}/env${teamQuery(teamId)}`,
        headers: authHeaders(token),
        body: envs.map((e) => ({ key: e.key, value: e.value, type: e.type, target: ["production", "preview"] })),
      });
      if (envRes.status >= 400) {
        throw new HttpError(`Vercel gravar envs falhou (${envRes.status})`, envRes.status, envRes.body);
      }
      log.info(`Vercel: ${envs.length} envs gravadas.`);

      // 4c. domínio.
      await http.request({
        method: "POST",
        url: `${API}/v10/projects/${project.id}/domains${teamQuery(teamId)}`,
        headers: authHeaders(token),
        body: { name: config.domains.adminSubdomain },
      });

      // 4d. deploy.
      const deployRes = await http.request({
        method: "POST",
        url: `${API}/v13/deployments${teamQuery(teamId)}`,
        headers: authHeaders(token),
        body: { name, project: project.id, target: "production", gitSource: { rootDirectory } },
      });
      const deploy = deployRes.body as { url?: string };
      if (deploy?.url) env.vercelDeploymentUrl = deploy.url;

      env.vercelProjectId = project.id;
      state.resources.vercel = {
        status: "verified",
        externalId: project.id,
        name,
        createdThisRun,
        createdAt: new Date().toISOString(),
        meta: env.vercelDeploymentUrl ? { deploymentUrl: env.vercelDeploymentUrl } : undefined,
      };
      log.info(`Vercel: verificado (id=${project.id}).`);
    },

    async rollback(ctx: ProvisionCtx): Promise<void> {
      const { http, tokens, state, log } = ctx;
      const r = state.resources.vercel;
      if (!r?.createdThisRun || !r.externalId) {
        log.info("Vercel: nada a reverter (não criado nesta run).");
        return;
      }
      if (ctx.dryRun) {
        log.plan(`Vercel: DELETE projeto ${r.externalId} (só criado nesta run).`);
        return;
      }
      const token = tokens.vercelToken;
      if (!token) {
        log.warn(`Vercel: ÓRFÃO — projeto ${r.externalId} não removido (sem token). Limpar à mão.`);
        return;
      }
      const res = await http.request({
        method: "DELETE",
        url: `${API}/v9/projects/${r.externalId}${teamQuery(tokens.vercelTeamId)}`,
        headers: authHeaders(token),
      });
      if (res.status >= 400) {
        log.warn(`Vercel: ÓRFÃO — falha ao deletar projeto ${r.externalId} (${res.status}). Limpar à mão.`);
        return;
      }
      log.info(`Vercel: projeto ${r.externalId} revertido.`);
    },
  };
}
