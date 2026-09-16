// @cms-core/config — validador Zod do ClientConfig.
//
// Implementa as 11 regras de validação da §4.2 do doc de arquitetura
// (docs/architecture/cms-factory-architecture.md), cobrindo os ACs 3–13 da
// story S0.1. Artigo IV (No Invention): nenhuma regra além das da §4.2.
//
// `validateClientConfig(raw)` lança um erro descritivo (com o caminho do campo
// problemático) em qualquer falha; caso contrário retorna o `ClientConfig`
// tipado.

import { z } from "zod";
import type { ClientConfig } from "./types.js";

// ── Regex de patterns (§4.2) ────────────────────────────────────────────────
/** slug e collection.type base: minúscula inicial, depois [a-z0-9_-]. */
const SLUG_RE = /^[a-z][a-z0-9_-]*$/;
/** collection.type adicionalmente (é literal de enum Postgres): sem hífen. */
const ENUM_TYPE_RE = /^[a-z][a-z0-9_]*$/;
/** cor hex de 6 dígitos. */
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// ── Detecção de secrets (§4.2 — falha dura, AC10) ───────────────────────────
/**
 * Padrões de chaves conhecidas que jamais devem aparecer em um valor do config.
 * Cobre nomes de env vars sensíveis e prefixos de chaves de API comuns. A
 * checagem é case-insensitive e roda sobre TODO valor string do config.
 */
const SECRET_KEY_PATTERNS: RegExp[] = [
  /DATABASE_URL/i,
  /DIRECT_URL/i,
  /SERVICE_ROLE_KEY/i,
  /API_KEY/i,
  /PASSWORD/i,
  /SECRET/i,
  /TOKEN/i,
  // prefixos de chaves reais (Stripe-like, OpenAI-like, Supabase JWT, etc.)
  /\bsk-[a-zA-Z0-9]{8,}/,
  /\bsk_live_[a-zA-Z0-9]{8,}/,
  /\bghp_[a-zA-Z0-9]{8,}/,
  /\beyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{10,}/, // JWT
];

/**
 * Nomes de campo cujo VALOR é legitimamente o *nome* de uma env var (não o
 * segredo em si) e portanto não devem disparar a detecção de secret. Ex.:
 * `seedAdmin.passwordEnvVar: "SEED_ADMIN_PASSWORD"` é o nome da variável, não a
 * senha. A detecção continua ativa em todo o resto do config.
 */
const ENV_VAR_NAME_PATHS = new Set<string>(["seedAdmin.passwordEnvVar"]);

/** Percorre recursivamente o objeto e reporta o primeiro valor string suspeito. */
function findSecretLeak(
  value: unknown,
  path: string,
): { path: string; pattern: string } | null {
  if (typeof value === "string") {
    if (ENV_VAR_NAME_PATHS.has(path)) return null;
    for (const re of SECRET_KEY_PATTERNS) {
      if (re.test(value)) {
        return { path: path || "(root)", pattern: re.source };
      }
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findSecretLeak(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const hit = findSecretLeak(v, path ? `${path}.${k}` : k);
      if (hit) return hit;
    }
    return null;
  }
  return null;
}

// ── Schemas Zod dos sub-objetos ─────────────────────────────────────────────

const fieldValidateSchema = z
  .object({
    pattern: z.string().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    custom: z.string().optional(),
  })
  .strict();

// Sub-spec de item p/ `itemShape` (json array-of-objects). ADR-002 Decisão 2.
const itemFieldSpecSchema = z
  .object({
    kind: z.enum(["text", "media"]),
    required: z.boolean().optional(),
    default: z.unknown().optional(),
  })
  .strict();

const fieldSchema = z
  .object({
    name: z.string().min(1),
    label: z.string().min(1),
    kind: z.enum([
      "text",
      "textarea",
      "richtext",
      "url",
      "email",
      "media",
      "date",
      "stringList",
      "facets",
      "json",
    ]),
    required: z.boolean().optional(),
    help: z.string().optional(),
    uploadField: z.string().optional(),
    validate: fieldValidateSchema.optional(),
    // ── ADR-002 Decisão 2 + ADR-003 P3 — atributos por campo (aditivos) ───────
    // Extensão ANTES do baseline os declarar (ordem crítica: o `.strict()`
    // rejeitaria estas chaves se não estivessem aqui). Ver ADR-003 §6.1.
    default: z.unknown().optional(),
    trim: z.boolean().optional(),
    dedup: z.boolean().optional(),
    itemShape: z.record(z.string(), itemFieldSpecSchema).optional(),
    uiHidden: z.boolean().optional(),
  })
  .strict();

const facetSchema = z
  .object({
    name: z.string().min(1),
    column: z.string().optional(),
    sourceField: z.string().optional(),
  })
  .strict();

const collectionSchema = z
  .object({
    // AC3: `type` casa o pattern de enum Postgres (sem hífen).
    type: z
      .string()
      .regex(
        ENUM_TYPE_RE,
        'collection.type deve casar /^[a-z][a-z0-9_]*$/ (é literal de enum Postgres)',
      ),
    label: z.string().min(1),
    segment: z
      .string()
      .regex(SLUG_RE, 'collection.segment deve casar /^[a-z][a-z0-9_-]*$/')
      .optional(),
    singleton: z.boolean().optional(),
    orderable: z.boolean().optional(),
    icon: z.string().optional(),
    fields: z.array(fieldSchema).min(1),
    facets: z.array(facetSchema).optional(),
    singletonRoutes: z.record(z.string(), z.string()).optional(),
  })
  .strict();

const uploadPolicySchema = z
  .object({
    label: z.string().min(1),
    formats: z.array(z.string()).optional(),
    maxBytes: z.number().optional(),
    maxWidth: z.number().optional(),
    maxHeight: z.number().optional(),
    requireAlpha: z.boolean().optional(),
    aspectRatio: z
      .object({
        w: z.number(),
        h: z.number(),
        tolerance: z.number().optional(),
      })
      .strict()
      .optional(),
    preserveFormat: z.boolean().optional(),
  })
  .strict();

const brandingSchema = z
  .object({
    adminTitle: z.string().min(1),
    fontFamily: z.string().optional(),
    // AC9: cada cor de branding deve casar hex de 6 dígitos.
    colors: z
      .object({
        brand: z.string().regex(HEX_COLOR_RE, "branding.colors.brand inválida"),
        brandDark: z
          .string()
          .regex(HEX_COLOR_RE, "branding.colors.brandDark inválida"),
        brandDarker: z.string().regex(HEX_COLOR_RE).optional(),
        ink: z.string().regex(HEX_COLOR_RE).optional(),
        muted: z.string().regex(HEX_COLOR_RE).optional(),
        paper: z.string().regex(HEX_COLOR_RE).optional(),
      })
      .strict(),
    logoPath: z.string().optional(),
  })
  .strict();

const domainsSchema = z
  .object({
    adminSubdomain: z.string().min(1),
    siteUrl: z.string().min(1),
  })
  .strict();

// AC11 / AC13: união discriminada por `kind` (só "supabase" | "neon"); `branch`
// permitido apenas em `kind:"neon"` (o `.strict()` do supabase rejeita `branch`).
const databaseSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("supabase"),
      region: z.string().min(1),
      plan: z.enum(["free", "pro"]).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("neon"),
      region: z.string().min(1),
      plan: z.enum(["free", "launch", "scale"]).optional(),
      branch: z.string().optional(),
    })
    .strict(),
]);

