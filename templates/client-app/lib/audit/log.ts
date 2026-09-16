// Re-export shim (S1.4): a lógica de auditoria mora em @cms-core/core/audit
// (factory `createAudit`), instanciada com o db local em `@/lib/core-runtime`.
// Mantido no path original para os ~13 call-sites de `writeAudit`/`listAudit`
// não mudarem. Ref: ADR-001 Decisão 1 (colaborador injetado).
export { writeAudit, listAudit } from "@/lib/core-runtime";
export type { AuditInput, AuditQuery } from "@cms-core/core/audit";
