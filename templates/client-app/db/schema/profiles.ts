// `profiles` é GERADO de client.config.ts (S5.3, gen-profiles) — re-exportado
// daqui para o resto do schema/drizzle-kit o enxergarem no mesmo lugar. O que
// varia entre providers (D5, §13.4) é APENAS a FK `profiles_id_auth_users_fk` →
// auth.users: PRESENTE no caso database=supabase, OMITIDA no caso database=neon
// (UUID espelhado sem FK cross-database). As colunas são idênticas nos dois.
//
// Consumidores (db/schema/content.ts, db/schema/index.ts) importam `profiles`
// deste caminho e NÃO precisam saber do provider — a condicionalidade fica 100%
// contida no arquivo gerado. Mesmo padrão de re-export usado por `enums.ts`
// (contentTypeEnum) e `facets.generated.ts`.
export * from "./profiles.generated";
