# Feature candidata: Config-from-URL / Introspecção de Site

> **STATUS: FEATURE CANDIDATA — NÃO DECIDIDA.** Este é um brief de viabilidade + design de
> alto nível, produzido por @architect (Aria). **Não é uma story, não é backlog aprovado, e não
> autoriza implementação.** A feature é **POSTERIOR à fábrica core** (Fases 2–5): ela só faz
> sentido depois que o resto do pipeline consome um `ClientConfig` de forma confiável, porque o
> que ela produz é exatamente um `ClientConfig`. Ver §6 (posicionamento no roadmap) e a ressalva
> em §7 (por que NÃO antecipar).
>
> Autor: @architect (Aria) · Data: 2026-08-03 · Ancorado em: `packages/core/src/config/types.ts`
> (contrato), `templates/config-examples/demo-corp.config.ts` (baseline/alvo), read API +
> webhooks do cliente-modelo (superfície de "conectar no site").

---

## 0. Sumário executivo (uma tela)

**O que o dono pediu:** "Mando o link do site do cliente, o gerador me pergunta quais seções
gerenciar, cria essas seções no CMS e conecta no site."

**O que isso é, em termos da fábrica:** uma **nova frente de AUTORIA** que emite um `ClientConfig`
válido a partir de um site existente — introspecção do site → inferência de coleções/singletons +
campos (mapeados aos 10 `FieldKind` reais) → seleção interativa ("quais seções gerenciar?") →
geração de um **rascunho de `client.config.ts`** → orientação de "conectar no site". O resto da
fábrica (codegen Fase 2, CLI Fase 3, provisionamento Fase 4/5) **não muda**: a feature é upstream do
pipeline, produz o mesmo artefato que hoje é escrito à mão.

**As 3 verdades incômodas que este brief defende:**

1. **A inferência é um RASCUNHO, nunca verdade.** O output é sempre um config a revisar por humano.
   Vender "manda o link e está pronto" seria desonesto — sites reais são caóticos demais. O valor real
   é economizar 60–80% do trabalho de digitação, não 100%.

2. **"Conectar no site" auto-mágico é INVIÁVEL para sites arbitrários.** O CMS é headless; o site do
   cliente tem codebase desconhecido. Não dá para reescrever o site de forma segura. O escopo realista
   é **gerar um SDK tipado da read API + um mapa de campos + o setup de revalidação** para o dev do site
   plugar (opção A abaixo). Auto-rewrite (opção C) é uma armadilha.

3. **Importar conteúdo real (seed) é uma feature SEPARADA, muito mais cara e arriscada** que criar as
   seções (schema). Recomendação: **fazer schema-first agora (candidato), conteúdo-seed depois** (fase
   própria, se houver demanda), porque a fidelidade de raspagem de richtext/mídia é onde a coisa
   desanda.

**Recomendação de posicionamento:** **Fase 6 potencial — "Config-from-URL / Site Introspection"**,
depois das Fases 2–5. Não abrir stories detalhadas agora (é candidata). Ver §6.

---

## 1. Por que a fábrica já está bem posicionada para isso

A boa notícia arquitetural: **o contrato de autoria já existe e já é o único gargalo do pipeline.**

- `ClientConfig` (`packages/core/src/config/types.ts`) é a **fonte única** do schema (D2). Todo o
  codegen (enum/Zod/Drizzle/migrations/UI/tema/nav) deriva dele. Isso significa que **qualquer**
  produtor de um `ClientConfig` válido — escrito à mão, gerado por CLI, ou inferido de um site — se
  encaixa sem tocar no resto.
- O baseline `demo-corp.config.ts` mostra o **alvo concreto e realista** que a inferência precisa
  produzir: 9 coleções/singletons, ~63 campos, com nuances (`default:""` vs `.optional()`, `trim/dedup`,
  `itemShape`, `uiHidden`, `validate.custom`, `facets`, `uploadPolicies`). Isso é o **teto de
  ambição** — e deixa claro por que a inferência automática nunca vai acertar 100% (ver §5.2).
