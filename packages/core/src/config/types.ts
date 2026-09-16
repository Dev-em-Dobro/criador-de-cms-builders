// @cms-core/config — tipos do contrato de configuração de um cliente.
//
// Este arquivo é a FONTE ÚNICA da verdade do schema (D2). Editar + redeploy é a
// única forma de mudar coleções/campos. Não há criação em runtime.
//
// Deriva diretamente da §4.1 do doc de arquitetura
// (docs/architecture/cms-factory-architecture.md). Artigo IV (No Invention):
// nenhum campo ou tipo além do que está nessa seção.

// ── Campos ────────────────────────────────────────────────────────────────
/**
 * Os 10 kinds suportados pelo editor genérico (paridade 1:1 com o modelo atual,
 * verificado em `demo-corp-cms/lib/content/ui-fields.ts`).
 */
export type FieldKind =
  | "text" // input de linha única
  | "textarea" // texto multilinha sem formatação
  | "richtext" // Quill + sanitize-html (paste vira texto plano; iframe só YouTube)
  | "url" // validado como URL opcional (optionalUrl no Zod do core)
  | "email" // validado como email opcional
  | "media" // referência a media_assets; usa uploadField p/ política de upload
  | "date" // data ISO
  | "stringList" // string[] (tags, endereços) — editor de chips
  | "facets" // multi-select agrupado (industry/service/region/outcome)
  | "json"; // editor JSON p/ estruturas aninhadas (elements[], awards items[])

export interface FieldValidateConfig {
  /** regex declarativa (ex.: "^#([0-9a-fA-F]{6})$" para cor hex) */
  pattern?: string;
  /** min/max length p/ text/textarea; min/max itens p/ stringList */
  min?: number;
  max?: number;
  /**
   * validador nomeado registrado no core (escape hatch p/ regras finas,
   * ex.: "youtubeUrl" que hoje é custom). Ver R1 (§5) / risco Zod.
   */
  custom?: string;
}

/**
 * Sub-spec de um campo aninhado dentro de `itemShape` (json array-of-objects).
 * ADR-002 Decisão 2. Os únicos kinds usados hoje: `"text"` (key/title/name/year
 * → string) e `"media"` (logoMediaId → uuid).
 */
export interface ItemFieldSpec {
  kind: "text" | "media";
  /** true → `.min(1)` (text) / presente (media); false → `default("")`/optional() */
  required?: boolean;
  /** ex.: description → `default("")`. Só literais serializáveis. */
  default?: unknown;
}

export interface FieldConfig {
  /** chave dentro do JSONB `data` (ex.: "title", "logoMediaId") */
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  help?: string;
  /**
   * só p/ kind:"media" — chave em uploadPolicies (ex.: "logo", "banner").
   * Ausente => upload aceita o baseline genérico sem política estrita.
   */
  uploadField?: string;
  /** validação declarativa extra (além de required/kind) */
  validate?: FieldValidateConfig;

  // ── ADR-002 Decisão 2 — nuance de validação por campo (S2.1 vocabulário) ────
  /**
   * valor default quando o campo está ausente/vazio. Distingue os dois
   * "opcionais" do gold-standard: `default: ""` → `z.string().default("")` (dado
   * volta como ""); ausente + sem `required` → `.optional()` (dado volta
   * undefined). Também `default: []` p/ stringList. Só literais serializáveis
   * (string | número | boolean | [] | {}). Ver ADR-002 §2 / Apêndice A.
   */
  default?: unknown;
  /** normalização de stringList: apara cada item antes de validar (`tagsField`). */
  trim?: boolean;
  /** normalização de stringList: remove brancos + duplicados via Set (`tagsField`). */
  dedup?: boolean;
  /**
   * shape de item p/ kind:"json" que é um ARRAY DE OBJETOS (elements, items).
   * Cada chave → um sub-spec. `buildFieldSchema` emite
   * `z.array(z.object(shape)).default([])`. Ausente => json genérico.
   */
  itemShape?: Record<string, ItemFieldSpec>;

  // ── ADR-003 P3 — campo oculto na UI/schema (S2.1 vocabulário) ───────────────
  /**
   * `true` => o campo existe no config apenas para ancorar referências (ex.: o
   * `industryFacets` sintético que dá alvo aos `FacetConfig.sourceField`), mas
   * NÃO entra no `FIELDS` (UI) nem no schema Zod `data`. `buildFields`,
   * `buildEmptyData` e `buildZodSchema` o filtram. Descreve um fato observável
   * do gold-standard (campo invisível e fora do data-schema) — não inventa
   * comportamento (Artigo IV). Ver ADR-003 §3-P3.
   */
  uiHidden?: boolean;
}

// ── Facets promovidas a coluna ──────────────────────────────────────────────
/**
 * Um campo (normalmente kind:"facets" ou "stringList") promovido a coluna
 * text[] filtrável no read API. Generaliza a tabela caseStudyFacets.
 * O codegen emite, por coleção com facets, uma tabela `<type>_facets` com uma
 * coluna text[] + índice GIN por facet.
 */
