// @cms-core/cli — adapter Neon (S4.10 / D5, §7.3 passo 0, §13.3).
//
// ensure(ctx):
//   (a) procura projeto Neon determinístico `<slug>-content` (idempotência)
//   (b) se não existe, POST cria projeto (region, plano)
//   (c) seleciona/cria a branch (`main` por default)
//   (d) GET connection URIs → grava host base p/ o gen-env montar
//       DATABASE_URL (endpoint `-pooler`) e DIRECT_URL (direto), ambos sslmode=require
//   (e) grava no state { status, projectId, branchId } — NUNCA a URI com senha
// rollback(ctx): DELETE do projeto Neon criado nesta run (nunca reconciliado).
//
// Neon fica ACTIVE quase instantâneo (sem o poll de ~2 min do Supabase).
// HTTP injetável — testado com FakeHttpClient sem token.

import { resourceName } from "./types.js";
import type { ProviderAdapter, ProvisionCtx } from "./types.js";
import { HttpError } from "./http.js";
import type { HttpClient } from "./http.js";

const API = "https://console.neon.tech/api/v2";

interface NeonProject {
  id: string;
  name: string;
}

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function findProjectByName(
  http: HttpClient,
  token: string,
  name: string,
): Promise<NeonProject | undefined> {
  const res = await http.request({
    method: "GET",
    url: `${API}/projects`,
    headers: authHeaders(token),
  });
  if (res.status >= 400) {
    throw new HttpError(`Neon list projects falhou (${res.status})`, res.status, res.body);
  }
  const body = res.body as { projects?: NeonProject[] };
  return (body.projects ?? []).find((p) => p.name === name);
}

export function createNeonAdapter(): ProviderAdapter {
  return {
    id: "neon",
    label: "Neon (conteúdo)",
    async ensure(ctx: ProvisionCtx): Promise<void> {
      const { config, http, tokens, vault, state, env, log } = ctx;
      if (config.providers.database.kind !== "neon") {
        // guarda: nunca deveria ser composto no caso supabase.
        return;
      }
      const db = config.providers.database;
      const name = resourceName(config.slug, "neon"); // `<slug>-content`
      const branch = db.branch ?? "main";

      if (ctx.dryRun) {
        log.plan(`Neon: procurar projeto "${name}"; se ausente, criar (region=${db.region}, plan=${db.plan ?? "free"}).`);
        log.plan(`Neon: selecionar/criar branch "${branch}".`);
        log.plan(`Neon: GET connection URIs → montar DATABASE_URL (-pooler) e DIRECT_URL (direto), sslmode=require.`);
        state.resources.neon = { status: "pending", name };
        return;
      }

      const token = tokens.neonApiKey;
      if (!token) throw new Error("Neon: NEON_API_KEY ausente (rode o preflight).");

      // (a) idempotência por nome.
      let project = await findProjectByName(http, token, name);
      let createdThisRun = false;
      let branchId: string | undefined;

      if (!project) {
        // (b) criar projeto.
        const res = await http.request({
          method: "POST",
          url: `${API}/projects`,
          headers: authHeaders(token),
          body: {
            project: {
              name,
              region_id: db.region,
              org_id: tokens.neonOrgId,
              branch: { name: branch },
            },
          },
        });
        if (res.status >= 400) {
          throw new HttpError(`Neon criar projeto falhou (${res.status})`, res.status, res.body);
        }
        const created = res.body as {
          project: NeonProject;
          branch?: { id: string };
          connection_uris?: Array<{ connection_uri: string; connection_parameters?: { host?: string; database?: string; role?: string; password?: string } }>;
        };
        project = created.project;
        branchId = created.branch?.id;
        createdThisRun = true;
        // (d) coletar URIs do payload de criação.
        const cp = created.connection_uris?.[0]?.connection_parameters;
        if (cp?.host) env.neonHost = cp.host;
        if (cp?.database) env.neonDbName = cp.database;
        if (cp?.role) env.neonUser = cp.role;
        if (cp?.password) vault.set("neonPassword", cp.password);
        log.info(`Neon: projeto "${name}" criado (id=${project.id}).`);
      } else {
        log.info(`Neon: projeto "${name}" já existe (id=${project.id}) — reconciliando.`);
        // (c) obter branch + (d) connection URI via GET.
        const uriRes = await http.request({
          method: "GET",
          url: `${API}/projects/${project.id}/connection_uri?branch_name=${branch}&pooled=false`,
          headers: authHeaders(token),
        });
        const parsed = uriRes.body as {
          uri?: string;
          connection_parameters?: { host?: string; database?: string; role?: string; password?: string };
        };
        const cp = parsed.connection_parameters;
        if (cp?.host) env.neonHost = cp.host;
        if (cp?.database) env.neonDbName = cp.database;
        if (cp?.role) env.neonUser = cp.role;
        if (cp?.password) vault.set("neonPassword", cp.password);
      }

      env.neonProjectId = project.id;
      if (branchId) env.neonBranchId = branchId;

      state.resources.neon = {
        status: "verified",
        externalId: project.id,
        name,
        createdThisRun,
        createdAt: new Date().toISOString(),
        meta: branchId ? { branchId } : undefined,
      };
      log.info(`Neon: verificado (id=${project.id}).`);
    },

    async rollback(ctx: ProvisionCtx): Promise<void> {
      const { http, tokens, state, log } = ctx;
      const r = state.resources.neon;
      if (!r?.createdThisRun || !r.externalId) {
        log.info("Neon: nada a reverter (não criado nesta run).");
        return;
      }
      if (ctx.dryRun) {
        log.plan(`Neon: DELETE projeto ${r.externalId} (só criado nesta run).`);
        return;
      }
      const token = tokens.neonApiKey;
      if (!token) {
        log.warn(`Neon: ÓRFÃO — projeto ${r.externalId} não removido (sem token). Limpar à mão.`);
        return;
      }
      const res = await http.request({
        method: "DELETE",
        url: `${API}/projects/${r.externalId}`,
        headers: authHeaders(token),
      });
      if (res.status >= 400) {
        log.warn(`Neon: ÓRFÃO — falha ao deletar projeto ${r.externalId} (${res.status}). Limpar à mão.`);
        return;
      }
      log.info(`Neon: projeto ${r.externalId} revertido.`);
    },
  };
}
