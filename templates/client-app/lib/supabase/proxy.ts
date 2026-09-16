// Re-export shim (S1.3b): a lógica mora em @cms-core/core/auth. Mantido no path
// original para o middleware (proxy.ts) não mudar. Ref: ADR-001 Decisão 1.
export { updateSupabaseSession as updateSession } from "@cms-core/core/auth";
