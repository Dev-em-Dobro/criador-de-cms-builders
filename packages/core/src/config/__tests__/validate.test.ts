// S0.1 — suíte de testes do validador Zod do ClientConfig.
//
// Cobre AC14: ao menos 1 caso PASS e 1 caso FAIL para cada regra dos ACs 3–13.
// A fixture `validBaseConfig()` é um ClientConfig mínimo e válido (kind
// "supabase", 1 coleção com 1 campo, 1 locale, branding mínimo). Cada teste de
// rejeição deriva dela e muta apenas o campo sob teste.

import { describe, it, expect } from "vitest";
import {
  validateClientConfig,
  ClientConfigValidationError,
} from "../validate.js";
import type { ClientConfig } from "../types.js";

/** Deep clone via JSON (config é puro JSON-serializável). */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** ClientConfig mínimo e válido — base para todos os testes de mutação. */
function validBaseConfig(): ClientConfig {
  return {
    slug: "acme",
    displayName: "Acme Corporation",
    coreVersion: "^1.0.0",
    branding: {
      adminTitle: "Acme CMS",
      colors: {
        brand: "#2563EB",
        brandDark: "#1D4ED8",
      },
    },
    domains: {
      adminSubdomain: "cms.acme.com",
      siteUrl: "https://www.acme.com",
    },
    providers: {
      database: { kind: "supabase", region: "sa-east-1", plan: "free" },
      auth: { provider: "supabase", region: "sa-east-1", plan: "free" },
      media: {
        provider: "bunny",
        storageZone: "acme-media",
        cdnUrl: "https://acme.b-cdn.net",
      },
      email: { provider: "resend", senderDomain: "acme.com" },
      hosting: { provider: "vercel", projectName: "acme-cms" },
    },
    locales: {
      default: "pt-BR",
      enabled: [
        { code: "pt-BR", label: "Português" },
        { code: "en", label: "English" },
      ],
    },
    collections: [
      {
        type: "case",
        label: "Case study",
        segment: "cases",
        fields: [
          { name: "title", label: "Title", kind: "text", required: true },
          { name: "cover", label: "Cover", kind: "media", uploadField: "banner" },
          { name: "industryFacets", label: "Classification", kind: "facets" },
        ],
        facets: [
          { name: "industry", column: "industry", sourceField: "industryFacets" },
        ],
      },
    ],
    uploadPolicies: {
      banner: {
        label: "Banner",
        aspectRatio: { w: 16, h: 9, tolerance: 0.05 },
        maxBytes: 8_388_608,
      },
    },
    seedAdmin: { email: "admin@acme.com", passwordEnvVar: "SEED_ADMIN_PASSWORD" },
    seeds: { enabled: false },
  };
}