- O validador (`validate.ts`) já é o **gate de qualidade**: qualquer rascunho inferido passa pelo
  mesmo `validateClientConfig` antes de virar código. Config inválido nunca chega ao codegen.

**Consequência de design:** a feature Config-from-URL é uma camada **aditiva e desacoplada**. Ela não
precisa (e não deve) modificar `packages/core`. Vive num workspace/pacote próprio (ex.:
`@cms-core/introspect`, private), consome `ClientConfig` como *tipo de saída*, e reusa `validateClientConfig`
como oráculo. Zero coupling com o core — alinhado ao princípio "expansion packs independentes".

---

## 2. Fluxo end-to-end da feature

```
(a) INPUT           operador informa a URL do site do cliente (+ opções)
      │
      ▼
(b) INTROSPECÇÃO    fetch/render do site → detectar coleções, singletons, campos
      │             → mapear para FieldKind reais → gerar candidatos com CONFIANÇA
      ▼
(c) SELEÇÃO         "quais dessas seções você quer gerenciar?" (interativo)
      │             + revisar/renomear campos, ajustar kinds, marcar required
      ▼
(d) GERAÇÃO         emitir client.config.ts (RASCUNHO) → validateClientConfig → gate
      │             operador revisa/edita o TS (fonte única, humano no comando)
      ▼
(e) CONECTAR        gerar SDK tipado + mapa de campos + doc de revalidação
                    para o dev do site plugar (NÃO auto-rewrite)
```

### (a) Input do link
- Entrada mínima: `introspect <url>` (ex.: `https://www.cliente.com`).
- Opções úteis: `--pages url1,url2` (semear com páginas específicas que representam cada seção — um
  case, um post, uma pessoa), `--max-pages N`, `--render` (usar browser headless p/ SPA), `--llm` (ligar
  inferência assistida por LLM), `--auth` (cookies/header p/ áreas logadas — desencorajado, ver riscos).
- O operador **aponta exemplos** é o atalho mais valioso: em vez de o crawler adivinhar o que é uma
  "coleção", o operador dá o link de *um* case e o sistema generaliza a estrutura repetida.

### (b) Análise/introspecção — o coração técnico

O objetivo é preencher o `ClientConfig`: **coleções** (estruturas repetidas), **singletons** (páginas
únicas), e **campos** por seção (mapeados aos 10 `FieldKind`).

**Detecção de coleções (estruturas repetidas):** uma coleção é um padrão que se repete — lista de
cases, grid de posts, cards de pessoas. Sinais:
- URLs seguindo um template (`/cases/:slug`, `/blog/:slug`, `/team/:slug`) — o sinal mais forte.
- Blocos DOM repetidos com a mesma estrutura (N cards irmãos com mesma árvore) → item de coleção.
- Presença de sitemap.xml / RSS / JSON-LD (`schema.org` `Article`, `Person`, `Product`) — **ouro puro**,
  porque já traz campos rotulados semanticamente.

**Detecção de singletons (páginas únicas):** páginas sem irmãos repetidos e sem padrão de slug
(`/sobre`, `/contato`, `/privacidade`) → singleton. Mapeiam para `singleton: true` + `singletonRoutes`.

**Inferência de campos → FieldKind:** para cada seção, inferir campos e mapear ao vocabulário real do
contrato:

| Sinal no site | FieldKind inferido | Notas |
|---|---|---|
| `<h1>`/`<title>` do item | `text` (`required: true`) | title quase sempre required |
| parágrafo curto sem markup | `textarea` | quote, excerpt |
| bloco com `<p>/<ul>/<strong>` (HTML rico) | `richtext` | corpo/bio — **fonte de erro alta** (§5.2) |
| `<img>` / `<picture>` / og:image | `media` (+ `uploadField`) | precisa política de upload inferida ou default |
| `<time>` / data ISO / "Publicado em" | `date` | |
| `<a href>` externo | `url` (+ `validate.custom` p/ youtube) | |
| `mailto:` | `email` | |
| lista de chips/badges (tags) | `stringList` (`trim/dedup`) | |
| grupos de filtro repetidos (indústria, região) | `facets` + `FacetConfig` | detectável se o site tem UI de filtro |
| bloco estruturado repetido dentro do item (timeline, awards) | `json` + `itemShape` | difícil; rebaixar p/ revisão manual |

