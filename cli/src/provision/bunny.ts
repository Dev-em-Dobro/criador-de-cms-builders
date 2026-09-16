// @cms-core/cli — adapter Bunny.net (S4.4, §7.3 passo 2).
//
//   2a. POST Storage API → criar Storage Zone → obtém zone id + password
//       (BUNNY_STORAGE_KEY)
//   2b. POST → criar Pull Zone apontando p/ a Storage Zone → obtém hostname
//       .b-cdn.net (BUNNY_CDN_URL)
//
// O nome da storage zone vem do config (`providers.media.storageZone`,
// globalmente único). Idempotência: procura a zone por nome antes de criar.
// HTTP injetável — testado com FakeHttpClient sem token.

import type { ProviderAdapter, ProvisionCtx } from "./types.js";
import { HttpError } from "./http.js";
import type { HttpClient } from "./http.js";

const API = "https://api.bunny.net";

interface StorageZone {
  Id: number;
  Name: string;
  Password?: string;
}

interface PullZone {
  Id: number;
  Name: string;
  Hostnames?: Array<{ Value: string }>;
}

function authHeaders(key: string): Record<string, string> {
  return { AccessKey: key };
}

async function findStorageZone(
  http: HttpClient,
  key: string,
  name: string,
): Promise<StorageZone | undefined> {
  const res = await http.request({
    method: "GET",
    url: `${API}/storagezone`,
    headers: authHeaders(key),
  });
  if (res.status >= 400) {
    throw new HttpError(`Bunny list storage zones falhou (${res.status})`, res.status, res.body);
  }
  const list = (Array.isArray(res.body) ? res.body : []) as StorageZone[];
  return list.find((z) => z.Name === name);
}

export function createBunnyAdapter(): ProviderAdapter {
  return {
    id: "bunny",
    label: "Bunny.net (mídia)",
    async ensure(ctx: ProvisionCtx): Promise<void> {
      const { config, http, tokens, vault, state, env, log } = ctx;
      const media = config.providers.media;
      // Guarda de narrowing: desde o storage plugável, `media` é união. Este
      // adapter só entra na composição quando o provedor é bunny — se chegar
      // aqui com outro, é erro de montagem do pipeline, não do usuário.
      if (media.provider !== "bunny") {
        throw new Error(
          `Bunny adapter chamado para provedor "${media.provider}".`,
        );
      }
      const zoneName = media.storageZone;
      const region = media.storageRegion ?? "BR";

      if (ctx.dryRun) {
        log.plan(`Bunny: procurar Storage Zone "${zoneName}"; se ausente, criar (region=${region}).`);
        log.plan(`Bunny: criar Pull Zone → hostname .b-cdn.net → BUNNY_CDN_URL.`);
        state.resources.bunny = { status: "pending", name: zoneName };
        return;
      }

      const key = tokens.bunnyAccountApiKey;
      if (!key) throw new Error("Bunny: BUNNY_ACCOUNT_API_KEY ausente (rode o preflight).");

      // 2a. Storage Zone (idempotente por nome).
      let zone = await findStorageZone(http, key, zoneName);
      let createdThisRun = false;
      if (!zone) {
        const res = await http.request({
          method: "POST",
          url: `${API}/storagezone`,
          headers: authHeaders(key),
          body: { Name: zoneName, Region: region },
        });
        if (res.status >= 400) {
          throw new HttpError(`Bunny criar storage zone falhou (${res.status})`, res.status, res.body);
        }
        zone = res.body as StorageZone;
        createdThisRun = true;
        log.info(`Bunny: Storage Zone "${zoneName}" criada (id=${zone.Id}).`);
      } else {
        log.info(`Bunny: Storage Zone "${zoneName}" já existe (id=${zone.Id}) — reconciliando.`);
      }
      if (zone.Password) vault.set("bunnyStorageKey", zone.Password);

      // 2b. Pull Zone.
      const pullName = `${config.slug}-cdn`;
      const pullRes = await http.request({
        method: "POST",
        url: `${API}/pullzone`,
        headers: authHeaders(key),
        body: { Name: pullName, StorageZoneId: zone.Id, Type: 0 },
      });
      if (pullRes.status >= 400) {
        throw new HttpError(`Bunny criar pull zone falhou (${pullRes.status})`, pullRes.status, pullRes.body);
      }
      const pull = pullRes.body as PullZone;
      const hostname = pull.Hostnames?.[0]?.Value ?? `${pullName}.b-cdn.net`;
      env.bunnyCdnUrl = `https://${hostname}`;
      env.bunnyStorageZoneId = String(zone.Id);

      state.resources.bunny = {
        status: "verified",
        externalId: String(zone.Id),
        name: zoneName,
        createdThisRun,
        createdAt: new Date().toISOString(),
        meta: { pullZoneId: String(pull.Id), cdnHost: hostname },
      };
      log.info(`Bunny: verificado (CDN=${env.bunnyCdnUrl}).`);
    },

    async rollback(ctx: ProvisionCtx): Promise<void> {
      const { http, tokens, state, log } = ctx;
      const r = state.resources.bunny;
      if (!r?.createdThisRun || !r.externalId) {
        log.info("Bunny: nada a reverter (não criado nesta run).");
        return;
      }
      if (ctx.dryRun) {
        log.plan(`Bunny: DELETE Pull Zone + Storage Zone ${r.externalId} (só criado nesta run).`);
        return;
      }
      const key = tokens.bunnyAccountApiKey;
      if (!key) {
        log.warn(`Bunny: ÓRFÃO — zone ${r.externalId} não removida (sem key). Limpar à mão.`);
        return;
      }
      const pullZoneId = r.meta?.pullZoneId;
      if (pullZoneId) {
        await http.request({ method: "DELETE", url: `${API}/pullzone/${pullZoneId}`, headers: authHeaders(key) });
      }
      const res = await http.request({
        method: "DELETE",
        url: `${API}/storagezone/${r.externalId}`,
        headers: authHeaders(key),
      });
      if (res.status >= 400) {
        log.warn(`Bunny: ÓRFÃO — falha ao deletar zone ${r.externalId} (${res.status}). Limpar à mão.`);
        return;
      }
      log.info(`Bunny: zone ${r.externalId} revertida.`);
    },
  };
}