/** Helper: afirma que a validação lança com um issue no path esperado. */
function expectFailAtPath(config: unknown, pathFragment: string) {
  let error: unknown;
  try {
    validateClientConfig(config);
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(ClientConfigValidationError);
  const issues = (error as ClientConfigValidationError).issues;
  const paths = issues.map((i) => i.path.join("."));
  expect(paths.some((p) => p.includes(pathFragment))).toBe(true);
}

describe("validateClientConfig — casos PASS", () => {
  it("config mínimo válido (kind supabase, regiões idênticas) passa", () => {
    expect(() => validateClientConfig(validBaseConfig())).not.toThrow();
  });

  it("retorna o config tipado em sucesso", () => {
    const result = validateClientConfig(validBaseConfig());
    expect(result.slug).toBe("acme");
    expect(result.collections).toHaveLength(1);
  });

  it("PASS: kind neon com auth.region diferente de database.region (AC13)", () => {
    const cfg = clone(validBaseConfig());
    cfg.providers.database = {
      kind: "neon",
      region: "aws-sa-east-1",
      plan: "launch",
      branch: "main",
    };
    cfg.providers.auth = { provider: "supabase", region: "sa-east-1", plan: "free" };
    expect(() => validateClientConfig(cfg)).not.toThrow();
  });
});

describe("AC3 — pattern de slug e collection.type", () => {
  it("PASS: slug e type minúsculos válidos", () => {
    expect(() => validateClientConfig(validBaseConfig())).not.toThrow();
  });

  it("FAIL: collection.type com maiúscula", () => {
    const cfg = clone(validBaseConfig());
    cfg.collections[0].type = "MeuTipo";
    expectFailAtPath(cfg, "collections.0.type");
  });

  it("FAIL: collection.type com hífen (proibido no enum Postgres)", () => {
    const cfg = clone(validBaseConfig());
    cfg.collections[0].type = "case-study";
    expectFailAtPath(cfg, "collections.0.type");
  });

  it("FAIL: slug com maiúscula", () => {
    const cfg = clone(validBaseConfig());
    cfg.slug = "Acme";
    expectFailAtPath(cfg, "slug");
  });
});

describe("AC4 — unicidade de type entre coleções e de field.name dentro da coleção", () => {
  it("FAIL: dois tipos 'case' na mesma config", () => {
    const cfg = clone(validBaseConfig());
    cfg.collections.push({
      type: "case",
      label: "Case again",
      segment: "cases2",
      fields: [{ name: "title", label: "Title", kind: "text" }],
    });
    expectFailAtPath(cfg, "collections.1.type");
  });

  it("FAIL: field.name 'title' duplicado dentro da coleção 'case'", () => {
    const cfg = clone(validBaseConfig());
    cfg.collections[0].fields.push({ name: "title", label: "Title 2", kind: "text" });
    expectFailAtPath(cfg, "fields");
  });
});

describe("AC5 — field.uploadField deve existir em uploadPolicies", () => {
  it("FAIL: uploadField 'banner' referenciado sem uploadPolicies.banner", () => {
    const cfg = clone(validBaseConfig());
    // remove a policy 'banner' mas mantém o campo que a referencia
    delete (cfg.uploadPolicies as Record<string, unknown>).banner;
    expectFailAtPath(cfg, "uploadField");
  });

  it("PASS: uploadField que existe em uploadPolicies", () => {
    expect(() => validateClientConfig(validBaseConfig())).not.toThrow();
  });
});

describe("AC6 — facets[].sourceField deve ser um field.name da coleção (facet órfão)", () => {
  it("FAIL: sourceField apontando para campo inexistente", () => {
    const cfg = clone(validBaseConfig());
    cfg.collections[0].facets = [
      { name: "industry", column: "industry", sourceField: "campoInexistente" },
    ];
    expectFailAtPath(cfg, "sourceField");
  });

  it("FAIL: facet sem sourceField cujo name não é field da coleção", () => {
    const cfg = clone(validBaseConfig());
    cfg.collections[0].facets = [{ name: "naoexiste" }];
    expectFailAtPath(cfg, "sourceField");
  });

  it("PASS: sourceField apontando para um field existente", () => {
    expect(() => validateClientConfig(validBaseConfig())).not.toThrow();
  });
});

describe("AC7 — singleton vs segment vs singletonRoutes", () => {
  it("FAIL: coleção não-singleton sem segment", () => {
    const cfg = clone(validBaseConfig());
    delete cfg.collections[0].segment;
    expectFailAtPath(cfg, "segment");
  });

  it("FAIL: coleção singleton sem singletonRoutes", () => {
    const cfg = clone(validBaseConfig());
    cfg.collections[0].singleton = true;
    delete cfg.collections[0].segment;
    delete cfg.collections[0].facets;
    expectFailAtPath(cfg, "singletonRoutes");
  });

  it("FAIL: coleção singleton com singletonRoutes vazio", () => {
    const cfg = clone(validBaseConfig());
    cfg.collections[0].singleton = true;
    cfg.collections[0].singletonRoutes = {};
    delete cfg.collections[0].segment;
    delete cfg.collections[0].facets;
    expectFailAtPath(cfg, "singletonRoutes");
  });

  it("PASS: singleton com singletonRoutes não-vazio", () => {
    const cfg = clone(validBaseConfig());
    cfg.collections[0] = {
      type: "page_legal",
      label: "Legal",
      singleton: true,
      singletonRoutes: { privacy: "privacy", terms: "terms" },
      fields: [{ name: "title", label: "Title", kind: "text", required: true }],
    };
    expect(() => validateClientConfig(cfg)).not.toThrow();
  });
});

describe("AC8 — locales.default deve estar em locales.enabled", () => {
  it("FAIL: default 'es' com enabled contendo apenas pt-BR e en", () => {
    const cfg = clone(validBaseConfig());
    cfg.locales.default = "es";
    expectFailAtPath(cfg, "locales.default");
  });

  it("PASS: default presente em enabled", () => {
    expect(() => validateClientConfig(validBaseConfig())).not.toThrow();
  });
});

describe("AC9 — cores de branding devem casar hex de 6 dígitos", () => {
  it("FAIL: brand 'red' (sem #, sem hex)", () => {
    const cfg = clone(validBaseConfig());
    cfg.branding.colors.brand = "red";
    expectFailAtPath(cfg, "brand");
  });

  it("FAIL: brand hex de 3 dígitos", () => {
    const cfg = clone(validBaseConfig());
    cfg.branding.colors.brand = "#abc";
    expectFailAtPath(cfg, "brand");
  });

  it("PASS: hex de 6 dígitos", () => {
    expect(() => validateClientConfig(validBaseConfig())).not.toThrow();
  });
});

describe("AC10 — detecção de secrets (falha dura)", () => {
  it("FAIL: adminTitle contendo uma chave sk-...", () => {
    const cfg = clone(validBaseConfig());
    cfg.branding.adminTitle = "sk-supersecretkey123456";
    expectFailAtPath(cfg, "branding.adminTitle");
  });

  it("FAIL: valor contendo padrão DATABASE_URL", () => {
    const cfg = clone(validBaseConfig());
    cfg.displayName = "postgres://... DATABASE_URL leak";
    expectFailAtPath(cfg, "displayName");
  });

  it("FAIL: valor contendo SERVICE_ROLE_KEY", () => {
    const cfg = clone(validBaseConfig());
    // `media` é união discriminada desde o storage plugável; o baseline é bunny.
    const media = cfg.providers.media;
    if (media.provider !== "bunny") throw new Error("baseline deveria usar bunny");
    media.storageZone = "acme-SERVICE_ROLE_KEY";
    expectFailAtPath(cfg, "storageZone");
  });

  it("PASS: passwordEnvVar com o NOME da env var não dispara falso positivo", () => {
    // "SEED_ADMIN_PASSWORD" casa /PASSWORD/i mas é o nome da variável, não o valor.
    expect(() => validateClientConfig(validBaseConfig())).not.toThrow();
  });
});

describe("storage plugável — providers.media aceita bunny e vercel-blob", () => {
  it("PASS: vercel-blob sem zona/CDN (a URL vem do próprio blob)", () => {
    const cfg = clone(validBaseConfig());
    cfg.providers.media = { provider: "vercel-blob", storeName: "acme-media" };
    expect(() => validateClientConfig(cfg)).not.toThrow();
  });

  it("PASS: vercel-blob sem storeName (campo é documental)", () => {
    const cfg = clone(validBaseConfig());
    cfg.providers.media = { provider: "vercel-blob" };
    expect(() => validateClientConfig(cfg)).not.toThrow();
  });

  it("FAIL: provedor desconhecido", () => {
    const cfg = clone(validBaseConfig());
    (cfg.providers as { media: unknown }).media = { provider: "s3", bucket: "x" };
    expect(() => validateClientConfig(cfg)).toThrow();
  });

  it("FAIL: bunny sem storageZone", () => {
    const cfg = clone(validBaseConfig());
    (cfg.providers as { media: unknown }).media = {
      provider: "bunny",
      cdnUrl: "https://acme.b-cdn.net",
    };
    expect(() => validateClientConfig(cfg)).toThrow();
  });
});

describe("AC11 — providers.database.kind ∈ {supabase, neon}; branch só em neon", () => {
  it("FAIL: kind inválido", () => {
    const cfg = clone(validBaseConfig());
    (cfg.providers.database as { kind: string }).kind = "mysql";
    expectFailAtPath(cfg, "database");
  });

  it("FAIL: branch presente em kind supabase (rejeitado pelo .strict)", () => {
    const cfg = clone(validBaseConfig());
    (cfg.providers.database as Record<string, unknown>).branch = "main";
    expectFailAtPath(cfg, "database");
  });

  it("PASS: kind neon com branch", () => {
    const cfg = clone(validBaseConfig());
    cfg.providers.database = {
      kind: "neon",
      region: "aws-sa-east-1",
      branch: "main",
    };
    cfg.providers.auth = { provider: "supabase", region: "sa-east-1" };
    expect(() => validateClientConfig(cfg)).not.toThrow();
  });
});

describe("AC12 — providers.auth.provider === 'supabase' obrigatório", () => {
  it("FAIL: auth.provider diferente de 'supabase'", () => {
    const cfg = clone(validBaseConfig());
    (cfg.providers.auth as { provider: string }).provider = "auth0";
    expectFailAtPath(cfg, "auth.provider");
  });

  it("PASS: auth.provider supabase", () => {
    expect(() => validateClientConfig(validBaseConfig())).not.toThrow();
  });
});

describe("AC13 — coerência Supabase-único (auth.region === database.region)", () => {
  it("FAIL: kind supabase com auth.region != database.region", () => {
    const cfg = clone(validBaseConfig());
    cfg.providers.database = { kind: "supabase", region: "sa-east-1" };
    cfg.providers.auth = { provider: "supabase", region: "us-east-1" };
    expectFailAtPath(cfg, "providers.auth.region");
  });

  it("PASS: kind neon com auth.region livre (region diferente é permitido)", () => {
    const cfg = clone(validBaseConfig());
    cfg.providers.database = { kind: "neon", region: "aws-sa-east-1" };
    cfg.providers.auth = { provider: "supabase", region: "sa-east-1" };
    expect(() => validateClientConfig(cfg)).not.toThrow();
  });

  it("PASS: kind supabase com regiões idênticas", () => {
    expect(() => validateClientConfig(validBaseConfig())).not.toThrow();
  });
});

describe("erro reporta o caminho do campo problemático (T3.5)", () => {
  it("issue.path contém providers.database para kind inválido", () => {
    const cfg = clone(validBaseConfig());
    (cfg.providers.database as { kind: string }).kind = "mysql";
    let error: ClientConfigValidationError | undefined;
    try {
      validateClientConfig(cfg);
    } catch (e) {
      error = e as ClientConfigValidationError;
    }
    expect(error).toBeDefined();
    const joined = error!.issues.map((i) => i.path.join(".")).join(" | ");
    expect(joined).toContain("providers.database");
  });
});
