// Re-export shim (S1.3b): a lógica mora em @cms-core/core/auth. Mantido no path
// original para os call-sites do cliente não mudarem. Ref: ADR-001 Decisão 1.
export { createSupabaseServerClient as createClient } from "@cms-core/core/auth";