**LLM-assistido vs heurística de DOM — recomendação HÍBRIDA:**

- **Heurística de DOM (determinística):** boa e barata para o *esqueleto* — descobrir slugs repetidos,
  contar irmãos, achar sitemap/JSON-LD, extrair `<img>/<time>/<a>`. Alta precisão em sinais estruturais,
  zero custo por site, reproduzível. **Ruim** para semântica ("este `<div>` é um 'quote' ou uma
  'introduction'?") e para nomear campos de forma amigável.
- **LLM-assistido:** manda o HTML **limpo/reduzido** (ou o texto renderizado + estrutura) de *uma* página
  de exemplo por seção e pede: "quais campos gerenciáveis existem aqui, com nome/kind/required?". Excelente
  em nomear campos, distinguir richtext de textarea, propor labels PT/EN. **Ruim** em determinismo (mesmo
  input → outputs variáveis), custo por site, e tende a **inventar** campos que não existem (viola
  Artigo IV — No Invention — se o output não for tratado como rascunho revisável).
- **Recomendação:** **híbrido — heurística faz o esqueleto (coleções/slugs/mídia/datas), LLM refina a
  camada semântica (nomes, kinds ambíguos, required), e TUDO sai com score de confiança** para a etapa
  (c). A heurística ancora (evita alucinação estrutural); o LLM humaniza (evita config feio). Nunca deixar
  o LLM ser a única fonte de verdade estrutural.

**Sites JS-heavy / SPA:** um `fetch` do HTML cru falha se o conteúdo é renderizado no cliente (React/Vue
SPA). Estratégia em camadas:
1. Tentar HTML estático + sitemap/JSON-LD/RSS primeiro (barato, cobre a maioria dos sites institucionais e
   os que usam SSR/Next).
2. Se o HTML vier "vazio" (só o shell do app), **cair para render headless** (Playwright — já é MCP
   disponível no projeto) para obter o DOM hidratado.
3. **Atalho de ouro:** muitos SPAs têm uma **API/JSON por trás** (`/api/...`, `_next/data`, GraphQL).
   Detectá-la e ler o JSON estruturado é *muito* mais fiel que raspar DOM. Vale procurar.
4. Se nada funcionar (conteúdo atrás de auth, anti-bot agressivo), **degradar graciosamente**: gerar um
   config-esqueleto vazio e deixar o operador preencher — melhor que um config errado com falsa confiança.

### (c) Seleção interativa das seções
- Apresentar as seções candidatas com confiança e uma amostra: *"Detectei uma coleção `case` (12
  itens, confiança alta) com campos: title, quote, image, body. Gerenciar? [S/n]"*.
- Permitir: incluir/excluir seção, renomear `type`/`label`, ajustar `segment`, marcar `singleton`,
  editar cada campo (kind, required, label, `uploadField`).
- Isto é o "quais daquelas seções serão gerenciadas" do pedido — o ponto de controle humano central.

### (d) Geração do `ClientConfig` (com confiança + revisão humana)
- Emitir um `client.config.ts` **comentado**, marcando cada campo de baixa confiança com um
  `// TODO(revisar): ...` para o operador conferir. O output é um **rascunho**, não verdade.
- Rodar `validateClientConfig` imediatamente. Se falhar (facet órfão, kind inválido, nome dup), reportar
  e reabrir a edição. **Nada inválido chega ao codegen.**
- A partir daqui, o fluxo é **idêntico ao de hoje**: o operador revisa o TS (fonte única, D2), e o
  codegen da Fase 2 / CLI da Fase 3 assumem. A feature termina no artefato.

### (e) Conectar no site
Ver §3 — é a parte difícil e merece seção própria.

---

## 3. "Conectar no site" — a parte difícil, com honestidade

