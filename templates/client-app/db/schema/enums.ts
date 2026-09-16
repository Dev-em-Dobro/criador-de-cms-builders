import { pgEnum } from "drizzle-orm/pg-core";

// contentTypeEnum é GERADO de client.config.ts (S2.3, gen-enums) — re-exportado
// daqui para o resto do schema/drizzle-kit o enxergarem no mesmo lugar. Os
// demais enums (role/user_status/content_status) são do core, não variam por
// cliente → permanecem estáticos aqui.
export { contentTypeEnum } from "./enums.generated";

export const roleEnum = pgEnum("role", ["admin", "editor"]);

export const userStatusEnum = pgEnum("user_status", [
  "active",
  "invited",
  "disabled",
]);

export const contentStatusEnum = pgEnum("content_status", [
  "draft",
  "published",
  "archived",
]);