export interface FacetConfig {
  /** nome do facet exposto como query param no read API (ex.: "industry") */
  name: string;
  /** nome da coluna text[] gerada (ex.: "industry"); default = name */
  column?: string;
  /** de qual campo do JSONB `data` os valores são extraídos (default = name) */
  sourceField?: string;
}

// ── Coleções e singletons ───────────────────────────────────────────────────
export interface CollectionConfig {
  /**
   * identificador do tipo → valor do enum content_type + chave do REGISTRY.
   * Deve casar /^[a-z][a-z0-9_]*$/ (vira literal do enum Postgres).
   */
  type: string;
  label: string;
  /** segmento plural na URL do admin (ex.: "cases"). Obrigatório se !singleton. */
  segment?: string;
  /** true => página única (não listável). Usa singletonRoutes. */
  singleton?: boolean;
  /** habilita ordenação drag-and-drop (generaliza o hoje-hardcoded type==="person") */
  orderable?: boolean;
  /** ícone opcional do item de nav (nome de ícone do set do admin) */
  icon?: string;
  fields: FieldConfig[];
  /** campos promovidos a colunas text[] filtráveis (generaliza caseStudyFacets) */
  facets?: FacetConfig[];
  /**
   * só p/ singleton: chave lógica -> slug de rota (ex.: { privacy: "privacy" }).
   * Um singleton pode ter várias "instâncias" fixas (ex.: legal → privacy+terms).
   */
  singletonRoutes?: Record<string, string>;
}

// ── Políticas de upload (paridade com lib/media/policies.ts) ─────────────────
export interface UploadPolicyConfig {
  label: string;
  /** MIME types aceitos (ex.: ["image/png"]). Omitir = baseline. */
  formats?: string[];
  maxBytes?: number;
  maxWidth?: number;
  maxHeight?: number;
  /** exige canal alpha (PNG transparente p/ logos) */
  requireAlpha?: boolean;
  /** força aspect ratio dentro de tolerance (default 0.02) */
  aspectRatio?: { w: number; h: number; tolerance?: number };
  /** mantém bytes/formato originais em vez de reencodar p/ WebP (logos PNG) */
  preserveFormat?: boolean;
}

// ── Branding / tema ──────────────────────────────────────────────────────────
export interface BrandingConfig {
  /** texto no AdminNav (hoje "Demo Corp") */
  adminTitle: string;
  /** "Poppins" | "Inter" | ... */
  fontFamily?: string;
  /** vira o bloco @theme gerado em app/theme.generated.css */
  colors: {
    brand: string; // "#d84339" — CTA/acento
    brandDark: string; // "#b5342b" — hover
    brandDarker?: string;
    ink?: string; // texto principal
    muted?: string; // texto secundário
    paper?: string; // fundo
  };
  /** logo do admin (asset relativo ao repo-cliente, copiado no scaffold) */
  logoPath?: string;
}

// ── Domínios ─────────────────────────────────────────────────────────────────
export interface DomainsConfig {
  /** host do admin (Vercel) — vira o domínio custom do projeto Vercel */
  adminSubdomain: string; // "cms.cliente.com"
  /** URL do site público — usado em preview e como origin de webhooks */
  siteUrl: string; // "https://www.cliente.com"
}

// ── Banco de conteúdo (D5 — união discriminada por provider) ──────────────────
/**
 * Onde o CONTEÚDO mora. União discriminada por `kind`. O runtime não muda entre
 * os dois (Drizzle + driver postgres + connection string); muda só a connection
 * string e o adapter de provisionamento (§13).
 *
 * IMPORTANTE: isto controla APENAS o banco de conteúdo. A AUTH (login + MFA)
 * fica sempre no Supabase Auth na v1 — ver `providers.auth` abaixo.
 */
export type DatabaseConfig =
  | {
      kind: "supabase";
      /** região do projeto Supabase de conteúdo (ex.: "sa-east-1") */
      region: string;
      /** plano do projeto ("free" | "pro"); default "free" */
      plan?: "free" | "pro";
    }
  | {
      kind: "neon";
      /**
       * região do projeto Neon no formato da Neon API (ex.: "aws-sa-east-1" →
       * host `...sa-east-1.aws.neon.tech`)
       */
      region: string;
      /** plano Neon ("free" | "launch" | "scale"); default "free" */
      plan?: "free" | "launch" | "scale";
      /** branch de conteúdo a usar (default "main") */
      branch?: string;
    };

/**
 * Onde a AUTH mora. Na v1 é SEMPRE Supabase Auth. Quando `database.kind` é:
 *   - "supabase": este é o MESMO projeto Supabase que serve o conteúdo.
 *   - "neon":     este é um projeto Supabase separado, AUTH-ONLY (sem tabelas de
 *                 conteúdo; só o schema `auth` + SMTP/Resend p/ emails de auth).
 * "zero-supabase" fica arquivado como evolução futura (D5) — não é aceito na v1.
 */