**O fato duro:** o CMS gerado é **headless**. Ele publica conteúdo por uma **read API autenticada por
chave** (endpoints `GET /api/content/<segment>` e `/<segment>/<slug>`, paginados, com filtro por facet — ver
`clients/demo-corp/app/api/content/*`) e dispara **webhooks de revalidação assinados por HMAC** quando
algo é publicado (`packages/core/src/webhooks/dispatch.ts`). O site do cliente é um **codebase arbitrário e
desconhecido** (WordPress? Next? Webflow? HTML estático? React SPA custom?). "Conectar" = fazer esse site
consumir a read API e reagir aos webhooks — e isso depende inteiramente da tecnologia do site.

### Opção A — SDK tipado + mapa de campos + setup de revalidação (RECOMENDADA)
Gerar, a partir do `ClientConfig`, um **pacote/cliente entregável** ao dev do site:
- **SDK tipado da read API** — funções `getCases()`, `getCase(slug)`, `getPage('about')` etc., com tipos
  derivados das coleções do config, que já sabem a base URL, mandam o `x-api-key` (`READ_API_KEY`), fazem
  paginação e filtro de facet. É determinístico: a read API e o shape do config são conhecidos.
- **Mapa de campos → site** — um doc gerado que lista, por seção, os campos do CMS e uma coluna vazia
  *"onde isso aparece no seu site (seletor/componente/rota)"* para o dev preencher. É o handoff humano
  honesto.
- **Setup de revalidação** — um endpoint-exemplo (`POST /api/revalidate`) que verifica a assinatura HMAC
  (`WEBHOOK_SIGNING_KEY`) e chama o mecanismo de cache-bust do framework do site, + a instrução de
  registrar esse endpoint como `webhook_endpoint` no CMS.
- **Trade-off:** exige um dev tocando o site (não é 100% automático), mas é **seguro, determinístico e
  funciona para qualquer site**. É o único escopo que eu recomendo prometer.

### Opção B — Adaptadores por framework (Next.js primeiro)
Para frameworks conhecidos (começando por **Next.js**, que é o stack do próprio CMS), gerar não só o SDK
mas os **data-fetchers prontos** (Server Components / `fetch` com tags de cache) e o **route handler de
revalidação** (`revalidateTag`/`revalidatePath`) já cabeados. Reduz bastante o trabalho manual **quando o
site é daquele framework**.
- **Trade-off:** alto valor, mas **por-framework** — cada adaptador é esforço dedicado e cobre só uma
  fatia dos sites. Bom como **evolução da Opção A** (A é o piso universal; B é aceleração onde compensa).
  Recomendo Next.js como o único adaptador de v1, porque é onde a agência tem mais fluência e onde o
  risco é menor.

### Opção C — Auto-reescrever o site (NÃO recomendada)
Tentar editar o codebase do site do cliente para injetar os fetchers.
- **Por que é inviável/perigosa:** codebase arbitrário e desconhecido; risco de quebrar o site em
  produção; impossível testar de forma segura sem o ambiente do cliente; superfície de bug/responsabilidade
  enorme; falha silenciosa provável em qualquer stack fora do esperado. **Não fazer.** O ganho marginal
  sobre a Opção B não justifica o risco.

**Recomendação:** **Opção A como piso universal + Opção B (só Next.js) como acelerador.** Prometer
"conectar" = "geramos o SDK + o mapa + o setup de revalidação; o dev do site pluga". Nunca prometer
auto-conexão mágica.

---

## 4. Importar conteúdo existente? (ponto em aberto)

Duas ambições muito diferentes de custo:

- **Schema-only (criar as seções):** gerar as coleções/campos vazias no CMS. É o núcleo do pedido e o
  escopo natural da feature. Risco: inferência (tratável, é rascunho).
- **Content-seed (raspar e semear os itens reais):** além do schema, extrair os *dados* de cada item do
  site e inserir no CMS como drafts (usando `seeds.datasetPath` que o contrato já prevê).