// AC12: `auth.provider === "supabase"` obrigatório (v1 não aceita outro).
const authSchema = z
  .object({
    provider: z.literal("supabase"),
    region: z.string().min(1),
    plan: z.enum(["free", "pro"]).optional(),
  })
  .strict();

const providersSchema = z
  .object({
    database: databaseSchema,
    auth: authSchema,
    // União discriminada por provedor: cada ramo exige só o que o seu adapter
    // usa. Bunny precisa de zona + CDN; Vercel Blob não tem nada obrigatório
    // (a URL vem do próprio blob e o token é variável de ambiente).
    media: z.discriminatedUnion("provider", [
      z
        .object({
          provider: z.literal("bunny"),
          storageZone: z.string().min(1),
          storageRegion: z.string().optional(),
          cdnUrl: z.string().min(1),
        })
        .strict(),
      z
        .object({
          provider: z.literal("vercel-blob"),
          storeName: z.string().optional(),
        })
        .strict(),
    ]),
    email: z
      .object({
        provider: z.literal("resend"),
        senderDomain: z.string().min(1),
        fromName: z.string().optional(),
      })
      .strict(),
    hosting: z
      .object({
        provider: z.literal("vercel"),
        projectName: z.string().min(1),
        teamSlug: z.string().optional(),
        framework: z.literal("nextjs").optional(),
      })
      .strict(),
  })
  .strict();

const localesSchema = z
  .object({
    default: z.string().min(1),
    enabled: z
      .array(
        z
          .object({ code: z.string().min(1), label: z.string().min(1) })
          .strict(),
      )
      .min(1),
  })
  .strict();

const seedAdminSchema = z
  .object({
    email: z.string().email(),
    passwordEnvVar: z.string().optional(),
  })
  .strict();

const seedsSchema = z
  .object({
    enabled: z.boolean(),
    datasetPath: z.string().optional(),
  })
  .strict();

/**
 * Schema base (validação estrutural + patterns por-campo). As regras
 * cross-field (unicidade, referências cruzadas, coerência D5, secrets) são
 * aplicadas em `.superRefine` abaixo — Zod não expressa essas naturalmente.
 */
const baseClientConfigSchema = z
  .object({
    slug: z
      .string()
      .regex(SLUG_RE, 'slug deve casar /^[a-z][a-z0-9_-]*$/'),
    displayName: z.string().min(1),
    coreVersion: z.string().min(1),
    branding: brandingSchema,
    domains: domainsSchema,
    providers: providersSchema,
    locales: localesSchema,
    collections: z.array(collectionSchema).min(1),
    uploadPolicies: z.record(z.string(), uploadPolicySchema),
    seedAdmin: seedAdminSchema,
    seeds: seedsSchema.optional(),
  })
  .strict();

