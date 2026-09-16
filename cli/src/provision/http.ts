// @cms-core/cli — HTTP client injetável (Fase 4, §7.3).
//
// O princípio de mockabilidade da Fase 4: cada adapter recebe um HttpClient por
// injeção. Em produção usa `fetch` real (FetchHttpClient); nos testes injeta-se
// um FakeHttpClient que registra as chamadas e devolve respostas canned — assim
// TODO o provisionamento é testável sem tokens nem rede.

export interface HttpRequest {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  /** corpo já serializável (objeto → JSON). */
  body?: unknown;
}

export interface HttpResponse {
  status: number;
  /** corpo parseado (JSON) quando aplicável; senão texto/undefined. */
  body: unknown;
  headers: Record<string, string>;
}

export interface HttpClient {
  request(req: HttpRequest): Promise<HttpResponse>;
}

/** Erro HTTP "duro" (status >= 400) que os adapters propagam ao orquestrador. */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** Cliente real baseado em `fetch` (Node 18+). Usado só em produção. */
export class FetchHttpClient implements HttpClient {
  async request(req: HttpRequest): Promise<HttpResponse> {
    const res = await fetch(req.url, {
      method: req.method,
      headers: {
        "content-type": "application/json",
        ...(req.headers ?? {}),
      },
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
    });
    const text = await res.text();
    let body: unknown = text;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k] = v;
    });
    return { status: res.status, body, headers };
  }
}

// ── Fake para testes ─────────────────────────────────────────────────────────

/** Uma chamada registrada pelo FakeHttpClient (para asserts nos testes). */
export interface RecordedCall extends HttpRequest {
  at: number;
}

/**
 * Resposta canned resolvida por um matcher `(req) => HttpResponse | undefined`.
 * O primeiro handler que retornar não-undefined vence. Se nenhum casar, o fake
 * responde 404 (permite testar caminhos "recurso não existe → cria").
 */
export type FakeHandler = (req: HttpRequest) => HttpResponse | undefined;

export class FakeHttpClient implements HttpClient {
  readonly calls: RecordedCall[] = [];
  private readonly handlers: FakeHandler[] = [];
  private seq = 0;

  constructor(handlers: FakeHandler[] = []) {
    this.handlers = [...handlers];
  }

  /** Adiciona um handler (avaliado na ordem de inserção). */
  on(handler: FakeHandler): this {
    this.handlers.push(handler);
    return this;
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    this.calls.push({ ...req, at: this.seq++ });
    for (const h of this.handlers) {
      const res = h(req);
      if (res !== undefined) return res;
    }
    return { status: 404, body: { error: "fake: no handler" }, headers: {} };
  }

  /** Todas as chamadas cujo método+url casam (útil para asserts de ordem). */
  callsMatching(pred: (c: RecordedCall) => boolean): RecordedCall[] {
    return this.calls.filter(pred);
  }
}

/** Helper para montar respostas canned nos testes. */
export function json(status: number, body: unknown): HttpResponse {
  return { status, body, headers: { "content-type": "application/json" } };
}