**Por que o seed é muito mais caro/arriscado:**
- **Fidelidade de richtext:** converter HTML arbitrário do site para o richtext sanitizado do CMS
  (Quill + sanitize-html, iframe só YouTube) perde formatação, quebra embeds, gera lixo. É o pior offender.
- **Mídia:** baixar cada imagem, reenviar ao Bunny respeitando as `uploadPolicies` (formatos, alpha,
  aspect ratio), e religar os `logoMediaId`/`coverMediaId` — pipeline inteiro por si só.
- **Relações e slugs:** manter slugs, ligar pessoa↔região↔case, resolver facets — frágil.
- **Legal/qualidade:** raspar conteúdo em massa amplifica os riscos de scraping (§5) e o risco de semear
  dados errados que parecem certos.

**Recomendação:** **Schema-first agora (feature candidata); content-seed é uma fase POSTERIOR e própria,
só se houver demanda real.** E, se for feito, **sempre como draft revisável, com um "import de 1 item
piloto" antes do lote** — o operador valida a fidelidade num item, aí libera o resto. Não acoplar seed ao
MVP da feature.

---

## 5. Riscos e viabilidade

| # | Risco | Sev. | Mitigação |
|---|-------|------|-----------|
| R1 | **Variabilidade de sites** — cada site é diferente; heurísticas quebram | Alta | Híbrido heurística+LLM; operador aponta páginas-exemplo; degradar p/ esqueleto vazio quando incerto |
| R2 | **Precisão da inferência LLM** — alucina campos, não-determinístico | Alta | Output SEMPRE rascunho revisável (Artigo IV); heurística ancora estrutura; score de confiança + `TODO(revisar)`; `validateClientConfig` como gate |
| R3 | **Conteúdo dinâmico / SPA / paginação** — HTML cru vem vazio | Média | Render headless (Playwright); detectar API/JSON por trás; seguir sitemap/RSS p/ paginação |
| R4 | **Legal de scraping** — ToS, robots.txt, dados de terceiros | Média | **É o site DO PRÓPRIO CLIENTE** (autorizado por natureza — a agência está migrando o cliente); ainda assim respeitar robots.txt, rate-limit, e registrar consentimento do operador |
| R5 | **Áreas logadas / auth** — conteúdo atrás de login | Baixa | Fora do escopo v1; `--auth` desencorajado; a maioria do conteúdo institucional gerenciável é público |
| R6 | **Falsa confiança** — operador confia cego no rascunho | Média | UX que enfatiza "rascunho a revisar"; marcar baixa confiança; exigir confirmação por seção |
| R7 | **Acoplamento acidental ao core** — feature vazar pra `packages/core` | Média | Manter em pacote próprio (`@cms-core/introspect`); consumir `ClientConfig` só como tipo de saída; reusar `validateClientConfig` sem estendê-lo |
| R8 | **`itemShape`/`facets`/`uploadPolicies` mal inferidos** — nuances do gold-standard | Média | Rebaixar esses p/ revisão manual assistida (não tentar automatizar 100%); pré-preencher defaults conservadores |

**Verdade de viabilidade:** a feature é **viável e valiosa como acelerador de autoria** (economiza a
digitação e o mapeamento inicial), **NÃO como automação total**. O output é sempre um rascunho que passa
pelo mesmo gate de validação do config escrito à mão. Vender além disso seria prometer o que sites reais
não permitem entregar.

---

## 6. Posicionamento no roadmap — Fase 6 potencial

**Dependência dura:** a feature **emite um `ClientConfig`** — o mesmo artefato que a Fase 0 definiu e que
as Fases 2–5 consomem. Logo, ela só entrega valor **depois** que:
- Fase 2 (codegen) transforma config → artefatos de forma confiável;
- Fase 3 (CLI `create-client`) scaffolda um cliente a partir do config;
- Fases 4–5 (provisionamento + banco plugável) tornam o cliente deployável.

Sem esse pipeline funcional, gerar um config a partir de uma URL produz um artefato que ninguém consome.
Portanto: **Fase 6 — "Config-from-URL / Site Introspection"**, estritamente posterior.

