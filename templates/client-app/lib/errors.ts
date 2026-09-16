/**
 * Framework-agnostic error types (no next/server import, so tests can use them).
 *
 * S1.3b: as classes agora vivem no core (@cms-core/core/errors) e são
 * RE-EXPORTADAS daqui para preservar a identidade de classe. O motor extraído
 * (guards/entries/users) lança essas MESMAS classes, então `instanceof` em
 * `lib/http.ts` continua funcionando byte-idêntico. Ref: nota em
 * packages/core/src/errors.ts.
 */
export {
  AuthError,
  ConflictError,
  NotFoundError,
  type AuthNext,
} from "@cms-core/core/errors";
