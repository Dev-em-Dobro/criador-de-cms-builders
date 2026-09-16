// @cms-core/core/engine — re-export das classes de erro compartilhadas.
// Fonte única: ../errors.ts (ver nota lá sobre `instanceof`).
export { ConflictError, NotFoundError, AuthError } from "../errors.js";
export type { AuthNext } from "../errors.js";