**Esboço de épicas/stories de alto nível (NÃO detalhar agora — é candidata):**

- **E6.1 Introspecção estrutural (heurística):** crawler + sitemap/JSON-LD/RSS + detecção de
  coleções/singletons/campos determinística → candidatos com confiança. Render headless p/ SPA.
- **E6.2 Refino semântico (LLM-assistido):** enviar exemplo por seção, refinar nomes/kinds/required,
  merge com E6.1, score de confiança combinado.
- **E6.3 Seleção interativa + emissão do `client.config.ts`:** UX de "quais seções gerenciar", edição de
  campos, geração do TS comentado, gate `validateClientConfig`.
- **E6.4 Conectar no site (Opção A):** gerador de SDK tipado da read API + mapa de campos + setup de
  revalidação HMAC. (Opção B / adaptador Next.js = evolução opcional.)
- **E6.5 (futura, condicional) Content-seed:** raspagem de itens → `seeds.datasetPath` como drafts, com
  import-piloto de 1 item. Só se houver demanda.

**Ressalva de sequência (importante):** esta feature **não deve antecipar nem atrapalhar a Fase 2**. A
Fase 2 (codegen) é o caminho crítico atual; abrir trabalho de introspecção agora competiria por atenção
com o que destrava o resto. Config-from-URL é aditivo, desacoplado, e espera sua vez.

---

## 7. Pontos de decisão para o dono (levar para conversa)

Cada ponto tem uma recomendação de @architect. São decisões de **produto/escopo**, não de implementação.

### D-A — Escopo de "conectar no site"
- **Opções:** (A) SDK tipado + mapa de campos + setup de revalidação [dev pluga]; (B) adaptadores por
  framework (Next.js) que geram os data-fetchers; (C) auto-reescrever o site.
- **Recomendação:** **A como piso universal + B só para Next.js como acelerador. Descartar C** (inviável
  p/ sites arbitrários; risco de quebrar produção). Prometer "geramos o cliente + o mapa + a revalidação",
  não "conectamos sozinhos".

### D-B — Importar conteúdo existente (seed)?
- **Opções:** só schema (criar seções) · schema + seed dos itens reais · seed depois.
- **Recomendação:** **Schema-first agora; seed é fase posterior e condicional.** A fidelidade de
  richtext/mídia é onde o seed vira dívida. Se fizer, sempre draft + import-piloto de 1 item antes do lote.

### D-C — Método de análise
- **Opções:** heurística de DOM pura · LLM puro · híbrido.
- **Recomendação:** **Híbrido — heurística ancora a estrutura (determinística, sem alucinação), LLM refina
  a semântica (nomes/kinds/required), tudo com score de confiança e output sempre rascunho.** Nunca LLM
  como única fonte de verdade estrutural.

### D-D — Interface: CLI interativa vs UI
- **Opções:** CLI interativa (coerente com D3 travada — operador técnico, sem UI web) · UI web.
- **Recomendação:** **CLI interativa** (`introspect <url>`), consistente com a decisão travada **D3
  (Interface = CLI, sem UI web)**. Uma UI é escopo grande e reabriria D3 — não justificado para uma feature
  candidata. Manter no mesmo paradigma do `create-client`.

---

## 8. Nota de conformidade (Constitution / decisões travadas)

- **Artigo IV (No Invention):** o output inferido é rascunho revisável e passa por `validateClientConfig`;
  nenhum campo entra no schema sem revisão humana — a inferência propõe, o humano confirma.
- **D2 (schema fixo na criação):** a feature respeita — ela produz o `client.config.ts` (fonte única);
  não introduz coleções em runtime.
- **D3 (Interface = CLI):** recomendação D-D mantém CLI; UI reabriria a trava.
- **Zero coupling:** a feature vive em pacote próprio, não modifica `packages/core`, consome `ClientConfig`
  como tipo de saída e reusa o validador como oráculo.
- **Precede-nada:** é estritamente posterior às Fases 2–5; não compete com o caminho crítico atual.