export interface AuthConfig {
  provider: "supabase";
  /**
   * região do projeto Supabase de auth (ex.: "sa-east-1"). No caso
   * database=supabase, DEVE igualar `database.region` (é o mesmo projeto).
   */
  region: string;
  /** plano ("free" | "pro"); default "free". Projeto auth-only cabe folgado no free. */
  plan?: "free" | "pro";
}

// ── Provedores (nomes/refs, NUNCA secrets) ───────────────────────────────────
/**
 * Armazenamento de mídia — união discriminada por provedor, mesmo padrão do
 * banco plugável (D5). O runtime resolve o adapter por `provider`
 * (`createMediaStorage` em `@cms-core/core/media`); só o que cada provedor
 * precisa aparece no seu ramo.
 */
export type MediaProviderConfig = BunnyMediaConfig | VercelBlobMediaConfig;

export interface BunnyMediaConfig {
  provider: "bunny";
  /** nome da storage zone (globalmente único no Bunny) */
  storageZone: string; // "acme-media"
  /** região primária da storage zone (ex.: "BR", "DE") */
  storageRegion?: string;
  cdnUrl: string; // "https://acme.b-cdn.net"
}

/**
 * Vercel Blob. Não há zona nem CDN a declarar: a URL pública vem do próprio
 * blob e o acesso sai de `BLOB_READ_WRITE_TOKEN` (a Vercel injeta a variável
 * nos deploys do projeto ligado ao store).
 */
export interface VercelBlobMediaConfig {
  provider: "vercel-blob";
  /** nome do store no dashboard da Vercel — documental, não vai para o runtime */
  storeName?: string;
}

export interface EmailProviderConfig {
  provider: "resend";
  /** domínio remetente a verificar (DKIM criado no provisioning) */
  senderDomain: string; // "acme.com"
  fromName?: string; // "Acme CMS"
}

export interface HostingProviderConfig {
  provider: "vercel";
  projectName: string; // "acme-cms"
  /** slug do team Vercel (ausente = conta pessoal do token) */
  teamSlug?: string;
  /** framework preset (fixo p/ este template) */
  framework?: "nextjs";
}

export interface ProvidersConfig {
  /**
   * banco de CONTEÚDO — Supabase Postgres OU Neon (D5). project-ref/keys/URLs
   * vêm do provisioning; aqui só região/plano.
   */
  database: DatabaseConfig;
  /**
   * AUTH — sempre Supabase na v1. No caso database=neon é um projeto Supabase
   * auth-only separado; no caso database=supabase é o mesmo projeto do conteúdo.
   */
  auth: AuthConfig;
  /** Bunny: nome da storage zone + host do CDN (pull zone) a criar */
  media: MediaProviderConfig;
  /** Resend: domínio remetente a verificar (DKIM criado no provisioning) */
  email: EmailProviderConfig;
  /** Vercel: nome do projeto + escopo (team) onde criar */
  hosting: HostingProviderConfig;
}

// ── Locales ──────────────────────────────────────────────────────────────────
export interface LocaleEntry {
  code: string;
  label: string;
}

export interface LocalesConfig {
  default: string; // "pt-BR"
  enabled: LocaleEntry[];
}

// ── Admin inicial ────────────────────────────────────────────────────────────
export interface SeedAdminConfig {
  email: string;
  /**
   * senha NUNCA vai no config. Nome da env var lida no seed (default
   * "SEED_ADMIN_PASSWORD"). O admin troca no 1º login + enrola TOTP.
   */
  passwordEnvVar?: string;
}

// ── Seeds (dados de exemplo opcionais) ───────────────────────────────────────
export interface SeedsConfig {
  enabled: boolean;
  /** caminho de um dataset JSON (por tipo) a inserir como draft após migrate */
  datasetPath?: string;
}

// ── Config raiz ──────────────────────────────────────────────────────────────
export interface ClientConfig {
  /** slug técnico do cliente (kebab-case) — usado em nomes de projeto/pasta */
  slug: string; // "acme"
  displayName: string; // "Acme Corporation"
  /** versão-alvo do @cms-core (SemVer range) fixada no package.json gerado */
  coreVersion: string; // "^1.0.0"

  branding: BrandingConfig;
  domains: DomainsConfig;
  providers: ProvidersConfig;
  locales: LocalesConfig;

  /** as coleções e singletons — a espinha dorsal do schema (D2) */
  collections: CollectionConfig[];

  /** políticas de upload nomeadas, referenciadas por field.uploadField */
  uploadPolicies: Record<string, UploadPolicyConfig>;

  seedAdmin: SeedAdminConfig;
  seeds?: SeedsConfig;
}