const clientConfigSchema = baseClientConfigSchema.superRefine((config, ctx) => {
  // ── AC10: detecção de secrets (falha dura) ────────────────────────────────
  const leak = findSecretLeak(config, "");
  if (leak) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `valor suspeito de secret detectado em "${leak.path}" (padrão: ${leak.pattern}) — secrets nunca vão no config`,
      path: leak.path.split(/[.[\]]+/).filter(Boolean),
    });
  }

  // ── AC4: unicidade de collection.type ─────────────────────────────────────
  const seenTypes = new Set<string>();
  config.collections.forEach((col, i) => {
    if (seenTypes.has(col.type)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `collection.type duplicado: "${col.type}"`,
        path: ["collections", i, "type"],
      });
    }
    seenTypes.add(col.type);

    // ── AC4: unicidade de field.name dentro da coleção ──────────────────────
    const seenFields = new Set<string>();
    col.fields.forEach((field, fi) => {
      if (seenFields.has(field.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `field.name duplicado "${field.name}" na coleção "${col.type}"`,
          path: ["collections", i, "fields", fi, "name"],
        });
      }
      seenFields.add(field.name);

      // ── AC5: field.uploadField ⊆ chaves de uploadPolicies ─────────────────
      if (
        field.uploadField !== undefined &&
        !(field.uploadField in config.uploadPolicies)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `field.uploadField "${field.uploadField}" (coleção "${col.type}", campo "${field.name}") não existe em uploadPolicies`,
          path: ["collections", i, "fields", fi, "uploadField"],
        });
      }
    });

    // ── AC6: facets[].sourceField (ou name) ⊆ field.name da própria coleção ──
    if (col.facets) {
      const fieldNames = new Set(col.fields.map((f) => f.name));
      col.facets.forEach((facet, faceti) => {
        const src = facet.sourceField ?? facet.name;
        if (!fieldNames.has(src)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `facet "${facet.name}" da coleção "${col.type}" referencia sourceField "${src}" que não é um field.name da coleção (facet órfão)`,
            path: ["collections", i, "facets", faceti, "sourceField"],
          });
        }
      });
    }

    // ── AC7: singleton vs segment vs singletonRoutes ───────────────────────
    if (col.singleton === true) {
      if (
        !col.singletonRoutes ||
        Object.keys(col.singletonRoutes).length === 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `coleção singleton "${col.type}" exige singletonRoutes não-vazio`,
          path: ["collections", i, "singletonRoutes"],
        });
      }
    } else {
      // não-singleton exige segment
      if (!col.segment) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `coleção não-singleton "${col.type}" exige segment`,
          path: ["collections", i, "segment"],
        });
      }
    }
  });

  // ── AC8: locales.default ∈ locales.enabled[].code ─────────────────────────
  const enabledCodes = new Set(config.locales.enabled.map((l) => l.code));
  if (!enabledCodes.has(config.locales.default)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `locales.default "${config.locales.default}" não está presente em locales.enabled`,
      path: ["locales", "default"],
    });
  }

  // ── AC13: coerência Supabase-único (D5) ───────────────────────────────────
  // Quando database.kind === "supabase", auth.region DEVE igualar
  // database.region (é o mesmo projeto Supabase). Quando "neon", auth.region é
  // independente (projeto Supabase auth-only à parte).
  const { database, auth } = config.providers;
  if (database.kind === "supabase" && auth.region !== database.region) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `coerência D5: com providers.database.kind="supabase", providers.auth.region ("${auth.region}") deve igualar providers.database.region ("${database.region}") — é o mesmo projeto Supabase`,
      path: ["providers", "auth", "region"],
    });
  }
});

/** Erro de validação do ClientConfig, com os issues do Zod anexados. */
export class ClientConfigValidationError extends Error {
  readonly issues: z.ZodIssue[];

  constructor(issues: z.ZodIssue[]) {
    const summary = issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    super(`ClientConfig inválido:\n${summary}`);
    this.name = "ClientConfigValidationError";
    this.issues = issues;
  }
}

/**
 * Valida um `ClientConfig` bruto contra o contrato + as 11 regras da §4.2.
 * Lança `ClientConfigValidationError` (com o caminho do campo problemático) em
 * qualquer falha; retorna o config tipado em caso de sucesso.
 */
export function validateClientConfig(raw: unknown): ClientConfig {
  const result = clientConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new ClientConfigValidationError(result.error.issues);
  }
  return result.data as ClientConfig;
}

/**
 * Versão não-lançante: retorna `{ success: true, data }` ou
 * `{ success: false, issues }`. Útil para a CLI reportar todos os erros de uma
 * vez sem try/catch.
 */
export function safeValidateClientConfig(
  raw: unknown,
):
  | { success: true; data: ClientConfig }
  | { success: false; issues: z.ZodIssue[] } {
  const result = clientConfigSchema.safeParse(raw);
  if (!result.success) {
    return { success: false, issues: result.error.issues };
  }
  return { success: true, data: result.data as ClientConfig };
}
