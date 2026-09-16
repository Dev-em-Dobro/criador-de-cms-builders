// @cms-core/core/errors — tipos de erro framework-agnósticos, compartilhados
// pelos módulos engine e auth (S1.3b).
//
// FONTE ÚNICA DE VERDADE das classes de erro. O cliente (`lib/errors.ts`)
// RE-EXPORTA daqui para que `instanceof AuthError/ConflictError/NotFoundError`
// funcione em TODO lugar — inclusive nos catch-blocks de `lib/http.ts` que
// mapeiam erros lançados pelo motor extraído para respostas HTTP. Se o core
// definisse classes distintas das do cliente, o `instanceof` falharia e os
// status codes regrediriam (401/403/404/409 → 500). Espelha exatamente o
// `lib/errors.ts` original do Demo Corp.

/**
 * `next` indica para onde mandar o usuário em vez de dar dead-end: "mfa" quando
 * um fator existe mas não foi satisfeito nesta sessão, "enrol" quando nenhum
 * fator existe ainda.
 */
export type AuthNext = "mfa" | "enrol";

export class AuthError extends Error {
  constructor(
    public status: number,
    message: string,
    public next?: AuthNext,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export class ConflictError extends Error {
  constructor(
    message = "Edit conflict — the entry changed since you loaded it",
  ) {
    super(message);
    this.name = "ConflictError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}
