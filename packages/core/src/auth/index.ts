// @cms-core/core/auth — barrel de re-exports do módulo de autenticação (S1.3b).

export * from "./errors.js";
export * from "./di.js";
export { createAuthGuards } from "./guards.js";
export {
  createPreviewToken,
  verifyPreviewToken,
} from "./session.js";
// Factories de cliente Supabase (cada uma cria uma nova instância por uso).
export { createClient as createSupabaseBrowserClient } from "./supabase-client.js";
export { createClient as createSupabaseServerClient } from "./supabase-server.js";
export { createAdminClient as createSupabaseAdminClient } from "./supabase-admin.js";
export { updateSession as updateSupabaseSession } from "./supabase-proxy.js";
