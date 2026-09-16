import { z } from "zod";
import { youtubeField } from "./youtube.js";

/** Canonical content types (mirror db enum contentTypeEnum). */
export const CONTENT_TYPES = [
  "case",
  "solution",
  "person",
  "region",
  "insight",
  "page_5h",
  "page_book",
  "page_awards",
  "page_legal",
] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

/**
 * Optional social/contact fields. The admin form sends "" for a blank input, so
 * treat empty as "not provided" before format-checking — a blank field must
 * never block a save.
 */
const optionalUrl = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.url().optional(),
);
const optionalEmail = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.email().optional(),
);

/**
 * Structured tag list (FR-817). Trims each tag, drops blanks, de-duplicates, and
 * defaults to an empty array — so the read API's tag filter always gets clean,
 * consistent values regardless of how the author entered them.
 */
const tagsField = z.preprocess(
  (v) =>
    Array.isArray(v)
      ? [...new Set(v.map((t) => String(t).trim()).filter(Boolean))]
      : v,
  z.array(z.string()).default([]),
);

/** Brand colour as a 6-digit hex string (FR-804). Blank input = not provided. */
const brandColorField = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Must be a 6-digit hex colour like #1a2b3c")
    .optional(),
);

// ---------------------------------------------------------------------------
// Per-type field schemas (validate content_entries.data). Required fields are
// enforced here and checked at publish time (FR-006/FR-007).
// ---------------------------------------------------------------------------

export const caseSchema = z.object({
  tags: tagsField,
  title: z.string().min(1),
  quote: z.string().default(""),
  quoter: z.string().default(""),
  mutedVideoUrl: optionalUrl,
  introduction: z.string().default(""),
  text: z.string().default(""),
  // Branding (FR-804/805/806): brand colour + transparent-PNG logo. Both optional
  // — the site has a fallback and only builds the branded card when present.
  brandColor: brandColorField,
  logoMediaId: z.uuid().optional(),
  // External YouTube reference (FR-801/802/803).
  youtube: youtubeField,
});

export const solutionSchema = z.object({
  title: z.string().min(1),
  bannerMediaId: z.uuid().optional(),
  problemStatement: z.string().min(1),
  body: z.string().default(""),
});

export const personSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  bio: z.string().min(1),
  photoMediaId: z.uuid().optional(),
  regionSlug: z.string().optional(),
  linkedin: optionalUrl,
  instagram: optionalUrl,
  facebook: optionalUrl,
  x: optionalUrl,
  email: optionalEmail,
});

export const regionSchema = z.object({
  name: z.string().min(1),
  city: z.string().min(1),
  country: z.string().default(""),
  summary: z.string().default(""),
  addressLines: z.array(z.string()).default([]),
});

export const insightSchema = z.object({
  tags: tagsField,
  title: z.string().min(1),
  author: z.string().default(""),
  excerpt: z.string().default(""),
  body: z.string().min(1),
  coverMediaId: z.uuid().optional(),
  publishedDate: z.string().optional(),
  youtube: youtubeField,
});

export const page5hSchema = z.object({
  title: z.string().min(1),
  intro: z.string().default(""),
  elements: z
    .array(
      z.object({
        key: z.string().min(1),
        title: z.string().min(1),
        description: z.string().default(""),
      }),
    )
    .default([]),
  ctaLabel: z.string().optional(),
  ctaHref: z.string().optional(),
  youtube: youtubeField,
});

export const pageBookSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  coverMediaId: z.uuid().optional(),
  purchaseUrl: z.url(),
  youtube: youtubeField,
});

export const pageAwardsSchema = z.object({
  title: z.string().min(1),
  items: z
    .array(
      z.object({
        name: z.string().min(1),
        year: z.string().optional(),
        logoMediaId: z.uuid().optional(),
      }),
    )
    .default([]),
});

