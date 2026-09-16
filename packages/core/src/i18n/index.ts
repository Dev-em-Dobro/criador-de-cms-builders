// @cms-core/core/i18n — barrel (S1.4).
//
// Pure helpers (translations, locale-rules) exportados diretamente; a factory
// DB-backed de locales via `createLocales`.

export * from "./translations.js";
export * from "./locale-rules.js";
export {
  createLocales,
  type I18nDeps,
  type I18nSchema,
  type ServiceResult as LocaleServiceResult,
  type Locale,
} from "./locales.js";
export * as i18nSchemaShape from "./schema-shape.js";
