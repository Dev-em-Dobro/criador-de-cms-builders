// Re-export shim (S1.4): a lógica de dispatch mora em @cms-core/core/webhooks
// (factory `createWebhooks`), instanciada com o db local em `@/lib/core-runtime`.
// Mantido no path original para os call-sites não mudarem. Ref: ADR-001
// Decisão 1 (colaborador injetado).
export { dispatchRevalidation } from "@/lib/core-runtime";
export type { RevalidationEvent } from "@cms-core/core/webhooks";
