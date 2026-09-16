// Handlers canned que simulam as APIs dos providers para o FakeHttpClient.
// Cada factory devolve um FakeHandler; compõem-se no orquestrador via
// `new FakeHttpClient([...])`. Nenhuma chamada real de rede.

import { json, type FakeHandler, type HttpRequest } from "../http.js";

const has = (req: HttpRequest, method: string, urlPart: string): boolean =>
  req.method === method && req.url.includes(urlPart);

/**
 * Supabase: list vazio (nada existe) → create → poll ACTIVE_HEALTHY imediato →
 * api-keys → SMTP patch. `existingNames` permite simular reconciliação.
 * Escopado ao host `api.supabase.com` para não colidir com o Neon no caso
 * 2-provedores (ambos têm rota `/projects`).
 */
export function supabaseHandler(existingNames: string[] = []): FakeHandler {
  const created = new Map<string, { id: string; name: string }>();
  return (req) => {
    if (!req.url.includes("api.supabase.com")) return undefined;
    // list
    if (has(req, "GET", "/v1/projects") && !req.url.match(/\/v1\/projects\/[^/]+/)) {
      const existing = existingNames.map((name, i) => ({ id: `ref-existing-${i}`, name, status: "ACTIVE_HEALTHY" }));
      return json(200, [...existing, ...created.values()]);
    }
    // create
    if (has(req, "POST", "/v1/projects") && !req.url.match(/\/config\/auth/)) {
      const body = req.body as { name: string };
      const id = `ref-${body.name}`;
      created.set(body.name, { id, name: body.name });
      return json(201, { id, name: body.name, status: "COMING_UP" });
    }
    // get single (poll)
    if (has(req, "GET", "/v1/projects/") && !req.url.includes("api-keys")) {
      const ref = req.url.split("/v1/projects/")[1].split("?")[0];
      return json(200, { id: ref, name: ref, status: "ACTIVE_HEALTHY" });
    }
    // api-keys
    if (has(req, "GET", "/api-keys")) {
      return json(200, [
        { name: "anon", api_key: "SUPA_ANON_KEY_SECRET" },
        { name: "service_role", api_key: "SUPA_SERVICE_ROLE_SECRET" },
      ]);
    }
    // SMTP patch
    if (has(req, "PATCH", "/config/auth")) return json(200, {});
    // delete
    if (has(req, "DELETE", "/v1/projects/")) return json(200, {});
    return undefined;
  };
}

/** Neon: list vazio → create devolve project + connection_uris com senha.
 * Escopado ao host `console.neon.tech`. */
export function neonHandler(existingNames: string[] = []): FakeHandler {
  return (req) => {
    if (!req.url.includes("console.neon.tech")) return undefined;
    if (has(req, "GET", "/projects") && !req.url.match(/\/projects\/[^/]+/)) {
      return json(200, {
        projects: existingNames.map((name, i) => ({ id: `neon-existing-${i}`, name })),
      });
    }
    if (has(req, "POST", "/projects")) {
      const body = req.body as { project: { name: string } };
      const name = body.project.name;
      return json(201, {
        project: { id: `neon-${name}`, name },
        branch: { id: "br-main" },
        connection_uris: [
          {
            connection_uri: "postgres://neondb_owner:NEON_PW_SECRET@ep-x.sa-east-1.aws.neon.tech/neondb",
            connection_parameters: {
              host: "ep-cool-123.sa-east-1.aws.neon.tech",
              database: "neondb",
              role: "neondb_owner",
              password: "NEON_PW_SECRET",
            },
          },
        ],
      });
    }
    if (has(req, "GET", "/connection_uri")) {
      return json(200, {
        uri: "postgres://neondb_owner:NEON_PW_SECRET@ep-cool-123.sa-east-1.aws.neon.tech/neondb",
        connection_parameters: {
          host: "ep-cool-123.sa-east-1.aws.neon.tech",
          database: "neondb",
          role: "neondb_owner",
          password: "NEON_PW_SECRET",
        },
      });
    }
    if (has(req, "DELETE", "/projects/")) return json(200, {});
    return undefined;
  };
}

/** Bunny: list vazio → create storage zone (com Password) + pull zone. */
export function bunnyHandler(): FakeHandler {
  const zones = new Map<string, { Id: number; Name: string }>();
  let pullId = 0;
  return (req) => {
    if (has(req, "GET", "/storagezone")) {
      return json(200, [...zones.values()]);
    }
    if (has(req, "POST", "/storagezone")) {
      const body = req.body as { Name: string };
      const Id = zones.size + 1;
      zones.set(body.Name, { Id, Name: body.Name });
      return json(201, { Id, Name: body.Name, Password: "BUNNY_ZONE_PW_SECRET" });
    }
    if (has(req, "POST", "/pullzone")) {
      const body = req.body as { Name: string };
      pullId += 1;
      return json(201, { Id: pullId, Name: body.Name, Hostnames: [{ Value: `${body.Name}.b-cdn.net` }] });
    }
    if (has(req, "DELETE", "/pullzone/")) return json(200, {});
    if (has(req, "DELETE", "/storagezone/")) return json(200, {});
    return undefined;
  };
}

/** Resend: list vazio → register domain → verify → verified. */
export function resendHandler(): FakeHandler {
  return (req) => {
    if (has(req, "GET", "/domains") && !req.url.match(/\/domains\/[^/]+/)) {
      return json(200, { data: [] });
    }
    if (has(req, "POST", "/domains") && !req.url.includes("/verify")) {
      const body = req.body as { name: string };
      return json(201, {
        id: "resend-dom-1",
        name: body.name,
        status: "pending",
        records: [{ record: "DKIM", name: `resend._domainkey.${body.name}`, type: "TXT", value: "p=abc" }],
      });
    }
    if (has(req, "POST", "/domains/") && req.url.includes("/verify")) return json(200, {});
    if (has(req, "GET", "/domains/")) {
      return json(200, { id: "resend-dom-1", name: "x", status: "verified" });
    }
    if (has(req, "DELETE", "/domains/")) return json(200, {});
    return undefined;
  };
}

/** Vercel: get project 404 (não existe) → create → env → domain → deploy. */
export function vercelHandler(opts: { failCreate?: boolean } = {}): FakeHandler {
  return (req) => {
    if (has(req, "GET", "/v9/projects/")) return json(404, { error: "not found" });
    if (has(req, "POST", "/v9/projects")) {
      if (opts.failCreate) return json(403, { error: "forbidden" });
      const body = req.body as { name: string };
      return json(201, { id: `vercel-${body.name}`, name: body.name });
    }
    if (has(req, "POST", "/env")) return json(201, {});
    if (has(req, "POST", "/domains")) return json(201, {});
    if (has(req, "POST", "/v13/deployments")) return json(201, { url: "acme-cms.vercel.app" });
    if (has(req, "DELETE", "/v9/projects/")) return json(200, {});
    return undefined;
  };
}
