export * from "./enums";
export * from "./profiles";
export * from "./content";
// S2.5 (R3) / S3.2 (template): tabelas <type>_facets + `facetPort` GERADOS de
// client.config.ts via gen-facets. Os nomes dos consts variam por cliente
// (ex.: caseFacets), então o re-export é genérico (`export *`) para o
// drizzle-kit e o runtime enxergarem as tabelas + o Port de qualquer config.
export * from "./facets.generated";
export * from "./media";
export * from "./audit";
export * from "./webhooks";
export * from "./locales";
export * from "./leads";