export const pageLegalSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Schemas + toListItem behaviors por tipo (gold-standard).
//
// ADR-002 §1: o REGISTRY deixou de ser um singleton de módulo aqui — é montado
// no cliente (`lib/core-runtime.ts`) a partir do config e injetado em
// `createEngine` como `deps.registry`. `validateContent`/`defForType`/
// `resolveTypeParam`/`SEGMENT_TO_TYPE`/`SINGLETON_PAGES` viraram métodos do motor
// instanciado (ver `engine/di.ts`). Este arquivo mantém só os SCHEMAS + os
// COMPORTAMENTOS (schema/toListItem) que o cliente injeta — o gold-standard REAL,
// não recodificado (MUST-DO @po: `toListItem` não inventado).
// ---------------------------------------------------------------------------

/** Map de schema por tipo — usado pelo cliente ao montar os behaviors. */
export const SCHEMAS: Record<
  ContentType,
  z.ZodType<Record<string, unknown>>
> = {
  case: caseSchema as unknown as z.ZodType<Record<string, unknown>>,
  solution: solutionSchema as unknown as z.ZodType<Record<string, unknown>>,
  person: personSchema as unknown as z.ZodType<Record<string, unknown>>,
  region: regionSchema as unknown as z.ZodType<Record<string, unknown>>,
  insight: insightSchema as unknown as z.ZodType<Record<string, unknown>>,
  page_5h: page5hSchema as unknown as z.ZodType<Record<string, unknown>>,
  page_book: pageBookSchema as unknown as z.ZodType<Record<string, unknown>>,
  page_awards: pageAwardsSchema as unknown as z.ZodType<Record<string, unknown>>,
  page_legal: pageLegalSchema as unknown as z.ZodType<Record<string, unknown>>,
};

export interface ListItem {
  title: string;
  summary?: string;
  coverMediaId?: string;
  tags?: string[];
}

/** Título/summary genérico (case/solution/insight/pages) — gold-standard. */
export function titleSummary(data: Record<string, unknown>): ListItem {
  return {
    title: String(data.title ?? data.name ?? "Untitled"),
    summary:
      typeof data.summary === "string"
        ? data.summary
        : typeof data.excerpt === "string"
          ? data.excerpt
          : undefined,
    coverMediaId:
      typeof data.coverMediaId === "string" ? data.coverMediaId : undefined,
    // Surface tags on list items so the site can filter/badge without a detail
    // fetch. Only case/insight carry them; other types simply omit the field.
    tags: Array.isArray(data.tags) ? (data.tags as string[]) : undefined,
  };
}

/** toListItem específico de `person` (name/role/photoMediaId) — gold-standard. */
export function personListItem(d: Record<string, unknown>): ListItem {
  return {
    title: String(d.name ?? "Unnamed"),
    summary: typeof d.role === "string" ? d.role : undefined,
    coverMediaId:
      typeof d.photoMediaId === "string" ? d.photoMediaId : undefined,
  };
}

/** toListItem específico de `region` (name/city) — gold-standard. */
export function regionListItem(d: Record<string, unknown>): ListItem {
  return {
    title: String(d.name ?? "Region"),
    summary: typeof d.city === "string" ? d.city : undefined,
  };
}

/**
 * Mapa de `toListItem` por tipo — o gold-standard REAL (não inventado). O
 * cliente injeta estes ao montar o `RegistryBundle` no `core-runtime.ts`. Tipos
 * não listados usam `titleSummary`.
 */
export const TO_LIST_ITEM: Record<
  string,
  (data: Record<string, unknown>) => ListItem
> = {
  person: personListItem,
  region: regionListItem,
};

export function isContentType(v: string): v is ContentType {
  return (CONTENT_TYPES as readonly string[]).includes(v);
}

export interface ValidationResult {
  ok: boolean;
  data?: Record<string, unknown>;
  /** field path -> message */
  errors?: Record<string, string>;
}

/** Extract the case facet columns from a validated case payload. */
export function extractCaseFacets(data: Record<string, unknown>) {
  const f = (data.facets ?? {}) as Record<string, string[] | undefined>;
  return {
    industry: f.industry ?? [],
    service: f.service ?? [],
    regionSlugs: f.region ?? [],
    outcome: f.outcome ?? [],
  };
}
