# Arquitetura da Fábrica de CMS (`criador-de-cms`)

> **Autor:** Aria (Architect / AIOX)
> **Data:** 2026-08-01 (atualizado 2026-08-01 com as 4 decisões travadas; novamente 2026-08-01 com **D5 — banco de conteúdo plugável Supabase/Neon**; e **revisado 2026-08-03 — D1 revertida para MONOREPO** com workspaces `workspace:*`, ver Changelog no fim do documento)
> **Status:** Arquitetura definitiva nas 5 dimensões travadas (isolamento, schema, interface, infra, banco plugável). Backlog de implementação detalhado. **Nenhum código implementado ainda além do `packages/core` da Fase 0.**
> **Projeto fábrica:** este repositório.
> **CMS-modelo (base):** o CMS de onde o `packages/core` foi extraído — referido aqui como **Demo Corp CMS**.

---

## Decisões Travadas (2026-08-01, D1 revisada em 2026-08-03)

O dono do projeto travou as 5 dimensões arquiteturais que estavam em aberto. **Estas decisões são definitivas** e governam todo o resto do documento. As alternativas descartadas ficam registradas apenas como nota curta de "por que não".

> **Revisão de D1 (2026-08-03):** o dono reverteu D1 do modelo "1 repositório por cliente + `@cms-core` publicado por SemVer" (antiga Opção A) para **MONOREPO** (antiga Opção B). Continua havendo **isolamento total de DADOS e INFRA por cliente** — mas esse isolamento passa a vir de **D4/D5** (Supabase/Neon/Bunny/Resend/Vercel próprios por cliente), **não** do layout de código. D2–D5 permanecem **intactas**. Detalhe completo do racional e do trade-off aceito abaixo e na §3.

| # | Dimensão | Decisão travada | Descartado (por quê) |
|---|----------|-----------------|----------------------|
| **D1** *(revisada 2026-08-03)* | **Isolamento / deploy** | **MONOREPO — um único repositório `criador-de-cms`.** O core vive em `packages/core` (`@cms-core`) e é linkado por **workspaces (`workspace:*`)**, **sem publicar em registry** (nada de npm/GitHub Packages; SemVer/registry saem do escopo). **Cada cliente é um workspace** em `clients/<slug>/` (uma app Next.js) que referencia `@cms-core` via `workspace:*`. Deploy continua **1 projeto Vercel por cliente** usando o recurso de monorepo do Vercel (Root Directory → `clients/<slug>/`): 1 deploy por cliente, domínio próprio, DB próprio. **Isolamento de dados/infra preservado por D4/D5.** | **A** (1 repo por cliente + `@cms-core` publicado por SemVer/registry): **revertida em 2026-08-03** — para poucos clientes e um único operador técnico, manter N repos sincronizados + publish/registry/PR-de-bump é overhead de manutenção sem retorno. O dono preferiu a simplicidade de um único repositório. **C** (multi-tenant/RLS único): quebra o isolamento físico já existente e exige reescrita de todas as queries. |
| **D2** | **Schema** | **Fixo na criação.** Coleções/campos são definidos em `client.config.ts`; um **codegen no build** gera enum Postgres + Zod + migrations tipados. Mudar schema = editar config + redeploy. | **Coleções dinâmicas em runtime** (coluna `type` livre + tabela `content_types`): perde enum/índices/tipos fortes e aumenta a superfície de bug. A antiga "Fase 5" foi **removida/arquivada** (ver Apêndice B). |
| **D3** | **Interface** | **CLI `create-client`** operada por um técnico (edita TS, roda comando). | **UI web de criação**: não entra. Reavaliável no futuro só se houver operador não-técnico. |
| **D4** | **Infra** | **Provisionamento automático.** A CLI provisiona **Supabase + Vercel + Bunny.net (+ Neon quando D5=neon)** via API: cria projeto, aplica migrations, configura secrets e faz o primeiro deploy. Este é o caminho ambicioso e está detalhado na §7. | **Setup manual de infra** (fábrica só gera código): descartado como fluxo-alvo; permanece disponível apenas como **modo `--skip-provision`** para debug/local. |
| **D5** | **Banco de conteúdo plugável** | **Provider do banco de conteúdo é escolhido por cliente na criação:** campo `providers.database.kind: "supabase" \| "neon"` no `client.config.ts` + flag `--db=<supabase\|neon>` na CLI (default `supabase`). O runtime de conteúdo é **provider-agnóstico** (Drizzle + driver `postgres` + connection string; Supabase Postgres e Neon são Postgres puro — o código não muda, só a connection string e o adapter de provisionamento). **Auth permanece SEMPRE no Supabase Auth na v1** (login + MFA/TOTP intactos), independente de onde o conteúdo mora. Ver §13 (design completo de D5). | **Auth próprio "zero Supabase"** (mover login/MFA para fora do Supabase): **ARQUIVADO como evolução futura** (seria um segundo provider de auth) — não entra na v1. **Banco único hardcoded** (só Supabase): perde a opção de custo/escala do Neon (branching, autoscaling, scale-to-zero). |

**Trade-off aceito de D1 (monorepo) — a documentar (risco + mitigação obrigatória):** perde-se o **versionamento independente por cliente**. Sem `@cms-core` publicado e sem pin de versão por cliente, um fix no core atinge **TODOS os clientes de uma vez** no próximo deploy de cada um — o blast radius de *código* passa a ser N clientes (o blast radius de *dados/infra* continua 1, garantido por D4/D5). **Mitigação obrigatória:** a CI do monorepo deve rodar **typecheck + testes de TODOS os workspaces de cliente** a cada mudança em `packages/core`, pegando qualquer quebra **antes** do deploy. Registrado como risco na §11.1 e como métrica de gate na CI.

**Por que não A/registry (revisão 2026-08-03):** preferência do dono por **simplicidade de manutenção para poucos clientes** operados por um único técnico. A independência de versão que a Opção A oferecia não compensava o custo de manter N repositórios sincronizados, um registry privado e automação de PR-de-bump. Opção A foi **considerada e revertida**, não descartada por inviabilidade técnica.

**Consequências das travas no documento:**
- §3 foi reescrita para o **modelo monorepo + workspaces** — a comparação A/B/C do isolamento por código ficou obsoleta (o isolamento agora vem de D4/D5); Opção A registrada como considerada-e-revertida; a máquina de SemVer/registry saiu do documento.
- O trade-off do enum e "runtime dinâmico vs build" foi resolvido em favor de **build-time codegen** (D2) — ver R2 na §5 e a §6 (codegen).
- A antiga "Fase 5" (coleções dinâmicas + UI web) foi **arquivada** no Apêndice B.
- A §7 ganhou o **design completo do provisionamento automático** (D4), antes marcado como "opcional".
- **D5** transformou `providers.database` em **união discriminada** (§4.1) e criou o **adapter Neon** + o **fluxo 2-provedores** (§13, §7.3, §7.5). O `db/index.ts` e o `drizzle.config.ts` **permanecem idênticos** — a abstração é 100% no nível de connection string (`DATABASE_URL` pooled / `DIRECT_URL` direto). Ver §13 para o design, §11.3 para os riscos do modelo 2-provedores (conteúdo no Neon + auth no Supabase), e a nova §13.4 para o impacto no relacionamento `profiles`/`createdBy`.

**Auth "zero Supabase" — nota de arquivamento (D5):** um segundo provider de auth (auth próprio, sem Supabase) fica registrado como evolução futura, **não** faz parte da v1. O gatilho para reabrir seria (a) custo/limite do Supabase Auth virar problema, ou (b) requisito de SSO/identidade corporativa que o Supabase Auth não atenda. Enquanto isso, mesmo no caso `database=neon`, o login e o MFA continuam no Supabase Auth (num projeto Supabase **auth-only**).

---

## 0. Sumário executivo

O `demo-corp-cms` é um headless CMS **standalone por cliente** (Supabase + Vercel + Bunny + Resend próprios), já **schema-driven** através de um registro em código (`REGISTRY`, `FIELDS`, `IMAGE_POLICIES`, `SINGLETON_PAGES`). O que impede o reuso direto são **poucos e bem localizados pontos hardcoded** (enum Postgres de tipos, tabela de facets 1:1 de case study, branding/domínios em `.env`/CSS, e os mapas TS por tipo).

**Arquitetura definitiva (D1 — MONOREPO, revisada 2026-08-03):** uma **fábrica geradora dentro de um único repositório** (`criador-de-cms`, monorepo). O core reutilizável vive em `packages/core` (`@cms-core`) e é linkado por **workspaces (`workspace:*`)** — **sem publicar em registry**. Cada cliente é um **workspace `clients/<slug>/`** (uma app Next.js gerada do template) que referencia `@cms-core` via `workspace:*` + um `client.config.ts` declarativo. O **isolamento total por cliente é preservado** (blast radius de dados/infra por cliente = 1), mas agora vem de **D4/D5** (Supabase/Neon/Bunny/Resend/Vercel próprios por cliente), não do layout de código. A propagação de correções do core é **automática e imediata**: como todos os clientes linkam o mesmo `packages/core` por `workspace:*`, um fix no core vale para todos no próximo deploy de cada workspace — sem publish, sem bump, sem copy-paste. O contraponto (um fix no core toca todos os clientes de uma vez, sem pin de versão) é mitigado pela **CI do monorepo rodando typecheck + testes de todos os workspaces de cliente** a cada mudança no core (ver trade-off de D1 nas Decisões Travadas e risco na §11.1).

**Decisão de schema (D2):** o `client.config.ts` é a **fonte única da verdade** do schema. Um **codegen no build** transforma o config em **enum Postgres, schemas Drizzle, migrations, Zod, ui-fields, tema e nav** — tudo tipado. Mudar schema = editar config + redeploy. Não há criação de coleção em runtime (arquivado). Isso mantém o enum/índices, os tipos TS fortes e o publish gate forte.

**Interface (D3):** uma **CLI `create-client`** operada por um técnico. Sem UI web.

**Infra (D4):** a CLI faz **provisionamento automático** de Supabase + Vercel + Bunny.net (+ Neon quando D5=neon) via API (criar projeto → aplicar migrations → configurar secrets → primeiro deploy), com idempotência e rollback de falha parcial. Detalhe completo na §7.

**Banco de conteúdo plugável (D5):** o cliente escolhe, na criação, onde o **conteúdo** mora: `providers.database.kind = "supabase" | "neon"`. Como ambos são Postgres puro acessado via Drizzle + driver `postgres` + connection string, o **runtime de conteúdo não muda entre providers** — só a connection string (`DATABASE_URL` pooled / `DIRECT_URL` direto) e o **adapter de provisionamento**. O `db/index.ts` e o `drizzle.config.ts` do modelo permanecem **byte-idênticos**. **A auth (login + MFA/TOTP) fica sempre no Supabase Auth na v1**, independente da escolha do banco:
- `database=supabase` → **um** projeto Supabase serve conteúdo **e** auth (como hoje).
- `database=neon` → o **Neon** guarda o conteúdo; um projeto Supabase **pequeno, auth-only** (sem tabelas de conteúdo, com SMTP/Resend configurado só para emails de auth) é provisionado à parte. **É aceito e intencional ter 2 provedores nesse caso.**

Detalhe completo do design plugável na §13; riscos do modelo 2-provedores na §11.3; impacto no relacionamento `profiles`/`createdBy` na §13.4.

---

## 1. Estado atual do CMS-modelo (verificado)

### 1.1 Stack confirmada

| Camada | Tecnologia | Observação |
|--------|-----------|------------|
| Framework | Next.js 16 (App Router) | dev na porta **3010** |
| Linguagem | TypeScript 5.9 | `tsc --noEmit` como typecheck |
| Estilo | Tailwind 4 (`@theme` em `app/globals.css`) | branding via CSS custom properties |
| ORM / DB | Drizzle ORM 0.45 + driver `postgres` + **Postgres plugável (Supabase Postgres OU Neon — D5)** | `db/index.ts` usa `DATABASE_URL` (pooled) e `drizzle.config.ts` usa `DIRECT_URL` (direto). Provider-agnóstico: só a connection string muda entre Supabase/Neon |
| Auth | **Supabase Auth** + TOTP MFA obrigatório (sempre, mesmo com conteúdo no Neon — D5) | guards por request (ES256/JWKS via `getClaims()`), RBAC `admin`/`editor`. Usuários no schema `auth` do projeto Supabase |
| Mídia | **Bunny.net** (storage + CDN) | só metadados no Postgres |
| Email | **Resend** | também alimenta SMTP do Supabase |
| Validação | **Zod 4** | por tipo de conteúdo, aplicada no save e no publish gate |
| Editor rich-text | Quill 2 + `sanitize-html` | paste sempre como texto plano; iframes só YouTube |

### 1.2 Modelo de dados central (`db/schema/content.ts`)

- **Tabela única `content_entries`**: coluna `type` (enum), `slug`, `locale`, `translationGroupId`, `status` (draft/published/archived), `sortOrder`, `data` JSONB (validado por Zod por tipo), `publishedData` JSONB (snapshot público congelado), `hasUnpublishedChanges`, soft delete (`deletedAt`), auditoria (`createdBy`/`updatedBy`).
- **`content_versions`**: histórico append-only (cada save/publish grava uma linha).
- **`case_study_facets`**: tabela **1:1** com entries de `type='case'`, promovendo `industry`, `service`, `regionSlugs`, `outcome` a colunas `text[]` para filtro no read API. **Este é o principal ponto específico do cliente no schema.**
- `locales` (registry de idiomas gerenciável), `media_assets`, `profiles`, `webhooks`, `leads`, `audit`.

### 1.3 O CMS já é schema-driven (isto é a boa notícia)

O editor, as rotas e o read API são **genéricos e dirigidos por mapas declarativos em código**:

| Artefato | Local | Papel |
|----------|-------|-------|
| `REGISTRY: Record<ContentType, ContentTypeDef>` | `lib/content/types.ts` | label, segment plural, singleton?, schema Zod, `toListItem` |
| `FIELDS: Record<ContentType, FieldSpec[]>` | `lib/content/ui-fields.ts` | layout do formulário genérico (kinds: text, textarea, richtext, url, email, media, date, stringList, facets, json) |
| `SINGLETON_PAGES` / `SEGMENT_TO_TYPE` | `lib/content/types.ts` | roteamento singleton e plural→tipo |
| `IMAGE_POLICIES: Record<string, ImagePolicy>` | `lib/media/policies.ts` | políticas de upload por campo (logo, banner) declarativas |
| Rota dinâmica `app/(admin)/[collection]` | app | uma UI para todas as coleções |

**Conclusão:** ~80% do que varia entre clientes já está expresso como *dados* (mapas TS). Falta apenas (a) **externalizar esses mapas para um config por cliente** e (b) **eliminar os ~4 pontos hardcoded** listados abaixo.

### 1.4 Pontos hardcoded específicos do cliente (blast radius medido)

O grep de `contentTypeEnum | CONTENT_TYPES | type === "case" | === "page_*"` retornou **18 ocorrências em 8 arquivos** — blast radius pequeno e concentrado:

| # | Acoplamento | Arquivos afetados | Natureza |
|---|-------------|-------------------|----------|
| 1 | **Enum Postgres `contentTypeEnum`** (`case`, `solution`, `person`, `region`, `insight`, `page_5h`, `page_book`, `page_awards`, `page_legal`) | `db/schema/enums.ts`, `db/schema/content.ts`, `lib/content/types.ts` (mirror `CONTENT_TYPES`) | tipos do cliente cravados no schema |
| 2 | **Facets 1:1 `caseStudyFacets`** + `extractCaseFacets` + `if (type === "case")` | `db/schema/content.ts`, `lib/content/entries.ts` (create/publish), `lib/content/published.ts` (`listPublishedCases`), `app/api/content/[type]/route.ts` | promoção de colunas de filtro específica de case |
| 3 | **Zod schemas + FIELDS por tipo** | `lib/content/types.ts`, `lib/content/ui-fields.ts` | conteúdo do Demo Corp |
| 4 | **Branding / domínios / provedores** | `app/globals.css` (`--color-brand*`, fonte Poppins), `components/AdminNav` + `app/(admin)/layout.tsx` (label "Demo Corp", itens de nav), `.env` (`SITE_URL`, `BUNNY_*`, `READ_API_KEY`, `RESEND_API_KEY`, `NEXT_PUBLIC_SUPABASE_*`, subdomínio admin) | identidade visual e infraestrutura |

Notas finas confirmadas no código:
- `app/(admin)/layout.tsx` tem o **array `NAV` hardcoded** (incluindo o rótulo "Legal pages" e as coleções). `AdminNav.tsx` tem o texto **"Demo Corp"** literal.
- `lib/content/published.ts` e `[collection]/page.tsx` têm regras especiais **`type === "person"`** (ordenação por drag-and-drop). Isso é um *comportamento por-tipo* que deve virar flag no config (`orderable: true`), não código hardcoded.
- `drizzle.config.ts` usa `schemaFilter: ["public"]` e ignora `auth` (Supabase-owned) — importante preservar no template.

---

## 2. Superfície de parametrização por cliente

Tudo que muda de cliente para cliente, separado em **CORE (reusável, versionado)** vs **CONFIG (por-cliente)**.

### 2.1 CONFIG (por-cliente) — vai para `client.config.ts` + secrets

| Categoria | O que varia | Origem hoje |
|-----------|-------------|-------------|
| **Identidade** | slug do cliente, nome de exibição, label do admin | literal em `AdminNav`/layout |
| **Collections** | lista de coleções (case, solution, …), label, segment plural, `orderable?`, ícone | `REGISTRY` |
| **Singletons** | páginas únicas (5h, book, awards, legal) + chaves de rota | `SINGLETON_PAGES` |
| **Campos** | por coleção/singleton: nome, label, kind, required, help, uploadField | `FIELDS` + Zod schemas |
| **Validações** | regras Zod derivadas dos campos (required, url, email, hex, min length) | schemas em `types.ts` |
| **Facets promovidas** | quais campos viram colunas `text[]` filtráveis, por coleção | `caseStudyFacets` (hoje só case) |
| **Locales iniciais** | idiomas semeados + default (`en`, `pt-BR`, …) | seed / tabela `locales` |
| **Branding** | cores (`brand`, `brand-dark`, `ink`, `paper`…), fonte, logo do admin | `app/globals.css` `@theme` |
| **Domínios** | subdomínio admin, `SITE_URL` do site público | `.env` |
| **Provedores de mídia** | Bunny zone, storage key, CDN URL | `.env` `BUNNY_*` |
| **Provedor de email** | Resend API key, domínio remetente | `.env` `RESEND_API_KEY` |
| **Políticas de upload** | logo (PNG transparente), banner (16:9), + custom por cliente | `IMAGE_POLICIES` |
| **Secrets** | `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_*`, `READ_API_KEY`, `WEBHOOK_SIGNING_KEY`, `PREVIEW_TOKEN_SECRET` | `.env` |
| **RBAC / usuários iniciais** | email/senha do primeiro admin, papéis | `scripts/seed-admin.ts` (args/env) |
| **Seeds** | dados de exemplo (opcional) | `scripts/seed-*.ts` |
| **Webhooks** | endpoint `/api/revalidate` do site + chave HMAC | tabela `webhooks` / `.env` |

### 2.2 CORE (reusável) — vai para `packages/core` (`@cms-core`) e o template

| Categoria | O que é sempre igual |
|-----------|----------------------|
| **Motor de conteúdo** | `content_entries` + `content_versions`, draft→published, snapshot congelado, soft delete, ordering, versionamento append-only |
| **Editor genérico** | `ContentEditor`, `RichTextEditor` (Quill), `MediaPicker`, form dirigido por `FIELDS` |
| **Roteamento dinâmico** | `app/(admin)/[collection]`, `app/api/content/[type]`, `app/api/admin/[type]` |
| **Auth & segurança** | Supabase Auth + MFA TOTP, guards por request, RBAC, rate limit, `x-api-key`, sanitização HTML |
| **i18n** | translation groups, locale fallback, registry de idiomas |
| **Pipeline de mídia** | upload → Bunny, resolução de URLs (`coverUrl`, `photoUrl`…), políticas |
| **Publishing** | publish gate (required + mídia existe), webhooks HMAC de revalidação, preview assinado |
| **Auditoria** | log append-only de toda mutação/evento de auth |
| **Read API público** | list/detail/singleton, published-only por construção, filtro por facets e tags |

---

## 3. Isolamento/deploy — MONOREPO (TRAVADA em D1, revisada 2026-08-03)

**Decisão travada:** a fábrica é um **único repositório** (`criador-de-cms`, monorepo). O core reutilizável vive em `packages/core` (`@cms-core`) e é linkado por **workspaces (`workspace:*`)** — **sem publicar em registry**. Cada cliente é um **workspace `clients/<slug>/`** (uma app Next.js gerada do template) que referencia `@cms-core` via `workspace:*` + `client.config.ts` + branding + assets. O deploy continua sendo **1 projeto Vercel por cliente**, usando o recurso de monorepo do Vercel (Root Directory apontando para `clients/<slug>/`): 1 deploy por cliente, domínio próprio, DB próprio.

**Onde mora o isolamento (importante):** o isolamento de **dados e infra** por cliente é preservado e vem de **D4/D5** — cada cliente tem seu próprio Supabase/Neon (conteúdo), Supabase (auth), Bunny (mídia), Resend (email) e projeto Vercel. **O layout de código (monorepo vs N repos) não afeta o isolamento de dados/infra** — bancos e projetos continuam fisicamente separados. O que o monorepo muda é o blast radius de *código*: o core é compartilhado por link, não por publicação.

| Dimensão | Avaliação (Monorepo) |
|----------|-----------|
| **Isolamento de dados/infra** | ✅ Total — bancos e projetos de infra fisicamente separados por cliente (D4/D5), zero risco de vazamento cross-tenant. Independe do layout de código. |
| **Blast radius de dados/infra** | ✅ Mínimo — incidente de dados/infra afeta 1 cliente; deploy independente por workspace. |
| **Blast radius de código** | ⚠️ N clientes — um fix no core atinge todos no próximo deploy (sem pin de versão por cliente). Mitigado pela CI que roda todos os workspaces (ver abaixo). |
| **Manutenção (propagar fix p/ N)** | ✅ Trivial — todos os clientes linkam o mesmo `packages/core` por `workspace:*`; um fix vale para todos **sem publish, sem bump, sem copy-paste**. |
| **Custo de infra** | N× Supabase/Vercel/Bunny (cada um em free/low tier; um por cliente) — ver riscos §11.2 |
| **Esforço de setup** | ✅ Baixo — 90% do core já existe (`packages/core` da Fase 0); falta o root `package.json` (workspaces) + mover o reutilizável para o core. Sem pacote publicado, sem registry. |
| **Aderência à filosofia atual** | ✅ Boa — mantém standalone por cliente (infra própria); troca N repos por N workspaces num só repo. |

**Por que monorepo e não as outras** (registro curto — decisão travada, não reabrir):
- **A (1 repo por cliente + `@cms-core` publicado por SemVer/registry):** foi a decisão original e foi **considerada e revertida em 2026-08-03**. Dava independência de versão por cliente, ao custo de manter N repositórios sincronizados, um registry privado e automação de PR-de-bump (Renovate). Para poucos clientes e um único operador técnico, o dono avaliou que esse overhead não compensava — preferiu a simplicidade de um único repositório. **Não descartada por inviabilidade técnica; revertida por preferência de manutenção.**
- **C (multi-tenant único, `tenant_id` + RLS):** isolamento apenas **lógico** (um erro de RLS = vazamento cross-tenant), blast radius máximo (um incidente derruba todos), e exige **reescrever todas as queries** e a auth. Rompe a filosofia standalone. Descartada.

**Trade-off aceito e sua mitigação obrigatória:** o monorepo abre mão do **versionamento independente por cliente**. Um fix no core não é "pinado" por cliente — ele passa a valer para todos no próximo deploy de cada workspace. Isso é aceitável para o volume atual, **desde que** a CI do monorepo rode **typecheck + testes de TODOS os workspaces de cliente** a cada mudança em `packages/core`, capturando qualquer regressão **antes** do deploy. Sem essa CI, o trade-off vira risco não-mitigado. Ver risco correspondente na §11.1 e o setup de CI na Fase 1 (§10).

**Gerenciador de workspace recomendado:** ver §8 (recomendação: **pnpm workspaces**, com Turborepo como opção a adotar só quando o número de clientes tornar a CI lenta).

---

## 4. Especificação do `client.config.ts` (D2 — fonte única do schema)

O config é **tipado e validado por Zod** (o mesmo Zod já usado no core). O codegen consome este objeto para produzir enum Postgres, schemas Drizzle, migrations, Zod runtime, ui-fields, branding/tema, nav e `.env`. **Nenhum secret vive no config** — só nomes, emails, domínios e nomes-de-zona. Secrets são gerados/coletados no provisionamento (§7) e injetados por env.

### 4.1 Contrato completo (`@cms-core/config`)

Os `FieldKind` abaixo são exatamente os 10 já suportados pelo modelo (verificado em `packages/core/src/engine/ui-fields.ts`, extraído do modelo na Fase 1): `text`, `textarea`, `richtext`, `url`, `email`, `media`, `date`, `stringList`, **`facets`** (o editor de facets multi-select) e `json` (editor JSON para estruturas aninhadas como `elements`/`items`).

> **Extensão do contrato (ADR-002, Decisão 2):** o `FieldConfig` ganhou os atributos `default`, `trim`, `dedup` e `itemShape` (+ o tipo `ItemFieldSpec`) para expressar a nuance de validação **por campo** que os schemas Zod gold-standard (`packages/core/src/engine/types.ts`) codificam e que o contrato original não capturava — sobretudo o `default: ""` de strings opcionais (vs. `.optional()` puro), o trim/dedup de `tags`, e os `json` aninhados de `elements`/`items`. Sem isso, `buildZodSchema` produziria schemas **mais frouxos** que quebrariam os testes de validação do cliente. Auditoria completa (9 tipos, 63 campos) e tabela de mapeamento atributo→Zod: **`adr-002-registry-seam-and-fieldconfig.md`** (Apêndice A).

> **Extensão do contrato (ADR-003, P3):** o `FieldConfig` ganhou `uiHidden?: boolean` — a única extensão nova da passada de design do pipeline de codegen. Motivo medido no código: o baseline injetou um campo sintético `kind:"facets"` (`industryFacets`) que existe só para ancorar os `FacetConfig.sourceField` (regra `validateClientConfig` AC6), mas que o `FIELDS` e os schemas Zod gold-standard **não têm** (as facets são UI-only + promovidas a colunas). `uiHidden:true` faz `gen-ui-fields`/`gen-zod` filtrarem esse campo — sem ele, o campo vaza para os artefatos gerados e quebra o TEST-001. Aditivo e opcional (configs sem ele não mudam). Design completo do pipeline de codegen (tabela gerador→saída→alvo→veredito, ordem, `cli/`, determinismo, riscos): **`adr-003-codegen-pipeline-design.md`**.

```ts
// @cms-core/config — tipos do contrato de configuração de um cliente.
// Este arquivo é a FONTE ÚNICA da verdade do schema (D2). Editar + redeploy
// é a única forma de mudar coleções/campos. Não há criação em runtime.

// ── Campos ────────────────────────────────────────────────────────────────
/** Os 10 kinds suportados pelo editor genérico (paridade com o modelo atual). */
export type FieldKind =
  | "text"        // input de linha única
  | "textarea"    // texto multilinha sem formatação
  | "richtext"    // Quill + sanitize-html (paste vira texto plano; iframe só YouTube)
  | "url"         // validado como URL opcional (optionalUrl no Zod do core)
  | "email"       // validado como email opcional
  | "media"       // referência a media_assets; usa uploadField p/ política de upload
  | "date"        // data ISO
  | "stringList"  // string[] (tags, endereços) — editor de chips
  | "facets"      // multi-select agrupado (industry/service/region/outcome) — ver nota
  | "json";       // editor JSON p/ estruturas aninhadas (elements[], awards items[])

export interface FieldValidateConfig {
  /** regex declarativa (ex.: "^#([0-9a-fA-F]{6})$" para cor hex) */
  pattern?: string;
  /** min/max length p/ text/textarea; min/max itens p/ stringList */
  min?: number;
  max?: number;
  /** validador nomeado registrado no core (escape hatch p/ regras finas,
   *  ex.: "youtubeUrl" que hoje é custom). Ver R1 (§5) / risco Zod. */
  custom?: string;
}

/**
 * Sub-spec de um campo aninhado dentro de `itemShape` (json array-of-objects como
 * `elements`/`items`). Vocabulário mínimo — só os kinds usados hoje. Ver ADR-002 §2.
 */
export interface ItemFieldSpec {
  kind: "text" | "media"; // key/title/name/year → text; logoMediaId → media
  required?: boolean;     // true → .min(1) (text) / presente (media)
  default?: unknown;      // ex.: description → default("")
}

export interface FieldConfig {
  /** chave dentro do JSONB `data` (ex.: "title", "logoMediaId") */
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  help?: string;
  /** só p/ kind:"media" — chave em uploadPolicies (ex.: "logo", "banner").
   *  Ausente => upload aceita o baseline genérico sem política estrita. */
  uploadField?: string;
  /** validação declarativa extra (além de required/kind) */
  validate?: FieldValidateConfig;

  // ── Nuance de validação por campo (ADR-002, Decisão 2) ──────────────────────
  /** default quando ausente/vazio. Distingue os dois "opcionais" do gold-standard:
   *  `default: ""` → `z.string().default("")` (dado volta "") vs. ausente+sem required
   *  → `.optional()` (dado volta undefined). Também `default: []` p/ stringList.
   *  Só literais serializáveis. Ver ADR-002 §2 / Apêndice A. */
  default?: unknown;
  /** stringList: apara cada item antes de validar (espelha `tagsField`). */
  trim?: boolean;
  /** stringList: remove brancos + duplicados via Set (espelha `tagsField`). */
  dedup?: boolean;
  /** só p/ kind:"json" que é ARRAY DE OBJETOS (elements, items): shape do item.
   *  buildZodSchema emite `z.array(z.object(shape)).default([])`. Ausente => json
   *  genérico (array de record). Ver ADR-002 §2 / Apêndice A. */
  itemShape?: Record<string, ItemFieldSpec>;

  // ── Visibilidade (ADR-003, P3) ─────────────────────────────────────────────
  /** true => o campo NÃO aparece no `FIELDS` genérico nem no `data` Zod schema —
   *  existe só para ancorar `FacetConfig.sourceField` (ex.: `industryFacets` do
   *  baseline, um `kind:"facets"` renderizado pelo FacetsInput dedicado e promovido
   *  a colunas, não validado em `data`). `gen-ui-fields` e `gen-zod` filtram campos
   *  `uiHidden`. Sem isso, o campo sintético vaza p/ os artefatos gerados e quebra o
   *  TEST-001 (o `FIELDS`/schema gold-standard não o tem). Ver ADR-003 §3-P3. */
  uiHidden?: boolean;
}

// ── Facets promovidas a coluna ──────────────────────────────────────────────
/**
 * Um campo (normalmente kind:"facets" ou "stringList") promovido a coluna
 * text[] filtrável no read API. Generaliza a tabela caseStudyFacets.
 * O codegen emite, por coleção com facets, uma tabela `<type>_facets` com
 * uma coluna text[] + índice GIN por facet.
 */
export interface FacetConfig {
  /** nome do facet exposto como query param no read API (ex.: "industry") */
  name: string;
  /** nome da coluna text[] gerada (ex.: "industry"); default = name */
  column?: string;
  /** de qual campo do JSONB `data` os valores são extraídos (default = name) */
  sourceField?: string;
}

// ── Coleções e singletons ───────────────────────────────────────────────────
export interface CollectionConfig {
  /** identificador do tipo → valor do enum content_type + chave do REGISTRY.
   *  Deve casar /^[a-z][a-z0-9_]*$/ (vira literal do enum Postgres). */
  type: string;
  label: string;
  /** segmento plural na URL do admin (ex.: "cases"). Obrigatório se !singleton. */
  segment?: string;
  /** true => página única (não listável). Usa singletonRoutes. */
  singleton?: boolean;
  /** habilita ordenação drag-and-drop (generaliza o hoje-hardcoded type==="person") */
  orderable?: boolean;
  /** ícone opcional do item de nav (nome de ícone do set do admin) */
  icon?: string;
  fields: FieldConfig[];
  /** campos promovidos a colunas text[] filtráveis (generaliza caseStudyFacets) */
  facets?: FacetConfig[];
  /** só p/ singleton: chave lógica -> slug de rota (ex.: { privacy: "privacy" }).
   *  Um singleton pode ter várias "instâncias" fixas (ex.: legal → privacy+terms). */
  singletonRoutes?: Record<string, string>;
}

// ── Políticas de upload (paridade com lib/media/policies.ts) ─────────────────
export interface UploadPolicyConfig {
  label: string;
  /** MIME types aceitos (ex.: ["image/png"]). Omitir = baseline. */
  formats?: string[];
  maxBytes?: number;
  maxWidth?: number;
  maxHeight?: number;
  /** exige canal alpha (PNG transparente p/ logos) */
  requireAlpha?: boolean;
  /** força aspect ratio dentro de tolerance (default 0.02) */
  aspectRatio?: { w: number; h: number; tolerance?: number };
  /** mantém bytes/formato originais em vez de reencodar p/ WebP (logos PNG) */
  preserveFormat?: boolean;
}

// ── Branding / tema ──────────────────────────────────────────────────────────
export interface BrandingConfig {
  adminTitle: string;        // texto no AdminNav (hoje "Demo Corp")
  fontFamily?: string;       // "Poppins" | "Inter" | ...
  /** vira o bloco @theme gerado em app/theme.generated.css */
  colors: {
    brand: string;           // "#d84339" — CTA/acento
    brandDark: string;       // "#b5342b" — hover
    brandDarker?: string;
    ink?: string;            // texto principal
    muted?: string;          // texto secundário
    paper?: string;          // fundo
  };
  /** logo do admin (asset relativo ao workspace do cliente, copiado no scaffold) */
  logoPath?: string;
}

// ── Domínios ─────────────────────────────────────────────────────────────────
export interface DomainsConfig {
  /** host do admin (Vercel) — vira o domínio custom do projeto Vercel */
  adminSubdomain: string;    // "cms.cliente.com"
  /** URL do site público — usado em preview e como origin de webhooks */
  siteUrl: string;           // "https://www.cliente.com"
}

// ── Banco de conteúdo (D5 — união discriminada por provider) ──────────────────
/**
 * Onde o CONTEÚDO mora. União discriminada por `kind`. O runtime não muda entre
 * os dois (Drizzle + driver postgres + connection string); muda só a connection
 * string e o adapter de provisionamento (§13).
 *
 * IMPORTANTE: isto controla APENAS o banco de conteúdo. A AUTH (login + MFA)
 * fica sempre no Supabase Auth na v1 — ver `providers.auth` abaixo.
 */
export type DatabaseConfig =
  | {
      kind: "supabase";
      /** região do projeto Supabase de conteúdo (ex.: "sa-east-1") */
      region: string;
      /** plano do projeto ("free" | "pro"); default "free" */
      plan?: "free" | "pro";
    }
  | {
      kind: "neon";
      /** região do projeto Neon no formato da Neon API (ex.: "aws-sa-east-1" →
       *  host `...sa-east-1.aws.neon.tech`) */
      region: string;
      /** plano Neon ("free" | "launch" | "scale"); default "free" */
      plan?: "free" | "launch" | "scale";
      /** branch de conteúdo a usar (default "main") */
      branch?: string;
    };

/**
 * Onde a AUTH mora. Na v1 é SEMPRE Supabase Auth. Quando `database.kind` é:
 *   - "supabase": este é o MESMO projeto Supabase que serve o conteúdo.
 *   - "neon":     este é um projeto Supabase separado, AUTH-ONLY (sem tabelas de
 *                 conteúdo; só o schema `auth` + SMTP/Resend p/ emails de auth).
 * "zero-supabase" fica arquivado como evolução futura (D5) — não é aceito na v1.
 */
export interface AuthConfig {
  provider: "supabase";
  /** região do projeto Supabase de auth (ex.: "sa-east-1"). No caso database=supabase,
   *  DEVE igualar `database.region` (é o mesmo projeto). */
  region: string;
  /** plano ("free" | "pro"); default "free". Projeto auth-only cabe folgado no free. */
  plan?: "free" | "pro";
}

// ── Provedores (nomes/refs, NUNCA secrets) ───────────────────────────────────
export interface ProvidersConfig {
  /** banco de CONTEÚDO — Supabase Postgres OU Neon (D5). project-ref/keys/URLs
   *  vêm do provisioning; aqui só região/plano. */
  database: DatabaseConfig;
  /** AUTH — sempre Supabase na v1. No caso database=neon é um projeto Supabase
   *  auth-only separado; no caso database=supabase é o mesmo projeto do conteúdo. */
  auth: AuthConfig;
  /** Bunny: nome da storage zone + host do CDN (pull zone) a criar */
  media: {
    provider: "bunny";
    storageZone: string;     // "acme-media" (globalmente único no Bunny)
    /** região primária da storage zone (ex.: "BR", "DE") */
    storageRegion?: string;
    cdnUrl: string;          // "https://acme.b-cdn.net"
  };
  /** Resend: domínio remetente a verificar (DKIM criado no provisioning) */
  email: {
    provider: "resend";
    senderDomain: string;    // "acme.com"
    fromName?: string;       // "Acme CMS"
  };
  /** Vercel: nome do projeto + escopo (team) onde criar */
  hosting: {
    provider: "vercel";
    projectName: string;     // "acme-cms"
    /** slug do team Vercel (ausente = conta pessoal do token) */
    teamSlug?: string;
    /** framework preset (fixo p/ este template) */
    framework?: "nextjs";
  };
}

// ── Locales ──────────────────────────────────────────────────────────────────
export interface LocalesConfig {
  default: string;                          // "pt-BR"
  enabled: { code: string; label: string }[];
}

// ── Admin inicial ────────────────────────────────────────────────────────────
export interface SeedAdminConfig {
  email: string;
  /** senha NUNCA vai no config. Nome da env var lida no seed (default
   *  "SEED_ADMIN_PASSWORD"). O admin troca no 1º login + enrola TOTP. */
  passwordEnvVar?: string;
}

// ── Seeds (dados de exemplo opcionais) ───────────────────────────────────────
export interface SeedsConfig {
  enabled: boolean;
  /** caminho de um dataset JSON (por tipo) a inserir como draft após migrate */
  datasetPath?: string;
}

// ── Config raiz ──────────────────────────────────────────────────────────────
export interface ClientConfig {
  /** slug técnico do cliente (kebab-case) — usado em nomes de projeto/pasta */
  slug: string;              // "acme"
  displayName: string;       // "Acme Corporation"
  /** (D1 monorepo) como o workspace do cliente referencia o @cms-core no
   *  package.json gerado. No monorepo o valor canônico é "workspace:*" (link
   *  interno, sem registry). Mantido no contrato por compatibilidade; qualquer
   *  outro valor é tratado como override raro (não recomendado no monorepo). */
  coreVersion: string;       // "workspace:*"

  branding: BrandingConfig;
  domains: DomainsConfig;
  providers: ProvidersConfig;
  locales: LocalesConfig;

  /** as coleções e singletons — a espinha dorsal do schema (D2) */
  collections: CollectionConfig[];

  /** políticas de upload nomeadas, referenciadas por field.uploadField */
  uploadPolicies: Record<string, UploadPolicyConfig>;

  seedAdmin: SeedAdminConfig;
  seeds?: SeedsConfig;
}
```

> **Nota sobre `facets` (kind) vs `FacetConfig` (coluna):** são duas coisas distintas confirmadas no modelo. O `kind:"facets"` é o **controle de UI** (multi-select agrupado, hoje com os grupos industry/service/region/outcome). O `FacetConfig` é a **promoção a coluna `text[]`** para filtro no read API. Uma coleção pode ter o campo de UI e declarar quais grupos viram colunas indexadas. O codegen liga os dois: `sourceField` diz de qual campo do JSONB extrair os valores.

### 4.2 Regras de validação do config (Zod, aplicadas no `create-client validate`)

- `slug` e cada `collection.type` casam `/^[a-z][a-z0-9_-]*$/`; `type` adicionalmente `/^[a-z][a-z0-9_]*$/` (é literal de enum Postgres).
- `type` únicos entre coleções; `field.name` únicos dentro de cada coleção.
- `field.uploadField` (quando presente) ⊆ chaves de `uploadPolicies`.
- `facets[].sourceField` (ou `name`) ⊆ `field.name` da própria coleção.
- coleção **não-singleton** exige `segment`; **singleton** exige `singletonRoutes` não-vazio.
- `locales.default` ∈ `locales.enabled[].code`.
- cores em `branding.colors` casam hex `/^#[0-9a-fA-F]{6}$/`.
- nenhum valor que pareça secret (regex de chaves conhecidas) presente — falha dura se detectado.
- **(D5) `providers.database.kind` ∈ `{"supabase","neon"}`**; a união discriminada é validada por `kind` (região/plano válidos para o provider escolhido; `branch` só permitido em `kind:"neon"`).
- **(D5) `providers.auth.provider === "supabase"`** obrigatório (v1 não aceita outro provider de auth).
- **(D5) coerência Supabase-único:** quando `database.kind === "supabase"`, `providers.auth.region` **deve igualar** `providers.database.region` (é o mesmo projeto Supabase; o codegen/provisionamento reconcilia como um recurso só). Quando `database.kind === "neon"`, `auth.region` é independente (projeto Supabase auth-only à parte).
- **(D5) flag CLI vs config:** se `--db=<supabase|neon>` for passado e divergir de `providers.database.kind`, `validate` falha (a flag é conveniência; o config é a fonte da verdade). Sem flag, vale o `kind` do config; sem `kind` no config (config legado), assume `supabase`.

### 4.3 Exemplo real preenchido — cliente "acme" (banco no **Neon**, auth no Supabase)

Este exemplo mostra deliberadamente o **caso 2-provedores (D5)**: `providers.database.kind === "neon"` (conteúdo no Neon) + `providers.auth.provider === "supabase"` (projeto Supabase auth-only). Para o caso single-provider, basta trocar o bloco `database` por `{ kind: "supabase", region: "sa-east-1", plan: "free" }` e fazer `auth.region` igualar `database.region` (é o mesmo projeto).

```ts
// clients/acme/client.config.ts  (no monorepo, isto vive no workspace do cliente)
import type { ClientConfig } from "@cms-core/config";

export const config: ClientConfig = {
  slug: "acme",
  displayName: "Acme Corporation",
  coreVersion: "workspace:*",   // (D1 monorepo) link interno ao packages/core, sem registry

  branding: {
    adminTitle: "Acme CMS",
    fontFamily: "Inter",
    colors: {
      brand: "#2563EB",
      brandDark: "#1D4ED8",
      brandDarker: "#1E3A8A",
      ink: "#0F172A",
      muted: "#64748B",
      paper: "#F8FAFC",
    },
    logoPath: "./assets/acme-logo.svg",
  },

  domains: {
    adminSubdomain: "cms.acme.com",
    siteUrl: "https://www.acme.com",
  },

  providers: {
    // (D5) CONTEÚDO no Neon. O runtime é idêntico ao caso Supabase — só a
    // connection string (DATABASE_URL pooled -pooler / DIRECT_URL direto) muda.
    database: { kind: "neon", region: "aws-sa-east-1", plan: "launch", branch: "main" },
    // (D5) AUTH sempre no Supabase. Como database=neon, este é um projeto
    // Supabase AUTH-ONLY separado (só schema `auth` + SMTP/Resend p/ emails).
    auth: { provider: "supabase", region: "sa-east-1", plan: "free" },
    media: {
      provider: "bunny",
      storageZone: "acme-media",
      storageRegion: "BR",
      cdnUrl: "https://acme.b-cdn.net",
    },
    email: { provider: "resend", senderDomain: "acme.com", fromName: "Acme CMS" },
    hosting: { provider: "vercel", projectName: "acme-cms", teamSlug: "minha-agencia", framework: "nextjs" },
  },

  locales: {
    default: "pt-BR",
    enabled: [
      { code: "pt-BR", label: "Português" },
      { code: "en", label: "English" },
    ],
  },

  collections: [
    {
      // coleção listável, ordenável, com facets promovidas a coluna
      type: "case",
      label: "Case de sucesso",
      segment: "cases",
      orderable: true,
      icon: "briefcase",
      fields: [
        { name: "title", label: "Título", kind: "text", required: true },
        { name: "tags", label: "Tags", kind: "stringList" },
        { name: "quote", label: "Depoimento", kind: "textarea" },
        { name: "quoter", label: "Autor do depoimento", kind: "text" },
        { name: "youtube", label: "Vídeo YouTube", kind: "url",
          help: "watch / youtu.be / embed / shorts",
          validate: { custom: "youtubeUrl" } },
        { name: "brandColor", label: "Cor da marca", kind: "text",
          help: "hex de 6 dígitos, ex.: #1a2b3c",
          validate: { pattern: "^#([0-9a-fA-F]{6})$" } },
        { name: "logoMediaId", label: "Logo da marca", kind: "media",
          uploadField: "logo", help: "PNG transparente, até 1024×1024" },
        { name: "cover", label: "Capa", kind: "media", uploadField: "banner" },
        { name: "industryFacets", label: "Classificação", kind: "facets" },
        { name: "introduction", label: "Introdução", kind: "richtext" },
        { name: "body", label: "Conteúdo", kind: "richtext", required: true },
      ],
      facets: [
        { name: "industry", column: "industry", sourceField: "industryFacets" },
        { name: "service",  column: "service",  sourceField: "industryFacets" },
        { name: "region",   column: "region_slugs", sourceField: "industryFacets" },
        { name: "outcome",  column: "outcome",  sourceField: "industryFacets" },
      ],
    },
    {
      type: "solution",
      label: "Solução",
      segment: "solutions",
      icon: "grid",
      fields: [
        { name: "title", label: "Título", kind: "text", required: true },
        { name: "bannerMediaId", label: "Banner", kind: "media", uploadField: "banner" },
        { name: "problemStatement", label: "Problema", kind: "richtext", required: true },
        { name: "body", label: "Descrição", kind: "richtext" },
      ],
    },
    {
      type: "person",
      label: "Pessoa",
      segment: "team",
      orderable: true,        // generaliza o hoje-hardcoded type==="person"
      icon: "user",
      fields: [
        { name: "name", label: "Nome", kind: "text", required: true },
        { name: "role", label: "Cargo", kind: "text", required: true },
        { name: "bio", label: "Bio", kind: "richtext", required: true },
        { name: "photoMediaId", label: "Foto", kind: "media" },
        { name: "linkedin", label: "LinkedIn", kind: "url" },
        { name: "email", label: "Email", kind: "email" },
      ],
    },
    {
      type: "insight",
      label: "Artigo",
      segment: "insights",
      icon: "file-text",
      fields: [
        { name: "title", label: "Título", kind: "text", required: true },
        { name: "tags", label: "Tags", kind: "stringList" },
        { name: "author", label: "Autor", kind: "text" },
        { name: "excerpt", label: "Resumo", kind: "richtext" },
        { name: "body", label: "Corpo", kind: "richtext", required: true },
        { name: "coverMediaId", label: "Capa", kind: "media", uploadField: "banner" },
        { name: "publishedDate", label: "Data de publicação", kind: "date" },
      ],
      facets: [{ name: "tag", column: "tags", sourceField: "tags" }],
    },
    {
      // singleton com múltiplas instâncias fixas
      type: "page_home",
      label: "Página inicial",
      singleton: true,
      singletonRoutes: { home: "home" },
      icon: "home",
      fields: [
        { name: "title", label: "Título", kind: "text", required: true },
        { name: "intro", label: "Introdução", kind: "richtext" },
        { name: "elements", label: "Blocos [{key,title,description}]", kind: "json" },
        { name: "ctaLabel", label: "Rótulo do CTA", kind: "text" },
        { name: "ctaHref", label: "Link do CTA", kind: "text" },
      ],
    },
    {
      type: "page_legal",
      label: "Páginas legais",
      singleton: true,
      singletonRoutes: { privacy: "privacy", terms: "terms" },
      icon: "shield",
      fields: [
        { name: "title", label: "Título", kind: "text", required: true },
        { name: "body", label: "Corpo", kind: "richtext", required: true },
      ],
    },
  ],

  uploadPolicies: {
    logo: {
      label: "Logo", formats: ["image/png"], requireAlpha: true,
      preserveFormat: true, maxBytes: 2_097_152, maxWidth: 1024, maxHeight: 1024,
    },
    banner: {
      label: "Banner", aspectRatio: { w: 16, h: 9, tolerance: 0.05 },
      maxBytes: 8_388_608,
    },
  },

  seedAdmin: { email: "admin@acme.com", passwordEnvVar: "SEED_ADMIN_PASSWORD" },
  seeds: { enabled: false },
};
```

---

## 5. Refactors do core — os 3 críticos como itens de trabalho

Estes são os **3 refactors críticos** que destravam a fábrica. Todos são **capability-preserving** (o teste de equivalência da Fase 0 bloqueia qualquer perda vs Demo Corp). Ordem obrigatória: **R1 → R2 → R3** (R2 depende de R1; R3 depende de R2 para o `defForType` genérico). Todos os arquivos citados vivem no `demo-corp-cms` (que vira o primeiro consumidor do `@cms-core`).

### R1 — Externalizar os mapas TS para derivar do config (baixo risco, destrava tudo)

**Objetivo:** `REGISTRY`, `FIELDS`, `SINGLETON_PAGES`, `SEGMENT_TO_TYPE`, `IMAGE_POLICIES` deixam de ser literais e passam a ser **construídos** a partir de `client.config.ts`. O código consumidor não muda — continua chamando `defForType(type)`, `FIELDS[type]`, `getImagePolicy(field)`.

**Arquivos afetados** (o motor foi extraído para o core na Fase 1 — S1.3b; os alvos REAIS estão em `packages/core/src/engine/*` e `packages/core/src/media/*`, **não** mais em `clients/demo-corp/lib/content|media/*`):
- `packages/core/src/engine/types.ts` — deixa de declarar `REGISTRY`/`validateContent`/`defForType`/`SEGMENT_TO_TYPE`/`SINGLETON_PAGES` e os 9 schemas literais; esses passam a ser **injetados** via `RegistryBundle` na factory `createEngine` (ADR-002, Decisão 1). Mantém `CONTENT_TYPES` helpers, `isContentType`, os tipos `ContentTypeDef`/`ValidationResult`, `extractCaseFacets` (removido em S2.5).
- `packages/core/src/engine/ui-fields.ts` — `FIELDS`/`emptyData` derivam de `buildFields(config)`/`buildEmptyData(config,type)`.
- `packages/core/src/config/content-builders.ts` (**JÁ ENTREGUE** em S2.1) — `buildContentRegistry`, `buildSingletonPages`, `buildSegmentToType`, `buildContentTypes`, `buildFields`, `buildEmptyData`, `buildImagePolicies`, `buildZodSchemas`.
- `clients/demo-corp/lib/core-runtime.ts` — monta o `RegistryBundle` a partir de `client.config.ts` (via os builders) e o injeta em `createEngine`; re-exporta `validateContent`/`defForType`/`resolveTypeParam`/`SINGLETON_PAGES`/`SEGMENT_TO_TYPE` com o mesmo path/assinatura para os ~20 call-sites. Ver §5.6 e ADR-002 §1.
- `packages/core/src/media/policies.ts` — `IMAGE_POLICIES` passa a vir de `buildImagePolicies(config)` (a interface `ImagePolicy` casa 1:1 com `UploadPolicyConfig`).

**Ponto técnico central — `buildZodSchema(fields)`:** mapeia cada `FieldConfig` → validador Zod, preservando as regras finas de hoje **byte-a-byte** (não apenas o esqueleto). Base por kind: `text`→`z.string()`; `required`→`.min(1)`; `url`→`optionalUrl` (preprocess `""→undefined`); `url`+`required`→`z.url()`; `email`→`optionalEmail`; `stringList`→`z.array(z.string())`; `facets`→`z.object({...grupos}).partial()`; `json`→`z.array(z.record(...)).default([])`; `date`→string opcional. Regras finas: `validate.pattern`→`.regex()` (com `preprocess ""→undefined`+`.optional()` quando o campo é opcional — ex.: `brandColor`); `validate.custom`→**registry de validadores nomeados** (`youtubeUrl`, `hexColor`).

> **Nuance por campo (ADR-002, Decisão 2):** os schemas gold-standard divergem POR CAMPO de formas que só o `kind`+`required` não capturam. Os atributos estendidos do `FieldConfig` mapeiam assim: `default: ""` → `z.string().default("")` (dado volta `""`, testado em `content-case-validation.test.ts`); ausência de `default` sem `required` → `.optional()` (dado volta `undefined`); `trim`+`dedup` (stringList) → `tagsField` (preprocess trim+Set); `default: []` → `.default([])`; `itemShape` (json array-of-objects) → `z.array(z.object(shape)).default([])`. Tabela completa atributo→Zod: **`adr-002-registry-seam-and-fieldconfig.md`** (Decisão 2 + Apêndice A). Sem esses atributos, `buildZodSchema` afrouxaria a validação e quebraria os testes do cliente.

**Critérios de aceite:**
- Todos os consumidores (`entries.ts`, `[collection]/page.tsx`, read API) funcionam sem alteração de assinatura.
- Um `client.config.ts` que reproduz o Demo Corp gera `REGISTRY`/`FIELDS`/schemas **estruturalmente idênticos** aos literais atuais (snapshot test).
- `typecheck` e testes existentes passam sem regressão.

**Dependências:** nenhuma (é o primeiro).

---

### R2 — Codegen de enum + schema no build (D2 — resolve o trade-off "build vs runtime")

**Decisão travada (D2):** os content types são **gerados no build** a partir do config, NÃO dinâmicos em runtime. Isso mantém o enum Postgres (integridade + índices `content_type_status_locale_idx`), tipos TS fortes, publish gate forte e autocomplete no editor. O custo (adicionar coleção = redeploy) é aceitável para o público-alvo (agência define coleções na criação). *Por que não runtime dinâmico: perderia enum/índices/tipos e aumentaria a superfície de bug — descartado em D2.*

**Objetivo:** um passo de codegen lê `client.config.ts` e **emite** os artefatos de schema tipados, antes do `drizzle-kit generate`.

**Arquivos afetados / gerados (`demo-corp-cms` → template):**
- `db/schema/enums.ts` — passa a `export { contentTypeEnum } from "./enums.generated"`. O `contentStatusEnum`, `roleEnum`, `userStatusEnum` permanecem estáticos (são do core, não variam por cliente).
- **Gerado** `db/schema/enums.generated.ts` — `pgEnum("content_type", [...config.collections.map(c => c.type)])`.
- **Gerado** `lib/content/content-types.generated.ts` — `export const CONTENT_TYPES = [...] as const` + `export type ContentType = typeof CONTENT_TYPES[number]`.
- `db/schema/content.ts` — usa `contentTypeEnum` do generated; resto inalterado.
- `db/migrations/` — produzidas por `drizzle-kit generate` **após** o codegen.

**Ordem no pipeline (crítica):** `generate (codegen)` → `drizzle-kit generate` → `drizzle-kit migrate`. Nunca inverter — o enum gerado precisa existir antes do drizzle introspectar o schema.

**Critérios de aceite:**
- Config do Demo Corp gera exatamente o enum atual (9 tipos, mesma ordem).
- `drizzle-kit generate` produz migration equivalente à baseline (0 diffs no `drizzle-kit check` contra o schema atual).
- Tipo `ContentType` é forte (union literal), não `string`.

**Dependências:** R1 (precisa do config carregado e validado).

---

### R3 — Generalizar `caseStudyFacets` → facets por coleção geradas (médio risco)

**Objetivo:** eliminar o acoplamento a `type === "case"`. A tabela 1:1 `case_study_facets` vira **uma tabela `<type>_facets` por coleção que declara `facets`**, gerada pelo codegen, mantendo o padrão `text[]` + índice GIN + `arrayOverlaps`. *Por que não uma tabela genérica `entry_facets(entry_id, facet_name, values)`: perderia os índices GIN dedicados por facet e complicaria as queries — descartado.*

**Arquivos afetados (`demo-corp-cms`):**
- `db/schema/content.ts` — remover `caseStudyFacets` hardcoded; o codegen passa a emitir **`db/schema/facets.generated.ts`** (uma tabela por coleção com facets, colunas `text[]` + índices GIN).
- `lib/content/entries.ts` — `extractCaseFacets` + `if (type === "case")` → `extractFacets(def, data)` genérico, disparado por `if (def.facets?.length)`. Roda no create e no publish.
- `lib/content/published.ts` — `listPublishedCases` → `listPublishedWithFacets(type, params)` genérico; o filtro por facets lê `def.facets` em vez de colunas fixas.
- `app/api/content/[type]/route.ts` — parsing de query params de facet passa a ser dirigido por `def.facets[].name`.

**Critérios de aceite:**
- Coleção `case` com os 4 facets (industry/service/region/outcome) gera tabela e queries idênticas em comportamento às atuais.
- Uma segunda coleção com facets (ex.: `insight` por `tag`) funciona sem código específico.
- Filtro por múltiplos facets via `arrayOverlaps` mantém o plano de query com índice GIN.

**Dependências:** R2 (o codegen já precisa estar emitindo schema; facets.generated é o mesmo pipeline).

---

### R4 (suporte, baixo risco) — Branding, nav e flags por-tipo do config

Não é "crítico" mas acompanha R1–R3 e fecha os pontos hardcoded restantes:
- `app/globals.css` → codegen emite `app/theme.generated.css` (bloco `@theme` de `config.branding.colors`), importado por `globals.css`.
- `app/(admin)/layout.tsx` → array `NAV` derivado de `config.collections` (label/segment/icon) + itens fixos (Dashboard, Media, Contacts, Languages, Users).
- `components/AdminNav.tsx` → texto "Demo Corp" → `config.branding.adminTitle`.
- `type === "person"` (ordenação drag-and-drop em `published.ts` e `[collection]/page.tsx`) → `def.orderable === true`.

### 5.5 O que extrai para `@cms-core` vs fica no template

```
packages/core/  (@cms-core/core — o "motor", workspace linkável por workspace:*, NÃO publicado)
  ├─ engine/          content_entries service, versioning, publish gate, snapshot
  ├─ auth/            Supabase Auth + MFA guards (ES256/JWKS), RBAC admin/editor
  ├─ media/           Bunny pipeline + checkImagePolicy
  ├─ i18n/            translation groups, locale fallback, registry de idiomas
  ├─ webhooks/        HMAC dispatch (revalidação do site)
  ├─ audit/           log append-only
  ├─ config/          tipos ClientConfig + validador Zod + buildRegistry/buildFields/buildZodSchemas  (JÁ ENTREGUE na Fase 0)
  └─ ui/              ContentEditor, RichTextEditor (Quill), MediaPicker, AdminNav (genéricos)

templates/client-app/  — template do workspace de cliente: casca Next.js 16 que consome
  @cms-core (via workspace:*) + arquivos *.generated:
  app/, db/schema/ (core + placeholders p/ .generated), lib/content/registry.ts,
  client.config.ts (placeholder), drizzle.config.ts (schemaFilter:["public"], preservar)
```

> **Nota (D1 monorepo):** o `packages/core/src/config` (tipos + validador Zod + builders) **já existe** — foi entregue na Fase 0. A extração do restante do motor (engine/auth/media/i18n/webhooks/audit/ui) para `packages/core` acontece na Fase 1, agora **sem** publish/registry: o consumo é por `workspace:*`.

O `demo-corp-cms` atual vira **o primeiro consumidor** (movido para dentro do monorepo como o primeiro workspace de cliente): seu `client.config.ts` reproduz exatamente os 9 tipos, e o teste de equivalência da Fase 0 confirma schema/migrations/read API gerados == existentes (gold-standard baseline).

### 5.6 Contrato de injeção `db`+schema no core (ADR-001, Decisão 1)

Os arquivos DB-coupled do motor (`entries`, `published`, `media-urls`, `guards`, `users/service`) importam a instância Drizzle `db` (`@/db`) e **tabelas concretas** de `@/db/schema` — que são **propriedade de cada cliente** (banco por cliente D4/D5; schema codegen'd na Fase 2). Eles **não podem simplesmente mudar de pasta**: o core não pode importar `@/db` nem tabelas de um cliente específico. A decisão travada é uma **factory que recebe as dependências do cliente por injeção**:

- O core **não importa** `db` nem tabelas. Cada módulo DB-coupled é uma **fábrica** `createEngine({ db, schema, audit, webhooks, facets })` / `createAuthGuards({ db, schema, supabase })` que fecha sobre as deps e retorna as funções já ligadas. O corpo é o de hoje, trocando `db`→`deps.db` e `contentEntries`→`deps.schema.contentEntries`. **Zero mudança de lógica** (capability-preserving; S0.3 intacto).
- O core declara um **Port tipado** (`EngineSchema`) com as tabelas do **núcleo** (nomes/colunas estáveis entre clientes: `content_entries`, `content_versions`, `media_assets`, `profiles`), usando os inferidores do Drizzle (`$inferSelect`) para preservar tipos fortes. Um `schema-shape.ts` no core é a **fonte de verdade estrutural** do Port.
- As tabelas **variáveis por cliente** (o literal do `contentTypeEnum`; as tabelas `<type>_facets`) **não** entram no Port base. O filtro/extração de facets entra por um **`FacetPort`** separado (`extract`/`upsert`/`filter`), que **generaliza o hoje-hardcoded `type === "case"`** (§1.4 ponto #2, §R3). O union forte `ContentType` vive na borda (no `content-types.generated.ts` do cliente) e é passado como parâmetro.
- O acoplamento `entries → audit/webhooks` (módulos da S1.4) deixa de ser um import direto e vira **colaborador injetado** em `EngineDeps` — resolvendo a inversão de dependência que travava mover `entries` antes de S1.4.
- Cada workspace-cliente ganha um `lib/core-runtime.ts` fino que instancia as factories com o `db`+schema locais e re-exporta a API; os call-sites atuais passam a importar desse arquivo (mudança mecânica).

**Alternativas rejeitadas (ADR-001):** só interfaces/portas puras (empurra a lógica de query de volta ao cliente — perde reuso); generics sem factory (`listEntries(db, schema, type, …)` em cada call-site — ergonomia ruim); singleton lendo `DATABASE_URL` no core (quebra D4/D5 e testes). Design completo, assinaturas e trade-offs: **`adr-001-core-di-and-packaging.md`**.

### 5.6.1 Seam do REGISTRY (config→motor) — o REGISTRY é uma dep injetada (ADR-002, Decisão 1)

O R1 (externalizar os mapas) esbarra num fato verificado: `REGISTRY`/`validateContent`/`defForType` são consumidos **DENTRO do core** — `engine/entries.ts` e `engine/published.ts` os importam estaticamente de `engine/types.ts`, onde vivem os 9 schemas Zod hand-written. Para o REGISTRY "derivar do config" sem o core importar `client.config.ts` (agnosticidade da ADR-001/D1) nem introduzir estado de módulo mutável, a decisão travada é: **o REGISTRY vira mais uma dependência injetada em `createEngine`** — o mesmo padrão de `db`/`schema`/`facets`.

- O core define o **tipo** do registry (`ContentTypeDef`/`ContentRegistry`) e um `RegistryBundle` (`registry` + `contentTypes` + `segmentToType` + `singletonPages`), mas **não** o conteúdo. `EngineDeps` ganha `registry: RegistryBundle`.
- `validateContent`/`defForType`/`resolveTypeParam` deixam de ser funções de módulo e passam a ser **métodos fechados sobre `deps.registry`**, retornados por `createEngine`. Call-sites internos trocam `validateContent(…)` → `deps.validateContent(…)` (mecânico).
- **A montagem config-driven acontece no cliente** (`lib/core-runtime.ts`): os builders da S2.1 (`buildContentRegistry`/`buildSingletonPages`/`buildSegmentToType`/`buildContentTypes`/`buildZodSchemas`) constroem o `RegistryBundle` a partir de `client.config.ts` e o injetam. As ~20 páginas trocam o **path** do import (`@cms-core/core/engine` → `@/lib/core-runtime`) — mesma migração da ADR-001.
- **Sem estado mutável, sem ordenação de import:** o REGISTRY não existe fora de uma instância do motor — não há janela para observar estado meio-inicializado (o risco da alternativa `configureEngine(registry)` com singleton, rejeitada). Fase 2: o `RegistryBundle` passa a ser alimentado pelos artefatos `*.generated` (`gen-content-types`/`gen-zod`) — o core não muda; só a origem do valor injetado (ADR-001 §6.5).

Design completo, assinaturas, alternativas (b) bootstrap-gerado / (c) singleton, e a auditoria por campo: **`adr-002-registry-seam-and-fieldconfig.md`**.

---

## 6. Codegen (build-time) — do `client.config.ts` aos artefatos tipados (D2)

O codegen é o coração de D2: transforma o config declarativo em artefatos tipados **antes** do build/migrate. Roda **uma vez no scaffolding** (para materializar o workspace `clients/<slug>/`) e **de novo no `prebuild`** de cada deploy (para garantir que o gerado nunca fica stale em relação ao config commitado).

> **Design completo do pipeline (ADR-003):** cada gerador foi medido contra seu alvo gold-standard REAL, provando reprodutibilidade byte-idêntica a partir do `ClientConfig`. Resultado: **nenhuma lacuna de contrato nova além de ADR-001/002**, exceto o atributo `uiHidden` (P3, acima). Pontos consolidados por ADR-003 e refletidos abaixo: (1) as **7 tabelas-molde do núcleo** (`content_entries`/`content_versions`/`media_assets`/`profiles`/`audit_log`/`webhook_endpoints`/`locales`/`leads` + enums `role`/`user_status`/`content_status`) **NÃO são geradas** — são molde fixo copiado no scaffold; só `enums.generated` (o literal `content_type`) e `facets.generated` (as `<type>_facets`) são config-driven no DB (torná-las config-driven violaria o Port da ADR-001); (2) `gen-theme`/`gen-nav` emitem SÓ o subconjunto derivável do config (6 cores+font / itens de coleção+`adminTitle`) — o resto (tokens semânticos danger/success/draft, blocos html/body/focus/motion, itens de nav fixos) é **template estático do core**, não gerado; (3) os geradores moram em `cli/src/codegen/` (o `cli/` é materializado como T0 de S2.3); (4) `gen-zod` serializa via `buildZodSchemas(config)` em runtime, não reconstrói `z.object` textualmente. Tabela gerador→saída→alvo→veredito, ordem/dependências, determinismo e riscos: **`adr-003-codegen-pipeline-design.md`**.

### 6.1 Gatilho e ordem

O template ganha estes scripts no `package.json` (estendendo os já existentes `db:generate`/`db:migrate`):

```jsonc
{
  "scripts": {
    "generate": "cms-core generate --config ./client.config.ts",
    "prebuild": "npm run generate",              // roda antes de `next build`
    "predb:generate": "npm run generate",         // codegen SEMPRE antes do drizzle
    "db:generate": "drizzle-kit generate",        // (já existe) produz migrations
    "db:migrate": "drizzle-kit migrate"           // (já existe) aplica via DIRECT_URL
  }
}
```

**Ordem invariável (nunca inverter):**
```
client.config.ts
   └─(cms-core generate)→ *.generated.ts / *.generated.css / .env.local
        └─(drizzle-kit generate)→ db/migrations/NNNN_*.sql
             └─(drizzle-kit migrate)→ schema aplicado no Postgres de CONTEÚDO (DIRECT_URL direto)
```
O `db:generate` depende do `generate` via `predb:generate` — assim é impossível gerar migrations a partir de um schema TS defasado.

> **(D5) O migrate roda contra o `DIRECT_URL` do banco de CONTEÚDO** — que é o Neon (endpoint direto) quando `database=neon`, ou o Supabase (5432) quando `database=supabase`. O projeto Supabase auth-only (caso Neon) **não recebe as migrations de conteúdo**: ele só carrega o schema `auth` gerenciado pelo Supabase. Ver §13.2.

### 6.2 O que cada gerador emite

| Gerador | Lê do config | Emite (local) | Garante tipos fortes |
|---------|--------------|---------------|----------------------|
| `gen-enums` | `collections[].type` | `db/schema/enums.generated.ts` (`pgEnum("content_type",[...])`) | enum Postgres + `ContentType` union literal |
| `gen-content-types` | `collections` | `lib/content/content-types.generated.ts` (`CONTENT_TYPES as const`, `SINGLETON_PAGES`, `SEGMENT_TO_TYPE`) — alimentam o `RegistryBundle` injetado em `createEngine` (§5.6.1) | `as const` → autocomplete no editor |
| `gen-facets` | `collections[].facets` | `db/schema/facets.generated.ts` (uma tabela `<type>_facets` por coleção, `text[]` + índice GIN) **+ `FacetPort` gerado (5 métodos: extract/upsert/filter/read/listFiltered)** | tabelas Drizzle tipadas |
| `gen-zod` | `collections[].fields` (incl. `default`/`trim`/`dedup`/`itemShape` — ADR-002 §2; **filtra `uiHidden`** — ADR-003) | `lib/content/schemas.generated.ts` (serializa `buildZodSchemas(config)` em runtime — byte-idêntico ao gold-standard) | `z.infer` por tipo |
| `gen-ui-fields` | `collections[].fields` (**filtra `uiHidden`** — ADR-003) | `lib/content/ui-fields.generated.ts` (`FIELDS`, `emptyData`) | `FieldSpec[]` por tipo |
| `gen-theme` | `branding.colors` (6) + `fontFamily` + `adminTitle` | `app/theme.generated.css` (SÓ o `@theme` das 6 cores+font; tokens semânticos/blocos html-body-focus = template estático — ADR-003 §3.7) | — |
| `gen-nav` | `collections` (label/segment/icon) + `branding.adminTitle` | `lib/admin/nav.generated.ts` (itens de coleção; itens fixos Dashboard/Media/Contacts/Languages/Users = hardcoded no gerador) | — |
| `gen-env` | `domains`, `providers` (incl. `database.kind`), secrets do provisioning | `.env.local` (nunca commitado) | — |

> **Não são geradores config-driven (molde fixo — ADR-003 §3.3, P1):** as tabelas do NÚCLEO (`content_entries`, `content_versions`, `media_assets`, `profiles`, `audit_log`, `webhook_endpoints`, `locales`, `leads`) e os enums estáticos (`role`, `user_status`, `content_status`) têm colunas estáveis entre clientes (ADR-001 §6.5) e são **copiadas verbatim** do template no scaffold — NÃO derivam do `ClientConfig`. Torná-las config-driven violaria o Port `EngineSchema` e o Artigo IV. No DB, só `enums.generated` (o literal `content_type`) e `facets.generated` (as `<type>_facets`) são gerados.

> **(D5) `gen-env` é o único gerador consciente do provider de banco.** Ele monta `DATABASE_URL` (runtime, pooled) e `DIRECT_URL` (migrations, direto) a partir do provider escolhido: **Supabase** → Supavisor (`:6543` pooled + `?sslmode=require` / `:5432` direto); **Neon** → endpoint `-pooler` (pooled) + endpoint direto, ambos com `?sslmode=require` obrigatório. As demais envs de conteúdo são idênticas. As envs de **auth** (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) apontam para o projeto Supabase de auth — que é o mesmo do conteúdo no caso Supabase, ou o projeto auth-only no caso Neon. Nenhum arquivo `*.ts`/`*.css` gerado muda entre providers. Ver §13.1.

### 6.3 Como os tipos fortes são garantidos

1. **Enum como fonte:** `contentTypeEnum` (Postgres) e `CONTENT_TYPES as const` (TS) saem do **mesmo** array `collections[].type`. O `type ContentType = typeof CONTENT_TYPES[number]` propaga o union para `REGISTRY`, `FIELDS`, read API — o compilador rejeita qualquer `type` fora do config.
2. **Zod ↔ TS alinhados:** `buildZodSchema(fields)` produz um schema cujo `z.infer` é o tipo do `data` daquele content type. O publish gate e o save usam esse schema — validação e tipo saem da mesma origem.
3. **Drizzle tipado:** as tabelas `*_facets.generated.ts` são declarações Drizzle reais (`pgTable`), então `$inferSelect`/`$inferInsert` funcionam e o `drizzle-kit` as vê no `schema` (via `db/schema/index.ts` que re-exporta os `.generated`).
4. **Barreira anti-drift:** CI roda `cms-core generate` + `drizzle-kit check`; se o gerado divergir do config ou das migrations, o build falha (ver risco em §10).

### 6.5 Como o codegen satisfaz o contrato de injeção do core (ADR-001)

O contrato de injeção (§5.6) e o codegen (D2) são **ortogonais**, e é isso que permite extrair o motor na Fase 1 **antes** do codegen existir. O Port (`EngineSchema`/`FacetPort`) é satisfeito igualmente por um schema **escrito à mão** (Fase 1, Demo Corp) ou **codegen'd** (Fase 2):

- **`EngineSchema` (núcleo):** `content_entries`, `content_versions`, `media_assets`, `profiles` têm colunas **estáveis** entre clientes. O codegen emite essas tabelas a partir de um molde fixo do core (o `schema-shape.ts`), então elas satisfazem o Port **por construção**. Nenhum cliente pode "não satisfazer" o núcleo — se o typecheck do workspace passa, o Port está satisfeito.
- **`FacetPort` (variável):** na Fase 1, o cliente injeta um `FacetPort` **escrito à mão** que espelha o `case_study_facets` atual (comportamento byte-idêntico). Na Fase 2, `gen-facets` passa a **gerar** esse `FacetPort` a partir de `collections[].facets` (uma tabela `<type>_facets` + `extract`/`upsert`/`filter` por coleção). O core nunca muda — só a origem da implementação injetada passa de manual para gerada.
- **Borda tipada (`ContentType`):** `gen-content-types` emite o `content-types.generated.ts` (union literal `as const`) que o workspace passa às factories como o tipo forte na borda. O core trabalha com o Port genérico; o union forte vive no cliente (gerado).

**Consequência para o backlog:** o `gen-facets` (S2.5) e o `gen-content-types` (S2.3) da Fase 2 **substituem** o que S1.3b injetou à mão — sem tocar no core. R3 (facets por coleção) fica mais simples porque o ponto de injeção (`FacetPort`) já existe desde a Fase 1. Design completo: **`adr-001-core-di-and-packaging.md`** (Decisão 3).

### 6.4 Onde os arquivos gerados ficam e como são tratados no git

- Arquivos `*.generated.ts` / `*.generated.css`: **commitados** dentro do workspace do cliente (`clients/<slug>/`, para o Vercel buildar sem depender do CLI da fábrica) mas marcados com header `// AUTO-GERADO por cms-core generate — não editar` e cobertos por lint que proíbe edição manual.
- `.env.local`: **nunca commitado** (`.gitignore`); vive só localmente e no painel de env do Vercel (injetado no provisioning, §7).
- `db/migrations/*.sql`: **commitados** dentro do workspace do cliente (são o histórico versionado do schema daquele cliente).

> **Nota (D1 monorepo):** como tudo vive num só repositório, os artefatos gerados e migrations de cada cliente ficam sob `clients/<slug>/`, isolados por pasta. O Vercel builda cada workspace pelo seu Root Directory — não há vazamento de artefatos entre clientes no build.

---

## 7. CLI `create-client` — design e provisionamento automático (D3 + D4)

### 7.1 Comandos e flags

```
cms-factory create-client --config <path>        # pipeline completo (scaffold→provision→deploy)
cms-factory validate      --config <path>        # só valida o ClientConfig (Zod), não escreve nada
cms-factory generate      --config <path>         # só codegen (usado no prebuild do workspace-cliente)
cms-factory provision     --config <path>         # (re)provisiona infra; idempotente
cms-factory deploy        --config <path>         # só o deploy (assume infra já provisionada)
cms-factory destroy       --config <path>         # tear-down da infra de um cliente (guardado por --yes)

Flags de create-client:
  --config <path>          # obrigatório
  --db <supabase|neon>     # (D5) banco de CONTEÚDO; conveniência que DEVE casar com
                           #   providers.database.kind do config (senão validate falha).
                           #   Ausente => vale o kind do config; config legado => supabase
  --out <dir>              # (D1 monorepo) destino do workspace do cliente
                           #   (default ./clients/<slug> — dentro do monorepo, não um repo novo)
  --skip-provision         # gera código + migrations, NÃO toca infra (modo D4-manual/local)
  --skip-deploy            # provisiona mas não faz o primeiro deploy
  --dry-run                # imprime o plano de execução sem efeitos colaterais
  --resume                 # retoma um provisionamento parcial a partir do state file
  --env-file <path>        # de onde ler os tokens de operador (default ./.factory.env)
```

> **(D1 monorepo)** `create-client` **não cria um repositório novo** — cria um **workspace** `clients/<slug>/` dentro do monorepo `criador-de-cms`, a partir do template, com `@cms-core` referenciado por `workspace:*`. Após criar o workspace, o gerenciador de workspace (pnpm) faz o link do core automaticamente no install.

### 7.2 Pipeline de scaffolding (etapas em ordem)

```
create-client --config ./clients/acme/client.config.ts

 1. validate-config    → Zod valida ClientConfig (nomes únicos, kinds válidos, facets ⊆ fields,
                         nenhum secret embutido). FALHA DURA aqui aborta tudo (nada foi criado).
 2. preflight          → checa presença/validade dos tokens de operador (§7.4) e disponibilidade
                         de nomes globais (Bunny storage zone, Vercel project). Falha cedo.
 3. scaffold workspace → copia templates/client-app para clients/<slug>/ + assets (logo);
                         (D1 monorepo) cria um WORKSPACE, não um repo — o root package.json
                         já inclui clients/* no campo workspaces
 4. inject config      → grava client.config.ts + package.json do workspace com
                         "@cms-core": "workspace:*" (link interno, sem registry)
 4b. link workspace    → pnpm install no root resolve o link clients/<slug> → packages/core
 5. codegen            → cms-core generate (enums, facets, zod, ui-fields, theme, nav)
 6. drizzle generate   → db:generate produz migrations a partir do schema gerado
 7. provision          → depende de database.kind (D5):
                          • supabase: Supabase(conteúdo+auth) → Bunny → Resend → Vercel
                          • neon:     Neon(conteúdo) + Supabase(auth-only) → Bunny → Resend → Vercel
                         grava secrets no state (§7.5, §13.3)
 8. write env          → gen-env materializa clients/<slug>/.env.local (DATABASE_URL/DIRECT_URL do
                         provider de conteúdo + envs de auth do projeto Supabase) e envia envs ao Vercel
 9. apply migrations   → db:migrate via DIRECT_URL direto do banco de CONTEÚDO (Neon ou
                         Supabase); o Supabase auth-only NÃO recebe migrations de conteúdo
10. seed admin         → SEED_ADMIN_PASSWORD gerado → seed-admin (idempotente) com email do config
11. first deploy       → cria projeto Vercel com Root Directory = clients/<slug> + deploy --prod
12. smoke test         → login admin (bootstrap MFA) + criar 1 entry + publicar + GET read API 200
13. handoff            → imprime resumo: URLs, admin email, senha temporária (uma vez), secrets no cofre
```

Com `--skip-provision`, as etapas 7/8/11/12 são puladas e o operador recebe um `clients/<slug>/.env.example` preenchido com placeholders (modo D4-manual, só para debug/local).

> **(D1 monorepo) onde ficam os secrets/env de cada cliente:** cada workspace tem seu próprio `clients/<slug>/.env.local` (git-ignored, coberto pelo `.gitignore` da raiz), que é o único lugar local com os secrets daquele cliente. Em runtime, os secrets vivem no painel de env do **projeto Vercel do cliente** (um por cliente). Nenhum secret é compartilhado entre workspaces, e nenhum `.env.local` de um cliente é visível ao build de outro (o Vercel builda cada workspace pelo seu Root Directory). Os tokens de **operador** da fábrica ficam num único `./.factory.env` na raiz do monorepo (git-ignored), fora dos workspaces de cliente.

### 7.3 Design do provisionamento automático (D4) — o caminho ambicioso

O provisionamento é um **orquestrador com state file, idempotência e rollback**. Cada provider é um **adapter** com a mesma interface:

```ts
interface ProviderAdapter {
  id: "supabase" | "neon" | "bunny" | "resend" | "vercel";
  ensure(ctx): Promise<ProvisionResult>;   // idempotente: cria OU reconcilia se já existe
  rollback(ctx): Promise<void>;             // desfaz o que ESTE adapter criou nesta run
}
```

**(D5) A composição de adapters é dirigida por `database.kind`.** O orquestrador monta a lista de adapters a rodar a partir do config:
- `database.kind === "supabase"` → `[supabase(conteúdo+auth), bunny, resend, vercel]` (comportamento pré-D5, inalterado).
- `database.kind === "neon"` → `[neon(conteúdo), supabase(auth-only), bunny, resend, vercel]` — **dois adapters de banco na mesma run**, com semânticas distintas: o Neon é a origem de `DATABASE_URL`/`DIRECT_URL`; o Supabase auth-only é a origem de `NEXT_PUBLIC_SUPABASE_*`/`SERVICE_ROLE_KEY` e recebe a config de SMTP (Resend). Ver §13.3 para o adapter Neon e o fluxo 2-provedores completo.

**State file (`clients/<slug>/.provision-state.json`, nunca commitado):** registra, por recurso, `{ status: pending|created|verified|failed, externalId, createdAt }`. É a fonte de idempotência e de `--resume`. Contém referências (project-ref, zone id) mas **os secrets vão para um cofre separado** (§7.6), não para o state em texto plano.

**Ordem das chamadas (dependências reais) — caso `database=supabase` (single-provider):**

```
1. Supabase (conteúdo + auth num só projeto — base de tudo)
   1a. POST Management API → criar projeto (org, region, plano, db password gerada)
   1b. poll status até "ACTIVE_HEALTHY" (projetos Supabase levam ~1-2 min)
   1c. GET api-keys → publishable (anon) + service_role (secret)
   1d. montar DATABASE_URL (Supavisor pooler 6543, sslmode=require) e DIRECT_URL
       (direct 5432) a partir do project-ref + db password
   1e. configurar SMTP do projeto com a RESEND_API_KEY (etapa 3 pode preceder esta sub-etapa)
2. Bunny.net (mídia — independente do DB, pode rodar em paralelo com 1, mas mantido serial p/ simplicidade)
   2a. POST Storage API → criar Storage Zone (nome global, região) → obtém zone id + password (BUNNY_STORAGE_KEY)
   2b. POST → criar Pull Zone apontando p/ a Storage Zone → obtém hostname .b-cdn.net (BUNNY_CDN_URL)
3. Resend (email — necessário antes de fechar o SMTP do Supabase em 1e)
   3a. POST /domains → registrar senderDomain → retorna registros DKIM/SPF
   3b. (semi-manual) publicar os registros DNS no provedor de domínio do cliente
   3c. poll GET /domains/{id} até status "verified" (pode exigir intervenção — ver riscos §10)
   3d. a RESEND_API_KEY é de conta (a sua) — reusada, não criada por cliente
4. Vercel (deploy — depende de TODOS os secrets acima)
   4a. POST /v9/projects → criar projeto (framework nextjs, teamSlug) COM
       rootDirectory = "clients/<slug>" (D1 monorepo — o projeto aponta para o
       subdiretório do workspace, não para a raiz do repo)
   4b. POST /v10/projects/{id}/env → gravar TODAS as envs (DATABASE_URL, DIRECT_URL,
       NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY,
       BUNNY_*, RESEND_API_KEY, SITE_URL, READ_API_KEY, WEBHOOK_SIGNING_KEY, PREVIEW_TOKEN_SECRET)
   4c. POST /v10/projects/{id}/domains → apontar adminSubdomain
   4d. deploy (via git integration com Root Directory = clients/<slug>, OU vercel CLI
       apontando para o diretório do workspace)
```

> **(D1 monorepo) o que muda no provisionamento:** **só o passo Vercel** — o projeto passa a apontar para o subdiretório `clients/<slug>/` do monorepo (Root Directory), em vez de para a raiz de um repo dedicado. **Supabase, Neon, Bunny e Resend são idênticos** (criam recursos por cliente exatamente como antes; o layout de código não os afeta). Todos os N projetos Vercel podem apontar para o mesmo repositório, cada um com um Root Directory diferente — é o recurso nativo de monorepo do Vercel.

**Ordem das chamadas — caso `database=neon` (2-provedores, D5):** idêntica, exceto que a etapa 1 vira **duas** etapas de banco (o resto — Bunny/Resend/Vercel — não muda):

```
0. Neon (CONTEÚDO — base de tudo; sem DB não há migrations nem seed)
   0a. POST Neon API → criar projeto (org, region, plano) → obtém project id
   0b. (opcional) criar/selecionar branch `main` de conteúdo
   0c. GET connection URIs → pooled (endpoint `-pooler`) e direto → montar
       DATABASE_URL (pooled, ?sslmode=require) e DIRECT_URL (direto, ?sslmode=require)
   0d. Neon fica ACTIVE quase instantâneo (não tem o poll de ~2 min do Supabase)
1. Supabase AUTH-ONLY (só o schema `auth` — NÃO recebe tabelas de conteúdo)
   1a. POST Management API → criar projeto (org, region, plano free basta)
   1b. poll status até "ACTIVE_HEALTHY"
   1c. GET api-keys → publishable (anon) + service_role (secret) → NEXT_PUBLIC_SUPABASE_*/SERVICE_ROLE_KEY
   1d. configurar SMTP do projeto com a RESEND_API_KEY (emails de convite/reset de AUTH)
   1e. NÃO montar DATABASE_URL/DIRECT_URL a partir deste projeto — o conteúdo é o Neon (0c)
2. Bunny.net …                         (idêntico ao caso supabase)
3. Resend …                            (idêntico)
4. Vercel …                            (idêntico; as envs de conteúdo vêm do Neon,
                                        as de auth vêm do Supabase auth-only)
```

> **Por que Neon primeiro no caso 2-provedores:** o conteúdo é a base do migrate/seed. O Neon é criado antes por consistência com "o mais fundamental primeiro" e porque provisiona rápido; o Supabase auth-only vem logo depois. Ambos são criados **na mesma run** e ambos entram no rollback (§7.5 / §13.3).

**Secrets gerados localmente (não vêm de provider):** `READ_API_KEY`, `WEBHOOK_SIGNING_KEY`, `PREVIEW_TOKEN_SECRET`, `SEED_ADMIN_PASSWORD`, e a `db password` (do Supabase no caso single-provider; a role/senha do Neon é entregue pelo próprio Neon na connection URI no caso 2-provedores) — todos via CSPRNG (`crypto.randomBytes`) quando gerados por nós.

### 7.4 Pré-requisitos do operador (tokens/escopos) — providenciar ANTES

Lidos de `./.factory.env` (nunca commitado). O `preflight` (etapa 2) valida presença + faz uma chamada read-only por provider para confirmar o token.

| Provider | Token | Como obter | Escopo mínimo |
|----------|-------|------------|---------------|
| **Supabase** | `SUPABASE_ACCESS_TOKEN` (Management API PAT) | Dashboard → Account → Access Tokens | criar projetos na org; ler api-keys; configurar SMTP |
| **Supabase** | `SUPABASE_ORG_ID` | Dashboard → Organization settings | — (identifica onde criar o projeto) |
| **Neon** (D5, só se `database=neon`) | `NEON_API_KEY` | Neon Console → Account settings → API Keys | criar projetos/branches; ler connection URIs (pooled + direto) |
| **Neon** (opcional) | `NEON_ORG_ID` / `NEON_PROJECT_ID` | Neon Console → Organization/Project settings | — (identifica onde criar; project id só p/ reusar projeto existente) |
| **Bunny.net** | `BUNNY_ACCOUNT_API_KEY` | Bunny Dashboard → Account → API | criar Storage Zones + Pull Zones |
| **Resend** | `RESEND_API_KEY` (conta própria) | Resend Dashboard (uma conta só, reusada entre clientes) | `domains:write`, envio | 
| **Vercel** | `VERCEL_TOKEN` | Vercel → Settings → Tokens | criar projeto/env/domain/deploy no team |
| **Vercel** | `VERCEL_TEAM_ID` (se team) | Vercel team settings | — |
| **DNS** | acesso ao provedor de DNS do domínio do cliente | — | publicar DKIM/SPF (Resend) e CNAME (Vercel domain) |

> **Nota Resend:** a `RESEND_API_KEY` é **de conta (a sua), reusada entre clientes** — só o `senderDomain` é registrado/verificado por cliente. As demais chaves (Supabase/Neon/Bunny/Vercel) são **criadas por cliente** pelo provisionamento.

> **(D5) Nota Neon:** `NEON_API_KEY` (e opcionalmente `NEON_ORG_ID`) só é **exigida quando algum cliente usa `database=neon`**. O `preflight` (etapa 2) só valida o token Neon se o config selecionar Neon — clientes 100% Supabase não precisam do token. Como as demais chaves de infra, a `NEON_API_KEY` fica **só em `./.factory.env`** (git-ignored) na raiz do monorepo, nunca dentro de um workspace de cliente.

### 7.5 Idempotência, falha parcial e rollback

**Idempotência (re-rodar sem duplicar):** cada `ensure()` primeiro **procura** o recurso pelo nome/slug determinístico (ex.: projeto Supabase `acme-cms`, storage zone `acme-media`, projeto Vercel `acme-cms`). Se existe e casa com o config → reconcilia (atualiza envs/domínio) em vez de recriar. O state file evita repolls desnecessários. `--resume` pula tudo marcado `verified`.

**Falha parcial (o provisionamento morre no meio):** o state file registra até onde chegou. Três estratégias por severidade:
- **Recoverable (timeout de poll, rate limit):** retry com backoff exponencial (limite configurável); ao esgotar, para e grava `failed` — `--resume` retoma.
- **Rollback automático (default para `create-client`):** se um adapter falha "duro" (ex.: Vercel recusa o projeto), os adapters anteriores executam `rollback()` na ordem inversa, removendo só o que **esta run** criou (nunca recursos pré-existentes reconciliados). Ordem de rollback: caso Supabase → `Vercel→Resend→Bunny→Supabase`; **caso Neon (D5)** → `Vercel→Resend→Bunny→Supabase(auth-only)→Neon` — **os DOIS recursos de banco entram no rollback**. O rollback é **best-effort e logado**: se um rollback falhar, o operador recebe uma lista explícita de recursos órfãos a limpar à mão.
- **Keep-and-resume (com `--resume`):** não faz rollback; deixa o parcial e retoma na próxima execução. Preferível quando um banco já foi criado (recriar Supabase custa ~2 min + perde a db password; recriar Neon é barato mas perde a role/URI).

**Regra de ouro:** o recurso de banco é criado **primeiro** (Supabase no caso single-provider; Neon → Supabase auth-only no caso 2-provedores) justamente porque é o mais caro/fundamental; assim, se algo falhar depois, `--resume` reaproveita o(s) banco(s) em vez de recriá-los. **(D5) Cuidado de idempotência no caso Neon:** o adapter Supabase auth-only e um eventual adapter Supabase de conteúdo (de outro cliente) usam nomes determinísticos distintos (`<slug>-auth` vs `<slug>-cms`) para nunca reconciliar o projeto errado — ver §13.3.

### 7.6 Onde os secrets gerados são guardados

| Secret | Origem | Destino de runtime | Destino de guarda (longo prazo) |
|--------|--------|--------------------|--------------------------------|
| `SUPABASE_SERVICE_ROLE_KEY` (+ anon/URL) | Supabase provision (projeto de conteúdo+auth **ou** auth-only) | Vercel env (encrypted) + `.env.local` (git-ignored) | cofre do operador (1Password/Bitwarden/Doppler) |
| `DATABASE_URL`, `DIRECT_URL`, db password/role | **Supabase provision** (caso supabase) **ou Neon provision** (caso neon — D5) | idem | idem |
| `BUNNY_STORAGE_KEY` | Bunny provision | idem | idem |
| `READ_API_KEY`, `WEBHOOK_SIGNING_KEY`, `PREVIEW_TOKEN_SECRET` | gerados (CSPRNG) | idem | idem |
| `SEED_ADMIN_PASSWORD` | gerado (CSPRNG) | usado uma vez no seed; **impresso uma única vez** no handoff | admin troca no 1º login; não é guardado |

**Regras não-negociáveis:** (1) secrets **nunca** entram no state file em texto plano nem em qualquer arquivo commitado; (2) o `.env.local` é git-ignored e o `.gitignore` do template já o cobre; (3) o handoff imprime a senha temporária do admin **uma única vez** e recomenda o fluxo troca-no-1º-login + TOTP; (4) a integração com o cofre (Doppler/1Password) é o destino recomendado — na v1 pode ser um arquivo `secrets/<slug>.json` gerado fora do repo e movido manualmente para o cofre (documentar no handoff).

### 7.7 Core compartilhado por workspace e propagação de fixes (D1 monorepo)

No modelo monorepo **não há publish, SemVer nem registry** — o core é compartilhado por link de workspace, então a propagação de fixes é intrínseca ao repositório:

- **`@cms-core` é linkado por `workspace:*`.** Todos os `clients/<slug>/` referenciam o **mesmo** `packages/core` do monorepo. Não há versão por cliente nem `coreVersion` a bumpar.
- **Propagação de fix:** um commit em `packages/core` já vale para todos os clientes — basta o redeploy de cada workspace (Vercel rebuilda a partir do repo). **Sem `npm publish`, sem PR de bump, sem Renovate.**
- **Mitigação obrigatória do trade-off (blast radius de código = N clientes):** a **CI do monorepo** deve rodar, a cada mudança em `packages/core`, o **typecheck + testes de TODOS os workspaces de cliente** (`clients/*`) — capturando qualquer regressão **antes** do deploy. Recomenda-se `drizzle-kit check` por workspace afetado (anti-drift do codegen), além do smoke test pós-deploy. Este é o gate que substitui o antigo "CI + testes por repo antes do merge de bump".
- **Migrations do core** (schema base, não do cliente) vivem no `packages/core` e são aplicadas por um `cms-core migrate` idempotente no deploy de cada cliente contra o `DIRECT_URL` do banco daquele cliente. Cada cliente ainda tem seu próprio banco (D4/D5) — o core compartilhado não compartilha dados.

---

## 8. Estrutura do projeto `criador-de-cms` (o MONOREPO — D1, revisada 2026-08-03)

A fábrica é um **único repositório com workspaces**. O root `package.json` declara os workspaces; o core, a CLI e cada cliente são workspaces linkados internamente por `workspace:*` (sem registry).

> **Nome do pacote core — `@cms-core/core` (ADR-001, Decisão 2):** `@cms-core` sozinho é **apenas um escopo** npm, não um nome de pacote instalável — `import "@cms-core/config"` não resolve como subpath, e hoje isso está contornado por **três aliases paralelos** (tsconfig `paths` + webpack `next.config.mjs` + vitest `vitest.config.ts`). A decisão travada é renomear o pacote para **`@cms-core/core`** (escopo `@cms-core` + nome `core`), num **único workspace** `packages/core`, com `exports` por subpath. Com um nome válido + `exports`, o import resolve **nativamente** e os três aliases tornam-se **desnecessários** (removidos). Alternativa multi-pacote (`@cms-core/engine`, `@cms-core/auth`, …, cada um um workspace) foi **considerada e adiada** — introduz versionamento/grafo de deps entre pacotes sem retorno para poucos clientes (mesma lógica de D1); reabrir se um módulo precisar de ciclo de release próprio.

```
criador-de-cms/                    # raiz do MONOREPO (um único repositório)
├─ package.json                    # ROOT — declara os workspaces + scripts de orquestração
│                                  #   { "workspaces": ["packages/*", "cli", "clients/*"] }  (npm/yarn)
│                                  #   — ou pnpm-workspace.yaml equivalente (recomendado, ver abaixo)
├─ pnpm-workspace.yaml             # (recomendado) lista packages/*, cli, clients/*
├─ .factory.env                    # tokens de operador da FÁBRICA (git-ignored) — um só p/ o monorepo
├─ .gitignore                      # cobre **/.env.local, **/.provision-state.json, secrets/
│
├─ packages/
│  └─ core/                        # @cms-core/core — o motor, linkado por workspace:* (NÃO publicado)
│     ├─ src/
│     │  ├─ config/                # tipos ClientConfig + validador Zod + builders  (JÁ ENTREGUE — Fase 0)
│     │  ├─ engine/schema-shape.ts # (ADR-001) shape canônico do núcleo — fonte de verdade do EngineSchema Port
│     │  └─ {engine,auth,media,i18n,webhooks,audit,ui}/   # extraídos na Fase 1 (factories createEngine/createAuthGuards)
│     └─ package.json              # "name":"@cms-core/core", "private":true; exports subpath (./config,./engine,./auth,…)
│
├─ cli/                            # a FÁBRICA — CLI cms-factory / cms-core generate (workspace)
│  ├─ bin/cms-factory.ts           # entrada (create-client, validate, provision, deploy, destroy)
│  ├─ src/
│  │  ├─ scaffold.ts               # copia templates/client-app → clients/<slug>/ + aplica config + assets
│  │  ├─ codegen/                  # gen-enums, gen-content-types, gen-facets, gen-zod,
│  │  │                            #   gen-ui-fields, gen-theme, gen-nav, gen-env
│  │  ├─ validate-config.ts        # valida ClientConfig com Zod (§4.2)
│  │  ├─ provision/                # adapters: supabase.ts, neon.ts (D5), bunny.ts, resend.ts, vercel.ts
│  │  │  ├─ neon.ts                # (D5) criar projeto/branch Neon; obter URIs pooled+direto
│  │  │  ├─ orchestrator.ts        # state file, idempotência, rollback (§7.5); compõe a lista
│  │  │  │                         #   de adapters por database.kind (supabase vs neon+auth-only)
│  │  │  └─ secrets.ts             # CSPRNG + escrita no cofre (§7.6)
│  │  └─ deploy.ts                 # primeiro deploy (Vercel Root Directory=clients/<slug>) + smoke test
│  └─ package.json                 # depende de @cms-core via workspace:*
│
├─ clients/                        # UM WORKSPACE POR CLIENTE (apps Next.js geradas)
│  ├─ demo-corp/               # o CMS-modelo, movido para dentro como 1º workspace-cliente
│  │  ├─ app/ db/schema/ lib/ …    # casca Next.js 16 que consome @cms-core (workspace:*)
│  │  ├─ client.config.ts          # config do cliente (D2 — fonte única do schema)
│  │  ├─ *.generated.ts/.css       # artefatos do codegen (commitados; header AUTO-GERADO)
│  │  ├─ db/migrations/*.sql        # histórico de schema DESTE cliente (commitado)
│  │  ├─ .env.local                # secrets DESTE cliente (git-ignored)
│  │  └─ package.json              # "@cms-core":"workspace:*"; scripts generate/prebuild/db:*
│  └─ <slug>/                       # demais clientes — mesma estrutura
│
├─ templates/
│  ├─ client-app/                  # template do workspace de cliente (casca Next.js copiada no scaffold)
│  └─ config-examples/             # exemplos de client.config.ts (acme, demo-corp baseline)
│
└─ docs/
   ├─ architecture/                # este documento
   └─ prd/                         # epic-001 e derivados
```

> **Nota (D1 monorepo):** o `client.config.ts` de cada cliente vive **no próprio workspace** (`clients/<slug>/`), dentro do monorepo — não em repositórios separados. `templates/client-app/` é a casca copiada no scaffold; `templates/config-examples/` guarda só exemplos/baseline. `packages/core/src/config` **já existe** (Fase 0).

### 8.1 Gerenciador de workspace — recomendação (D1 monorepo)

**Recomendação: pnpm workspaces** (sem Turborepo por ora).

**Por quê (contexto: poucos clientes, um único operador técnico):**
- **pnpm** tem o melhor suporte nativo a `workspace:*` (a sintaxe exata que D1 usa), links simbólicos determinísticos e um único `pnpm-lock.yaml` na raiz — ideal para linkar `@cms-core` a N workspaces sem duplicação. O store por content-addressing economiza muito disco com N apps Next.js que compartilham as mesmas dependências pesadas (Next, Drizzle, Zod).
- **npm/yarn workspaces** funcionam, mas o `workspace:*` do npm é mais recente/menos ergonômico e o hoisting é menos previsível para apps Next.js; ficam como alternativa se o operador já padroniza npm.
- **Turborepo (pnpm + Turbo)** agrega **cache de build e task-graph** — muito útil quando a CID (typecheck + testes de *todos* os `clients/*` a cada mudança no core, a mitigação obrigatória de D1) começar a ficar lenta. **Recomendação: adotar Turborepo só quando o número de clientes tornar a CI lenta** (ex.: >5–8 workspaces), aproveitando o cache incremental para rodar só o que o diff afeta. Enquanto forem poucos clientes, pnpm puro basta e mantém a stack mínima.

**Consequência para a CI:** com pnpm, a mitigação de D1 vira `pnpm -r --filter './clients/*' run typecheck test` disparado quando `packages/core` muda; ao adotar Turborepo, o mesmo gate roda via `turbo run typecheck test --filter=...[HEAD^]` com cache.

### 8.2 Mapa de `exports` do core e aliases removidos (ADR-001, Decisão 2)

O `packages/core/package.json` declara o surface público **exclusivamente** pelo campo `exports` (fonte única de verdade), com o pacote nomeado `@cms-core/core`:

```jsonc
// packages/core/package.json
{
  "name": "@cms-core/core",
  "private": true,
  "exports": {
    ".":          { "types": "./src/index.ts",          "default": "./src/index.ts" },
    "./config":   { "types": "./src/config/index.ts",   "default": "./src/config/index.ts" },
    "./engine":   { "types": "./src/engine/index.ts",   "default": "./src/engine/index.ts" },
    "./auth":     { "types": "./src/auth/index.ts",     "default": "./src/auth/index.ts" },
    "./media":    { "types": "./src/media/index.ts",    "default": "./src/media/index.ts" },
    "./i18n":     { "types": "./src/i18n/index.ts",     "default": "./src/i18n/index.ts" },
    "./webhooks": { "types": "./src/webhooks/index.ts", "default": "./src/webhooks/index.ts" },
    "./audit":    { "types": "./src/audit/index.ts",    "default": "./src/audit/index.ts" },
    "./ui":       { "types": "./src/ui/index.ts",       "default": "./src/ui/index.ts" }
  }
}
```

**Import surface final:** `@cms-core/core`, `@cms-core/core/config`, `@cms-core/core/engine`, `@cms-core/core/auth`, `@cms-core/core/media`, `@cms-core/core/{i18n,webhooks,audit,ui}` — todos resolvíveis nativamente por Node/webpack/vitest/tsc/IDE (o `@cms-core/core` é um nome de pacote válido e os subpaths batem no `exports`).

**Aliases removidos** (deixam de ser necessários com o nome válido + `exports`):

| Arquivo | Antes | Depois |
|---------|-------|--------|
| `clients/<slug>/tsconfig.json` | bloco `paths` `@cms-core*` → `packages/core/src/*` | **removido** (TS resolve por `exports`, `moduleResolution:"bundler"` já configurado) |
| `clients/<slug>/next.config.mjs` | `webpack.alias` `@cms-core*` | **removido**; **mantém** `transpilePackages:["@cms-core/core"]` (core é TS-fonte) |
| `clients/<slug>/vitest.config.ts` | `find/replacement` `@cms-core*` | **removido**; mantém só os shims `next/headers`/`server-only` e o alias `@/` |

O único ajuste transversal é o **rename mecânico** dos imports `@cms-core/…` → `@cms-core/core/…` (52 sites) e `"@cms-core/core":"workspace:*"` nos `package.json` dos workspaces. `ClientConfig.coreVersion` permanece `"workspace:*"`.

### 8.3 Estratégia de build do core — `tsc → dist/` para o `next build` de produção (ADR-004, 2026-08-04)

O `exports` da §8.2 apontava para `src/*.ts` **cru** (o core sempre foi consumido como TS-fonte via `transpilePackages`). Isso funciona para `tsc`/`vitest`/`tsx` (todos `moduleResolution:"bundler"`, que remapeia `.js`→`.ts`), mas **NÃO para o `next build` de produção**: o **Turbopack** do Next 16 (bundler default, sem fallback webpack) não faz esse remap ao transpilar um pacote TS-fonte cru, e falha ao resolver os **112 imports com extensão `.js`** (padrão NodeNext) dos 33 arquivos do core. Blocker pré-existente (nunca houve `BUILD_ID`), detectado em S2.7 AC6.

**Decisão (ADR-004, Opção A):** o `@cms-core/core` passa a ter um **build step** (`tsc -p tsconfig.build.json` → `dist/`), emitindo `dist/*.js` (com os specifiers `.js` REAIS que o Turbopack resolve) + `dist/*.d.ts`. Os `exports` da §8.2 mantêm os mesmos subpaths, mas o **alvo** muda de `src` para `dist`, com uma condição `development`→`src` que preserva o DX:

```jsonc
// packages/core/package.json (exports — alvo pós-ADR-004; nomes de subpath idênticos à §8.2)
"exports": {
  ".": {
    "development": "./src/index.ts",   // next dev / vitest / tsx / IDE → src cru (hot, sem build)
    "types":       "./dist/index.d.ts", // tipos do build
    "default":     "./dist/index.js"    // next build (prod) / Node → .js REAL (Turbopack resolve)
  }
  // …idem para ./config ./engine ./auth ./media ./i18n ./webhooks ./audit ./ui
}
```

**Consequências principais:**
- `next dev`/`vitest`/`tsx`/CLI continuam lendo `src` (condição `development`) — **DX inalterado, sem watch de build**.
- `next build` (produção) lê `dist/*.js` real → **build verde**.
- `transpilePackages:["@cms-core/core"]` deixa de ser necessário no cliente (mantido só como fallback inócuo se o subpath `ui`/CSS do Quill exigir); o **template de cliente da Fase 3 sai sem `transpilePackages`**.
- Subpath `ui`: o `import "quill/dist/quill.snow.css"` (side-effect DENTRO de `src/ui/RichTextEditor.tsx`) é **preservado verbatim** no emit; o Next o resolve pelo `quill` (dependency direta) do cliente.
- `packages/core/dist/` é **gerado e git-ignored**; buildado no `prebuild` do cliente (encadeia `pnpm --filter @cms-core/core run build`) e no CI (S1.5, antes de typecheck/build dos `clients/*`).
- Micro-tarefa: 3 arquivos do core (`engine/sanitize.ts`/`types.ts`/`ui-fields.ts`) têm imports **extensionless** (inconsistência mascarada pelo `bundler`) — corrigir p/ `.js` antes do emit (NodeNext-limpo).

Implementação: **S2.8** (`docs/stories/2.8.core-packaging-build.md`) — fecha o gate da S2.7 (AC6) e o Marco 2. Doc completo: `adr-004-core-packaging-build.md`.

---

## 9. Fluxo de criação de um novo cliente (passo a passo, com D4)

1. **Providenciar tokens do operador** (uma vez, ver §7.4) em `./.factory.env`. **(D5)** se algum cliente usar `database=neon`, incluir `NEON_API_KEY`.
2. **Escrever `client.config.ts`** — coleções, campos, facets, branding, domínios, locales, providers. **(D5)** escolher `providers.database.kind` (`supabase` ou `neon`) e preencher `providers.auth` (sempre Supabase).
3. **Validar** — `cms-factory validate --config …` (falha cedo em nome duplicado, facet órfão, kind inválido, secret embutido, e **(D5)** `--db` divergente do config).
4. **Rodar a fábrica** — `cms-factory create-client --config …` cria o **workspace `clients/<slug>/`** no monorepo e executa scaffold → codegen → `db:generate` → **provision** → migrate → seed admin → first deploy → smoke test. **(D1 monorepo)** o workspace referencia `@cms-core` por `workspace:*` (sem registry); o deploy Vercel usa Root Directory = `clients/<slug>/`. **(D5)** o provision é `Supabase/Bunny/Resend/Vercel` (caso supabase) ou `Neon + Supabase(auth-only)/Bunny/Resend/Vercel` (caso neon); o migrate roda contra o `DIRECT_URL` do banco de conteúdo (Neon ou Supabase).
5. **Publicar DNS** — publicar os registros DKIM/SPF (Resend) e o CNAME do `adminSubdomain` (Vercel) no provedor de DNS do cliente (único passo semi-manual).
6. **Primeiro login** — admin acessa o `adminSubdomain`, faz login com a senha temporária → troca senha → enrola TOTP (MFA) → cria conteúdo.
7. **Conectar o site público** — compartilhar `READ_API_KEY` e registrar o webhook `/api/revalidate` do site (a `WEBHOOK_SIGNING_KEY` já está no env do CMS).
8. **Guardar secrets** — mover `secrets/<slug>.json` para o cofre do operador; apagar o local.

---

## 10. Backlog faseado concreto (épicas + stories)

Ordem de execução **top-down**: Fase 0 → 5. Stories marcadas com dependências (`dep:`). Este backlog é acionável o suficiente para o @pm/@sm criarem epics/stories. AC = critério de aceite resumido. **A antiga "Fase 5" (coleções dinâmicas + UI web) foi arquivada** — ver Apêndice B. A **nova Fase 5** abaixo é o **banco plugável Neon (D5)** — não confundir com a arquivada.

### Fase 0 — Contrato de config + baseline (fundação)

**Épica E0: Contrato `ClientConfig` provado contra o Demo Corp.**

| Story | Objetivo | AC resumido | Arquivos/áreas | Dep |
|-------|----------|-------------|----------------|-----|
| **S0.1** Definir `ClientConfig` + Zod | Materializar o contrato da §4 como tipos + validador | tipos compilam; validador rejeita config inválido (nome dup, facet órfão, kind inválido, secret embutido) | novo `packages/core/src/config/{types.ts,validate.ts}` | — |
| **S0.2** Config baseline do Demo Corp | Escrever o `client.config.ts` que reproduz os 9 tipos atuais | descreve case/solution/person/region/insight + 4 singletons com todos os campos atuais | `templates/config-examples/demo-corp.config.ts` | S0.1 |
| **S0.3** Teste de equivalência (gold-standard) | Provar que o config baseline descreve o CMS atual sem perda | snapshot: `buildRegistry`/`buildFields`/enum derivados == literais atuais | `packages/core` tests | S0.2 |

### Fase 1 — Estabelecer o monorepo + mover o core reutilizável (D1, revisada 2026-08-03)

**Épica E1: estabelecer o monorepo (root `package.json` + workspaces + tooling), mover o Demo Corp para dentro como 1º workspace-cliente e mover o motor reutilizável para `packages/core` como workspace linkável (`workspace:*`), rodando idêntico. Sem publish/SemVer/registry.**

> **Nota (Fase 0 já entregue):** o `packages/core` **já existe** com `src/config` (tipos `ClientConfig` + validador Zod + builders) compatível com o monorepo (`@cms-core`, `private:true`). A Fase 1 constrói o esqueleto de workspaces **em volta** dele e move o restante do motor para dentro — não recria o pacote.

| Story | Objetivo | AC resumido | Arquivos/áreas | Dep |
|-------|----------|-------------|----------------|-----|
| **S1.1** Setup do monorepo (root + workspaces + tooling) | Criar o root `package.json` (workspaces `packages/*`, `cli`, `clients/*`) + `pnpm-workspace.yaml`, lockfile único e `.gitignore` (**/.env.local, **/.provision-state.json) | `pnpm install` na raiz linka os workspaces; `packages/core` resolve por `workspace:*`; `pnpm -r run typecheck` roda em todos | root `package.json`, `pnpm-workspace.yaml`, `.gitignore` (§8, §8.1) | S0.1 |
| **S1.2** Mover Demo Corp para `clients/demo-corp/` (1º workspace-cliente) | Trazer o CMS-modelo para dentro do monorepo como o primeiro workspace de cliente, referenciando `@cms-core` por `workspace:*` | `clients/demo-corp/` builda/typecheck/testes verdes; comportamento idêntico ao repo original | `clients/demo-corp/**` (import do repo `demo-corp-cms`) | S1.1 |
| **S1.3a (novo — ADR-001)** Contrato de injeção `db`+schema + rename do pacote | Materializar o contrato da §5.6: `EngineSchema`/`FacetPort`/`EngineDeps`, `createEngine`/`createAuthGuards`, `schema-shape.ts`; renomear pacote p/ `@cms-core/core` + `exports` subpath; remover os 3 aliases (tsconfig/webpack/vitest) | core compila com o contrato; nenhum import de `@/db`/tabela concreta no core; import `@cms-core/core/*` resolve **sem alias** | `packages/core/src/engine/{schema-shape,factory}.ts`, `packages/core/package.json` (exports), `clients/demo-corp/{tsconfig,next.config.mjs,vitest.config.ts}` | S1.2 |
| **S1.3b** Extrair engine(núcleo) + auth + media via contrato | Mover `entries`/`published`/`media-urls`/`guards`/`session`/`supabase/*`/`users/service` p/ o core como **factories**; o cliente ganha `lib/core-runtime.ts` que instancia com o schema local. (`media` + `engine`-puro já extraídos em S1.3 v1.0) | 4 gates verdes; S0.3 (gold-standard) intacto; comportamento idêntico consumindo o core linkado | `packages/core/src/{engine,auth,media}` ← os 9 arquivos DB-coupled diferidos; `clients/demo-corp/lib/core-runtime.ts` | S1.3a |
| **S1.4** Extrair i18n + webhooks + audit + ui para `packages/core` | Mover translation groups, HMAC dispatch, log de auditoria, editor genérico; **`audit`/`webhooks` viram colaboradores injetados** em `EngineDeps` (resolve a inversão que travava `entries`); repontar imports p/ `@cms-core/core` | `packages/core` compila; `clients/demo-corp` builda/typecheck/testes verdes; comportamento idêntico consumindo o core linkado | `packages/core/src/{i18n,webhooks,audit,ui}`, `clients/demo-corp/**` (imports) | S1.3b |
| **S1.5** CI do monorepo (gate anti-blast-radius) | Pipeline que, a cada mudança em `packages/core`, roda **typecheck + testes de TODOS os `clients/*`** (a mitigação obrigatória do trade-off de D1) | CI verde no baseline; mudança que quebre qualquer workspace-cliente reprova a CI antes do deploy; comando `pnpm -r --filter './clients/*' run typecheck test` | config de CI (`.github/workflows/` ou equivalente) (§3, §7.7) | S1.4 |

### Fase 2 — Externalização + codegen (os 3 refactors críticos)

**Épica E2: o CMS-modelo roda 100% a partir do config, sem literais hardcoded.** (Implementa R1–R4 da §5.)

| Story | Objetivo | AC resumido | Arquivos/áreas | Dep |
|-------|----------|-------------|----------------|-----|
| **S2.1 (R1)** Builders do config | `buildRegistry/buildFields/buildZodSchemas` derivam do config | consumidores inalterados; snapshot == baseline (S0.3) | `lib/content/{types,ui-fields}.ts`, novo `registry.ts`, `lib/media/policies.ts` | S1.4 |
| **S2.2 (R1)** `buildZodSchema` com regras finas | Mapear kinds→Zod preservando url/email/hex/youtube | validadores custom (`youtubeUrl`,`hexColor`) via registry nomeado; publish gate idêntico | `packages/core/src/config/build-zod.ts` | S2.1 |
| **S2.3 (R2)** Codegen de enum + content-types | `gen-enums`/`gen-content-types` emitem `.generated` | enum == 9 tipos atuais; `ContentType` union literal | `db/schema/enums.ts` → `enums.generated.ts`; `content-types.generated.ts` | S2.1 |
| **S2.4 (R2)** Wire drizzle após codegen | `predb:generate` garante codegen antes do drizzle; check anti-drift | `drizzle-kit check` = 0 diffs vs baseline | `package.json` scripts, CI | S2.3 |
| **S2.5 (R3)** Facets por coleção geradas | `gen-facets` emite tabela `<type>_facets` + **gera o `FacetPort`** (`extract`/`upsert`/`filter`) que S1.3b injetou à mão (ADR-001 §6.5) — o core não muda, só a origem da implementação passa de manual p/ gerada | `case` idêntico; 2ª coleção com facets funciona sem código específico | `db/schema/content.ts`→`facets.generated.ts`, `FacetPort` gerado, `app/api/content/[type]/route.ts` | S2.4 |
| **S2.6 (R4)** Branding + nav + flags do config | `gen-theme`/`gen-nav`; `orderable` substitui `type==="person"` | tema/nav/label vêm do config; ordenação por flag | `app/globals.css`→`theme.generated.css`, `app/(admin)/layout.tsx`, `components/AdminNav.tsx`, `published.ts`, `[collection]/page.tsx` | S2.5 |
| **S2.7** Regressão end-to-end | Demo Corp 100% config-driven == produção | e2e (Playwright) verde; read API idêntico | `demo-corp-cms/tests` | S2.6 |

### Fase 3 — CLI scaffolder (D3, sem provisionamento)

**Épica E3: `cms-factory create-client --skip-provision` gera um workspace-cliente `clients/<slug>/` pronto para migrar localmente.**

| Story | Objetivo | AC resumido | Arquivos/áreas | Dep |
|-------|----------|-------------|----------------|-----|
| **S3.1** `validate` + `generate` | Comandos de validação e codegen standalone | `cms-factory validate` e `generate` funcionam sobre um config | `cli/bin`, `cli/src/{validate-config,codegen}` | S2.7 |
| **S3.2** `scaffold workspace` + inject | Copiar `templates/client-app` → `clients/<slug>/` + injetar config/assets/package.json (`@cms-core`:`workspace:*`) | workspace gerado builda com `@cms-core` linkado; root workspaces já inclui `clients/*` | `cli/src/scaffold.ts`, `templates/client-app` | S3.1 |
| **S3.3** Pipeline `create-client --skip-provision` | Orquestrar scaffold-workspace→link→codegen→db:generate | rodar em um config (ex.: acme) cria `clients/acme/` + migrations; `pnpm --filter acme db:migrate` local funciona | `cli/bin/cms-factory.ts` | S3.2 |
| **S3.4** Baseline via CLI | Gerar o Demo Corp a partir do config baseline pela CLI | workspace gerado == `clients/demo-corp` (gold-standard) | fluxo E2E CLI | S3.3 |

### Fase 4 — Provisionamento + deploy automáticos (D4 + adapter Neon/fluxo 2-provedores D5)

**Épica E4: "do config ao CMS no ar" — provision (Supabase **ou** Neon+Supabase-auth-only)/Bunny/Resend/Vercel + deploy + smoke test.**

| Story | Objetivo | AC resumido | Arquivos/áreas | Dep |
|-------|----------|-------------|----------------|-----|
| **S4.1** Orchestrator + state file | Motor de provisionamento com state, idempotência, `--resume`; **compõe adapters por `database.kind`** | state persistido; re-rodar não duplica; lista de adapters correta por provider (D5) | `cli/src/provision/orchestrator.ts` | S3.4 |
| **S4.2** `secrets.ts` (CSPRNG + cofre) | Gerar secrets e nunca vazá-los | secrets fora do state/git; handoff imprime senha uma vez | `cli/src/provision/secrets.ts` | S4.1 |
| **S4.3** Adapter Supabase | Criar projeto, poll ACTIVE, coletar keys, montar URLs, SMTP; **suporta modo auth-only (sem conteúdo)** | projeto criado; `DATABASE_URL`/`DIRECT_URL`/keys corretos; modo auth-only não monta URLs de conteúdo; idempotente | `cli/src/provision/supabase.ts` | S4.1 |
| **S4.4** Adapter Bunny | Criar Storage Zone + Pull Zone | `BUNNY_STORAGE_KEY`/`BUNNY_CDN_URL` corretos; idempotente | `cli/src/provision/bunny.ts` | S4.1 |
| **S4.5** Adapter Resend | Registrar domínio, retornar DKIM/SPF, poll verificação | domínio registrado; instruções DNS emitidas; poll até verified | `cli/src/provision/resend.ts` | S4.1 |
| **S4.6** Adapter Vercel | Criar projeto, gravar envs, apontar domínio, deploy | projeto no ar; envs completas (conteúdo do Neon **ou** Supabase; auth do Supabase); domínio custom apontado | `cli/src/provision/vercel.ts` | S4.3, S4.4, S4.5 |
| **S4.7** Rollback + falha parcial | Rollback em ordem inversa; `--resume`; recursos órfãos logados; **dois recursos de banco no rollback no caso Neon** | falha em qualquer adapter → rollback do que a run criou; parcial retomável | `orchestrator.ts` | S4.6, S4.10 |
| **S4.8** Migrate + seed + smoke test | Aplicar migrations no `DIRECT_URL` de conteúdo, seed admin idempotente, smoke test | login bootstrap MFA + criar/publicar entry + read API 200 (nos DOIS casos de banco) | `cli/src/deploy.ts`, `scripts/seed-admin.ts` | S4.6 |
| **S4.9** Redeploy dos workspaces após fix do core (D1 monorepo) | Como o core é linkado por `workspace:*`, um fix já vale para todos; automatizar o redeploy dos `clients/*` afetados após a CI verde (sem publish/bump) | mudança em `packages/core` → CI roda typecheck+testes de todos os `clients/*` (gate S1.5) → redeploy dos workspaces; `drizzle-kit check` por workspace afetado sem drift | CI/deploy hooks (§3, §7.7) | S4.8, S1.5 |
| **S4.10 (D5)** Adapter Neon | Criar projeto/branch Neon, obter URIs pooled+direto, montar `DATABASE_URL`/`DIRECT_URL` (`sslmode=require`) | projeto Neon criado; URLs corretas; `rollback` deleta projeto; idempotente por nome `<slug>-content` | `cli/src/provision/neon.ts` | S4.1 |
| **S4.11 (D5)** Fluxo 2-provedores + preflight Neon | Orquestrar `neon(conteúdo)+supabase(auth-only)`; preflight valida `NEON_API_KEY` só se algum config usa Neon | pipeline Neon completo até deploy; `--db=neon` E2E; tokens Neon validados no preflight | `orchestrator.ts`, `cli/src/preflight.ts`, `.factory.env` docs | S4.10, S4.3, S4.6, S5.2 |

**Contagem:** Fase 0 = **3**, Fase 1 = **6** *(revisada 2026-08-03 — antes 5; S1.3 dividida em S1.3a (contrato de injeção + rename do pacote, ADR-001) + S1.3b (extração via factory) após o design spike)*, Fase 2 = **7**, Fase 3 = **4**, Fase 4 = **11**, Fase 5 = **5** → **36 stories**.

### Fase 5 — Banco de conteúdo plugável Supabase/Neon (D5 — config + codegen + schema condicional)

**Épica E5: `providers.database` vira união discriminada; o codegen e o schema suportam conteúdo no Neon com auth no Supabase, sem mudar o runtime.** Precede/alimenta as stories Neon da Fase 4 (a orquestração 2-provedores S4.11 depende de S5.2).

| Story | Objetivo | AC resumido | Arquivos/áreas | Dep |
|-------|----------|-------------|----------------|-----|
| **S5.1** União discriminada `providers.database` + `providers.auth` | Estender o contrato do config (§4.1) e a validação (§4.2) | tipos compilam; `kind:"supabase"\|"neon"`; regra Supabase-único (auth.region==database.region); `--db` divergente falha | `packages/core/src/config/{types.ts,validate.ts}` | S0.1 |
| **S5.2** `gen-env` consciente do provider | Montar `DATABASE_URL` pooled + `DIRECT_URL` direto por provider (Supavisor vs `-pooler` Neon; `sslmode=require`) | `.env.local`/Vercel corretos p/ ambos; nenhum `*.ts/*.css` gerado muda entre providers | `cli/src/codegen/gen-env.ts` | S5.1 |
| **S5.3** Codegen condicional de `profiles` (FK auth) | Omitir a FK `profiles_id_auth_users_fk` + import `authUsers` quando `database=neon` | colunas de `profiles` idênticas; FK presente só no caso Supabase; `drizzle-kit check` = 0 diffs em cada caso | `db/schema/profiles.ts` → gerador; §13.4 | S5.1, S2.4 |
| **S5.4** Deleção de usuário sem cascade (caso Neon) | Substituir o `onDelete: cascade` da FK por caminho explícito (ou `status='disabled'` na v1) | deletar/desativar usuário no Supabase reflete no `profiles` do Neon; sem órfão silencioso | `@cms-core` auth admin path | S5.3 |
| **S5.5** Teste de equivalência cross-provider | Provar que o mesmo config (trocando só `database.kind`) gera runtime idêntico e passa o smoke test nos dois bancos | build/typecheck idênticos; smoke test verde no Supabase e no Neon; `prepare:false` ok no `-pooler` Neon | testes E2E | S5.2, S5.3, S5.4 |

### Fase 6 (candidata, NÃO decidida) — Config-from-URL / Site Introspection

**Feature candidata, POSTERIOR às Fases 2–5.** Frente de autoria que infere um `ClientConfig` (rascunho revisável) a partir de um site existente — introspecção → seleção interativa de seções → geração do config → conectar o site via SDK tipado da read API + revalidação. Aditiva e desacoplada do core; não antecipa nem compete com a Fase 2. Brief de viabilidade + design + pontos de decisão em **`docs/architecture/feature-config-from-url.md`**. Backlog detalhado só se/quando aprovada.

---

## 11. Riscos e mitigações

### 11.1 Riscos gerais da fábrica

| Risco | Sev. | Mitigação |
|-------|------|-----------|
| **(D1 monorepo) Fix no core propaga para TODOS os clientes sem versionamento** — sem `@cms-core` publicado e sem pin de versão por cliente, um commit em `packages/core` atinge todos os `clients/*` no próximo deploy (blast radius de *código* = N; o de *dados/infra* continua 1 via D4/D5). Uma regressão no core pode quebrar vários clientes ao mesmo tempo. | **Alta** | **CI do monorepo roda typecheck + testes de TODOS os workspaces de cliente (`clients/*`) a cada mudança em `packages/core`** — pega a quebra antes do deploy (story S1.5, gate). `drizzle-kit check` por workspace afetado (anti-drift). Redeploy controlado dos workspaces só após a CI verde (S4.9). Ao crescer o nº de clientes, adotar Turborepo p/ manter a CI rápida (§8.1). Este é o trade-off aceito de D1 (revisão 2026-08-03) em troca de simplicidade de manutenção. |
| **Codegen desalinhado com migrations** (enum gerado ≠ migration aplicada) | Alta | `db:generate` sempre após o codegen (`predb:generate`); CI valida drift (`drizzle-kit check`, S2.4) |
| **Zod gerado do config perde regras finas** (ex.: `brandColor` hex, `youtube` custom) | Média | `FieldConfig.validate` (pattern) + validadores custom nomeados (`youtubeUrl`/`hexColor`) + escape hatch `kind:"json"` (S2.2) |
| **Facets genéricas perdem performance** vs tabela dedicada | Média | Tabela por coleção com índice GIN, igual ao padrão atual (S2.5) |
| **Custo de infra N×** (Supabase/Vercel/Bunny por cliente) | Média | Free/low tier por cliente; teto de custo por cliente monitorado; ver §11.2 |
| **Segredo vazado em config versionado** | Alta | Validador rejeita secrets no config; config versiona só emails/domínios/nomes de zona (§4.2) |
| **Custom por cliente que o config não cobre** | Média | Escape hatch: o workspace `clients/<slug>/` pode ter `overrides/` que estende o core localmente sem tocar `packages/core` (mudança local ao workspace, não afeta outros clientes) |
| **Perda de capacidade vs Demo Corp atual** | Alta | Fase 0 fixa o gold-standard baseline + teste de equivalência (S0.3) bloqueia regressão |
| **(D5) Runtime de conteúdo divergir entre providers** (código passa a ter `if kind==="neon"` espalhado) | Média | Abstração é 100% na connection string: só o `gen-env` conhece o provider; `db/index.ts`/`drizzle.config.ts` idênticos; teste de equivalência cross-provider (S5.5) garante runtime único. Ver §13.1 |

### 11.2 Riscos específicos do provisionamento automático (D4)

| Risco | Sev. | Mitigação |
|-------|------|-----------|
| **Falha no meio do provisionamento** deixa infra órfã (ex.: Supabase criado, Vercel falhou) | Alta | State file + rollback em ordem inversa (só o que a run criou) + `--resume`; recursos que o rollback não conseguir apagar são **listados explicitamente** para limpeza manual (S4.1/S4.7) |
| **Verificação de domínio Resend trava** (DNS não propagou / operador não publicou DKIM) | Alta | Etapa DNS é **semi-manual e assíncrona**: o provisionamento emite os registros e faz poll com timeout; ao esgotar, para em estado retomável em vez de falhar duro; email/SMTP não bloqueia o deploy do admin (só o envio de convites) |
| **Rate limits / quotas de API** (Supabase org, Vercel, Bunny) | Média | Backoff exponencial + jitter; respeitar `Retry-After`; `preflight` checa quota antes de começar; serializar criações (não paralelizar por padrão) |
| **Nome global já em uso** (storage zone Bunny, projeto Vercel são namespaces globais/de-team) | Média | `preflight` (etapa 2) checa disponibilidade e **falha antes** de criar qualquer coisa; sugere sufixo |
| **Secrets vazando** (state file, logs, `.env` commitado) | Alta | Secrets nunca no state em texto plano; `.env.local` git-ignored; logs redigem valores sensíveis; senha admin impressa uma única vez; destino recomendado = cofre (Doppler/1Password) (§7.6) |
| **Custo por cliente cresce silenciosamente** (projetos Supabase/Neon/Vercel pagos criados sem controle) | Média | `plan` explícito no config (default `free`); `destroy` para tear-down de clientes descontinuados; relatório de custo por cliente no handoff. **(D5)** o Neon adiciona scale-to-zero/branching como alavanca de custo, mas o caso Neon soma um projeto Supabase auth-only (free) — contabilizar ambos no relatório |
| **Timeout longo do Supabase** (criação leva 1–2 min) trava a UX da CLI | Baixa | Poll com feedback de progresso; o banco mais caro de recriar é criado primeiro → `--resume` reaproveita. **(D5)** o Neon provisiona quase instantâneo; no caso 2-provedores o poll de ~2 min é só do Supabase auth-only |
| **Token de operador com escopo excessivo** vazando dá acesso a todos os clientes | Alta | Tokens ficam só em `.factory.env` (git-ignored) na raiz do monorepo, na máquina do operador; escopo mínimo documentado (§7.4); rotação periódica recomendada; nunca embarcados num workspace de cliente |
| **Idempotência falsa** (reconciliar um recurso de OUTRO cliente por colisão de nome) | Média | Nomes determinísticos com `slug` do cliente como prefixo; `ensure()` valida que o recurso encontrado casa o config antes de reconciliar |

### 11.3 Riscos específicos do modelo 2-provedores (D5 — conteúdo no Neon + auth no Supabase)

Só se aplicam quando `database.kind === "neon"`. O caso `supabase` (single-provider) não tem nenhum destes.

| Risco | Sev. | Mitigação |
|-------|------|-----------|
| **Sem FK cross-database entre `content_entries.createdBy` e o usuário de auth** — hoje há uma cadeia de FKs `content_entries.createdBy → profiles.id → auth.users.id` no MESMO Postgres. Com o conteúdo no Neon e o `auth` no Supabase, a FK `profiles.id → auth.users.id` deixa de ser possível (bancos diferentes). | **Média** | **Por design, não há integridade referencial cross-DB — e não precisa haver.** `createdBy`/`updatedBy`/`authorId` já são apenas `uuid` que guardam o `auth.users.id`; o valor é o `claims.sub` do JWT (guards.ts). No caso Neon, `profiles` mora **no Neon** (junto do conteúdo, pois `guards.ts` lê `profiles` pela conexão `DATABASE_URL` de conteúdo) e a FK `profiles_id_auth_users_fk` **é omitida** (o codegen não a emite quando `database=neon`). `profiles.id` continua sendo o mesmo UUID do usuário Supabase, só que sem constraint FK forçando. Ver §13.4 para o mecanismo exato. |
| **Órfãos de `profiles` quando um usuário é deletado no Supabase Auth** — hoje o `onDelete: cascade` da FK apaga o `profiles` automaticamente ao deletar o `auth.users`. Sem a FK (caso Neon), deletar o usuário no Supabase deixa a linha `profiles` órfã no Neon. | **Baixa** | Deleção de usuário é operação administrativa rara e feita pela app (`createAdminClient()`), não direto no banco. A app passa a apagar/desativar o `profiles` no Neon **na mesma operação** em que deleta o `auth.users` no Supabase (a lógica sai da FK e vira código explícito no core, só no caminho Neon). Alternativa aceitável na v1: marcar `profiles.status='disabled'` em vez de deletar (o app já suporta `disabled`). |
| **Divergência de região/latência entre Neon (conteúdo) e Supabase (auth)** — auth e conteúdo em provedores/regiões diferentes podem somar latência num request que toca os dois (guards lê `profiles` no Neon + valida JWT). | **Baixa** | O JWT é validado **localmente** via JWKS cacheado (ES256, sem round-trip ao Supabase — confirmado em `guards.ts`), então o Supabase não está no caminho quente. O único acesso de dados por request é `profiles` no Neon (mesma conexão do conteúdo). Recomendar `auth.region` próxima da `database.region` para os fluxos que chamam o Supabase (login, enroll MFA, convite). |
| **Dois projetos = duas superfícies de secret/rotação** (service_role do Supabase auth-only + role do Neon) | Média | Ambos entram no mesmo state/cofre e no mesmo destroy (§7.6, §13.3). `destroy` remove os dois recursos. Nenhum secret novo em texto plano no state. |
| **Confusão operacional: rodar migrations de conteúdo contra o Supabase auth-only** apagaria/criaria tabelas no lugar errado. | Média | O `DIRECT_URL` gerado no caso Neon aponta **sempre** para o Neon; o projeto Supabase auth-only nunca recebe `DATABASE_URL`/`DIRECT_URL`. O `drizzle.config.ts` lê só `DIRECT_URL` → é fisicamente impossível o migrate mirar o Supabase auth-only. Ver §13.2. |
| **`drizzle-orm/supabase` `authUsers` referenciado no schema base** — `profiles.ts` importa `authUsers` de `drizzle-orm/supabase` para declarar a FK. | Média | No caso Neon o codegen emite `profiles` **sem** o bloco `foreignKey(... authUsers ...)`; o import de `authUsers` some do arquivo gerado. O schema TS de `profiles` fica idêntico em colunas — muda só a ausência da constraint. Coberto pela story de codegen condicional (S5.2). |

---

## 12. Decisões resolvidas e questões residuais

As 8 perguntas em aberto da versão anterior foram **resolvidas ou tornadas obsoletas** pelas 5 travas (ver topo). Resumo:

| Pergunta anterior | Situação |
|-------------------|----------|
| Quantos clientes / layout de código (A vs B) | **Resolvida por D1** — **MONOREPO** (revisão 2026-08-03): um único repositório, core linkado por `workspace:*`, um workspace por cliente. Independe de volume; o isolamento de dados/infra vem de D4/D5. Opção A (1 repo por cliente + registry) foi considerada e revertida. |
| Coleções dinâmicas em runtime | **Resolvida por D2** — não entram; schema fixo na criação (Fase 5 arquivada, Apêndice B). |
| UI vs CLI | **Resolvida por D3** — CLI. |
| Provisionamento automático desde já | **Resolvida por D4** — sim, é o fluxo-alvo (Fase 4). |
| Banco de conteúdo (Supabase fixo vs plugável) | **Resolvida por D5** — plugável Supabase/Neon por cliente; auth sempre Supabase na v1. Auth próprio arquivado. |
| **Registry do `@cms-core`** | **Tornada obsoleta pela revisão de D1 (2026-08-03)** — o monorepo linka o core por `workspace:*`; **não há registry nem publish**. A antiga questão residual "npm privado vs GitHub Packages" saiu do escopo. |
| Budget de infra por cliente | Parcialmente coberto (`plan` no config + `destroy` + relatório de custo); **teto absoluto por cliente** ainda a definir pelo dono. |

**Questões residuais (não bloqueiam o backlog, decidir antes da Fase 1/4/5):**
1. **Gerenciador de workspace do monorepo (D1)** — pnpm (recomendado) vs npm/yarn workspaces; e **quando** introduzir Turborepo (recomendação: só quando a CI de todos os `clients/*` ficar lenta, tipicamente >5–8 clientes). Afeta S1.1 e o desempenho da CI (S1.5). Ver §8.1.
2. **Provedor de DNS** — os domínios dos clientes ficam num provedor único gerenciável por API (automatizar DKIM/CNAME) ou variam por cliente (passo semi-manual da §9.5 permanece)? Afeta o grau de automação de S4.5/S4.6.
3. **Cofre de secrets** — Doppler, 1Password ou arquivo movido à mão na v1? Afeta S4.2.
4. **(D5) Deleção de usuário no caso Neon** — sem a FK `onDelete: cascade`, escolher entre "apagar `profiles` no Neon na mesma operação que deleta o `auth.users`" vs "só marcar `disabled`". Recomendação: `disabled` na v1 (menor risco, o app já suporta). Afeta S5.4.
5. **(D5) Pgbouncer/pooler do Neon vs `prepare:false`** — o `db/index.ts` já usa `prepare: false` (necessário para o Supavisor transaction mode); confirmar que a mesma flag é adequada ao endpoint `-pooler` do Neon (é — o pooler do Neon também é transaction-mode PgBouncer). Não requer mudança de código; validar no smoke test (S5.5).

---

## 13. Banco de conteúdo plugável Supabase/Neon (D5) — design completo

Esta seção é o design definitivo de D5. Premissa central, verificada no CMS-modelo: **o runtime de conteúdo já é 100% provider-agnóstico**. O `db/index.ts` faz `postgres(process.env.DATABASE_URL, { prepare: false })` + `drizzle(client, { schema })`; o `drizzle.config.ts` lê `process.env.DIRECT_URL`. Nenhum dos dois menciona "supabase". Portanto **plugar Neon é uma mudança de connection string + adapter de provisionamento — zero mudança no código de runtime de conteúdo.**

### 13.1 Abstração de conexão — `DATABASE_URL` (runtime pooled) vs `DIRECT_URL` (migrations)

O CMS precisa de **duas** URLs para o banco de conteúdo, e essa dualidade já existe hoje (Supavisor). D5 só a estende para o Neon:

| URL | Uso | Supabase | Neon |
|-----|-----|----------|------|
| `DATABASE_URL` | **Runtime** (serverless, transaction-pooled). Consumida por `db/index.ts` com `prepare:false`. | Supavisor **pooler** (`:6543`), `?sslmode=require` | endpoint **`-pooler`** (host `ep-xxx-pooler.<region>.aws.neon.tech`), `?sslmode=require` |
| `DIRECT_URL` | **Migrations / pg_dump** (session-scoped). Consumida por `drizzle.config.ts`. | conexão **direta** (`:5432`) | endpoint **direto** (host `ep-xxx.<region>.aws.neon.tech`, sem `-pooler`), `?sslmode=require` |

**Como o config/env abstrai:** o único componente consciente do provider é o `gen-env` (§6.2). Ele recebe `providers.database.kind` + os outputs do adapter de provisionamento e monta as duas URLs no formato do provider escolhido, gravando exatamente as mesmas duas chaves (`DATABASE_URL`, `DIRECT_URL`) no `.env.local` e no Vercel. A partir daí:

- **`db/index.ts` — IDÊNTICO.** Já usa `DATABASE_URL` + `prepare:false`. O `prepare:false` é exatamente o que o pooler do Neon (PgBouncer transaction mode) também exige — a mesma flag serve os dois. **Nenhuma alteração.**
- **`drizzle.config.ts` — IDÊNTICO.** Já usa `DIRECT_URL` e `schemaFilter:["public"]`. O `schemaFilter` continua correto: no Neon não existe schema `auth` (não há o que ignorar); no Supabase auth-only o migrate nem toca (§13.2). **Nenhuma alteração.**

> **Neon exige `sslmode=require`** em ambas as URLs (o Supabase também aceita/usa). O `gen-env` sempre anexa `?sslmode=require` — no Supabase é o comportamento atual, no Neon é obrigatório.

### 13.2 Migrations no caso 2-provedores

- As migrations de conteúdo rodam via `drizzle-kit migrate` contra o **`DIRECT_URL` do banco de conteúdo** — Neon (endpoint direto) quando `database=neon`, Supabase (`:5432`) quando `database=supabase`.
- No caso Neon, o **projeto Supabase auth-only NÃO recebe as migrations de conteúdo**. Ele só carrega o schema `auth` gerenciado pelo próprio Supabase (usuários, factors MFA, sessions). É fisicamente impossível o migrate mirar o projeto errado porque só existe **um** `DIRECT_URL` e ele aponta para o Neon.
- Consequência do `schemaFilter:["public"]`: no Supabase, o drizzle já ignorava `auth`. No Neon, `public` é o único schema de aplicação e não há `auth` — o filtro continua correto sem ajuste.

### 13.3 Adapter Neon + orquestração 2-provedores

**`ProviderAdapter` `id:"neon"`** (novo, §7.3):
- `ensure(ctx)`: (a) procura projeto Neon determinístico `<slug>-content` (idempotência); (b) se não existe, `POST` cria projeto (region, plano); (c) seleciona/cria a `branch` (`main` por default); (d) `GET` connection URIs → monta `DATABASE_URL` (endpoint `-pooler`) e `DIRECT_URL` (endpoint direto), ambos `?sslmode=require`; (e) grava no state `{ status, projectId, branchId }` (nunca a URI com senha em texto plano — a senha vai para o cofre).
- `rollback(ctx)`: `DELETE` do projeto Neon criado nesta run (só se criado nesta run; nunca um projeto reconciliado).

**Orquestração por `database.kind`** (o orquestrador compõe a lista de adapters — §7.3):
- `supabase` → `[supabase(conteúdo+auth), bunny, resend, vercel]` (inalterado).
- `neon` → `[neon(conteúdo `<slug>-content`), supabase(auth-only `<slug>-auth`), bunny, resend, vercel]`.

**Semânticas distintas dos dois adapters de banco no caso Neon:**
- **Neon** produz `DATABASE_URL`/`DIRECT_URL`; **não** produz nenhuma env de auth.
- **Supabase auth-only** produz `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`/`SUPABASE_SERVICE_ROLE_KEY` e recebe a config de SMTP (Resend); **não** produz `DATABASE_URL`/`DIRECT_URL`. É criado com plano `free` (um projeto que só guarda usuários/MFA cabe folgado).

**Idempotência sem colisão:** nomes determinísticos separam os papéis — projeto Neon `<slug>-content`, projeto Supabase auth-only `<slug>-auth`, projeto Vercel `<slug>-cms`. `ensure()` valida que o recurso encontrado casa o papel esperado antes de reconciliar, evitando reconciliar o projeto errado.

**Falha parcial e rollback (§7.5):** ambos os recursos de banco entram no rollback (ordem inversa `Vercel→Resend→Bunny→Supabase(auth-only)→Neon`). `destroy` remove os dois. Se um rollback de banco falhar, o recurso órfão é listado explicitamente para limpeza manual.

### 13.4 Impacto no relacionamento `profiles` ↔ `createdBy`/`updatedBy` (verificado no schema)

**O que o schema atual faz (verificado):**
- `db/schema/profiles.ts`: `profiles.id` **é** o `auth.users.id` (não uma chave separada), com FK explícita `profiles_id_auth_users_fk` → `authUsers.id` (`drizzle-orm/supabase`), `onDelete: cascade`. RLS habilitada, sem policies; a app acessa via role `postgres` (bypassa RLS).
- `db/schema/content.ts`: `content_entries.createdBy` e `.updatedBy` são `uuid` com FK → `profiles.id`, `onDelete: set null`. `content_versions.authorId` idem.
- `lib/auth/guards.ts`: o request resolve `claims.sub` (o `auth.users.id`) validando o JWT **localmente** via JWKS (ES256, sem round-trip ao Supabase), e faz `db.select().from(profiles).where(eq(profiles.id, claims.sub))` — usando a conexão de **conteúdo** (`db` = `DATABASE_URL`). `role`/`status` vêm do banco a cada request, nunca do JWT.

**Onde `profiles` mora:** como `guards.ts` lê `profiles` pela conexão de conteúdo (`DATABASE_URL`), **`profiles` vive no banco de conteúdo** — no Supabase no caso single-provider, **no Neon no caso 2-provedores**. Isso mantém a leitura de `profiles` de todo request **local ao banco de conteúdo** (sem cruzar provedores no caminho quente).

**Como funciona com conteúdo no Neon e usuários no Supabase:**
1. O usuário existe no `auth.users` do **Supabase auth-only** (login + MFA acontecem lá).
2. `profiles` (no **Neon**) tem uma linha cujo `id` = o `auth.users.id` do Supabase — **é apenas um UUID espelhado, sem FK enforced**, porque `auth.users` está em outro banco. **Não há FK cross-database** (Postgres não suporta) e **não precisa haver**: `createdBy`/`updatedBy`/`authorId` sempre foram só UUIDs que guardam o id do usuário.
3. `content_entries.createdBy → profiles.id` **continua sendo FK local** (ambos no Neon) — a integridade "entry aponta para um profile existente" é preservada. O que muda é só a FK de cima (`profiles.id → auth.users.id`), que **é omitida no caso Neon**.
4. `guards.ts` funciona **sem alteração**: valida o JWT via JWKS (aponta para o Supabase auth-only via `NEXT_PUBLIC_SUPABASE_URL`) e lê `profiles` no Neon. A ponte entre os dois provedores é o **valor do UUID** (`claims.sub` == `profiles.id`), não uma constraint de banco.

**Impacto concreto no codegen (D5):**
- No caso Neon, o gerador de `profiles` **omite** o bloco `foreignKey({ columns:[id], foreignColumns:[authUsers.id] })` e o import de `authUsers` de `drizzle-orm/supabase`. As colunas de `profiles` ficam idênticas; muda só a ausência dessa constraint.
- O provisionamento/seed de `profiles` continua criando a linha com `id = auth.users.id` (o `seed-admin` já cria o usuário no Supabase e o `profiles` correspondente — o fluxo passa a gravar o `profiles` no Neon).
- Perda de FK `onDelete: cascade`: tratada como decidido na §11.3 (deleção de usuário vira código explícito, ou `status='disabled'` na v1 — questão residual #4).

**Resumo do trade-off:** o modelo 2-provedores troca **uma FK cross-schema (hoje intra-banco)** por **um UUID espelhado sem constraint**. Isso é seguro porque a única coisa que a FK protegia (`profiles.id` referenciar um `auth.users` real) já é garantida pelo fluxo de app (só se cria `profiles` após criar o `auth.users`), e a integridade que importa para queries de conteúdo (`entry.createdBy → profiles`) permanece como FK local no Neon.

---

## Apêndice A — Mapa de arquivos-chave do CMS-modelo (evidência)

| Arquivo | Papel na parametrização |
|---------|-------------------------|
| `db/schema/enums.ts` | `contentTypeEnum` — **codegen alvo #1** |
| `db/schema/content.ts` | `content_entries`, `content_versions`, `caseStudyFacets` — **codegen alvo #2**; `createdBy`/`updatedBy`/`authorId` são `uuid` FK → `profiles.id` (`set null`) — **FK local, permanece no caso Neon (§13.4)** |
| `db/schema/profiles.ts` | `profiles.id` == `auth.users.id`; FK `profiles_id_auth_users_fk` → `authUsers` (`drizzle-orm/supabase`, `onDelete: cascade`) — **codegen omite essa FK no caso Neon (D5, §13.4)** |
| `db/index.ts` | `postgres(DATABASE_URL, {prepare:false})` + `drizzle` — **provider-agnóstico; IDÊNTICO entre Supabase/Neon (§13.1)** |
| `lib/auth/guards.ts` | valida JWT via JWKS (local, ES256) + lê `profiles` pela conexão de conteúdo (`DATABASE_URL`) — **funciona sem alteração no caso Neon; a ponte é o UUID `claims.sub == profiles.id` (§13.4)** |
| `lib/content/types.ts` | `REGISTRY`, `CONTENT_TYPES`, `SINGLETON_PAGES`, Zod schemas, `extractCaseFacets` |
| `lib/content/ui-fields.ts` | `FIELDS`, `FieldKind`, `emptyData` |
| `lib/content/entries.ts` | CRUD + `if (type === "case")` facets — **generalizar** |
| `lib/content/published.ts` | read API + `listPublishedCases` + `type === "person"` — **generalizar** |
| `lib/media/policies.ts` | `IMAGE_POLICIES` — já declarativo, vai para o config |
| `app/(admin)/[collection]/page.tsx` | rota dinâmica genérica (bom) + `type === "person"` |
| `app/(admin)/layout.tsx` | array `NAV` hardcoded — derivar do config |
| `components/AdminNav.tsx` | label "Demo Corp" literal |
| `app/globals.css` | `@theme` com `--color-brand*` — **codegen alvo #3** |
| `.env.example` | `DATABASE_URL` (pooled), `DIRECT_URL` (direto), `SITE_URL`, `BUNNY_*`, `READ_API_KEY`, `RESEND_API_KEY`, `SUPABASE_*` (auth), secrets — **as duas URLs de DB são preenchidas pelo provider de conteúdo escolhido (§13.1)** |
| `scripts/seed-admin.ts` | primeiro admin (email/senha por arg/env; idempotente; bootstrap MFA) — **cria o usuário no Supabase Auth e o `profiles` no banco de conteúdo (Neon no caso 2-provedores)** |
| `drizzle.config.ts` | `schemaFilter: ["public"]`, ignora `auth`; migrations via `DIRECT_URL`, runtime via `DATABASE_URL` (pooled) — **IDÊNTICO entre Supabase/Neon; preservar no template (§13.1)** |

---

## Apêndice B — Arquivado (descartado pelas travas D2/D3)

Registrado só para memória — **não faz parte do escopo atual**. Reabrir exigiria reverter uma decisão travada.

> **Nota:** esta é a Fase 5 **antiga/arquivada**, distinta da nova Fase 5 (banco plugável Neon, D5) do §10.

**Antiga "Fase 5 — coleções dinâmicas em runtime + UI web da fábrica.** Previa: (a) admin cria coleção/campo sem redeploy (coluna `type` vira `text` livre + tabela `content_types`); (b) UI web para preencher o `client.config.ts` em vez de editar TS.

- **(a) foi descartada por D2** — schema é fixo na criação; tipos fortes gerados no build valem mais que criação em runtime. Perderia enum/índices/tipos e aumentaria a superfície de bug.
- **(b) foi descartada por D3** — a interface é CLI operada por um técnico; sem UI web.

**Se algum dia reabrir:** o gatilho seria a chegada de um operador não-técnico (reabre b) ou clientes que precisem mudar schema com frequência sem redeploy (reabre a). Nenhum dos dois é premissa atual.

---

## Apêndice C — Mapa das variáveis de ambiente (do `.env.example` do modelo → origem no fluxo D4)

| Env var | Origem no provisionamento (§7) | Commitada? |
|---------|-------------------------------|------------|
| `DATABASE_URL` (pooled) | **(D5)** Supabase adapter (Supavisor 6543) **ou** Neon adapter (endpoint `-pooler`) — conforme `database.kind`; sempre `?sslmode=require` | não (`.env.local`/Vercel) |
| `DIRECT_URL` (direct) | **(D5)** Supabase adapter (5432) **ou** Neon adapter (endpoint direto); sempre `?sslmode=require` | não |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase adapter (**auth**: projeto conteúdo+auth no caso supabase, ou projeto auth-only no caso neon) | não (público, mas via env) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase adapter (anon key do projeto de auth) | não |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase adapter (secret key do projeto de auth) | **nunca** |
| `BUNNY_STORAGE_KEY` | Bunny adapter (zone password) | **nunca** |
| `BUNNY_STORAGE_ZONE` | `config.providers.media.storageZone` | derivado do config |
| `BUNNY_CDN_URL` | Bunny adapter (pull zone hostname) | não |
| `RESEND_API_KEY` | conta própria (reusada) | **nunca** |
| `SITE_URL` | `config.domains.siteUrl` | derivado do config |
| `READ_API_KEY` | gerado (CSPRNG) | **nunca** |
| `WEBHOOK_SIGNING_KEY` | gerado (CSPRNG) | **nunca** |
| `PREVIEW_TOKEN_SECRET` | gerado (CSPRNG) | **nunca** |
| `SEED_ADMIN_PASSWORD` | gerado (CSPRNG), usado uma vez no seed | **nunca** |

> **(D1 monorepo)** todas as envs acima vivem em `clients/<slug>/.env.local` (git-ignored) e no painel de env do **projeto Vercel daquele cliente**. Cada workspace tem seu próprio conjunto; nada é compartilhado entre clientes. O Vercel builda cada workspace pelo seu Root Directory (`clients/<slug>/`).

---

## Changelog do documento

| Data | Autor | Mudança |
|------|-------|---------|
| 2026-08-01 | Aria (@architect) | Versão inicial com D1–D4 travadas; §3 comparação A/B/C; backlog de 34 stories. |
| 2026-08-01 | Aria (@architect) | Adicionado **D5** (banco de conteúdo plugável Supabase/Neon; auth sempre Supabase): §4.1 união discriminada, §13 design completo, adapter Neon e fluxo 2-provedores; backlog 34 stories (Fase 5 = D5). |
| **2026-08-03** | **Aria (@architect)** | **Design spike (ADR-001) — destrava a Fase 1 (S1.3/S1.4 bloqueadas nos 9 arquivos DB-coupled).** Três decisões travadas: **(1) contrato de injeção `db`+schema** = factory `createEngine({ db, schema, audit, webhooks, facets })` / `createAuthGuards({ db, schema, supabase })` sobre um **Port tipado** (`EngineSchema` do núcleo + `FacetPort` para as facets variáveis) — o core não importa `@/db` nem tabelas concretas; **(2) estrutura do pacote** = renomear `@cms-core` (nome inválido, só escopo) para **`@cms-core/core`** com `exports` subpath, removendo os 3 aliases (tsconfig/webpack/vitest); **(3) sequenciamento** = completar a extração DB-coupled **agora** na Fase 1 com o schema atual injetado à mão (o codegen da Fase 2 gera o que hoje é manual, sem tocar no core). Atualizados: §5.6 (novo — contrato de injeção), §6.5 (novo — como o codegen satisfaz o Port), §8 (nome/exports/aliases), §8.2 (novo — mapa de exports + aliases removidos), §10 Fase 1 (S1.3 → S1.3a+S1.3b; S1.4 com audit/webhooks injetados; total 35→**36**), §10 S2.5 (gen-facets gera o FacetPort). Doc completo: `adr-001-core-di-and-packaging.md`. |
| **2026-08-03** | **Aria (@architect)** | **Passada de design do pipeline de codegen (ADR-003) — elimina a chance de um 3º spike na Fase 2.** Cada gerador (`gen-enums`/`gen-content-types`/`gen-facets`/`gen-zod`/`gen-ui-fields`/`gen-theme`/`gen-nav`/`gen-env`) medido contra seu alvo gold-standard REAL. **Resultado: nenhuma lacuna de contrato nova além de ADR-001/002**, exceto **1 micro-extensão**: `uiHidden?: boolean` no `FieldConfig` (P3 — o campo sintético `industryFacets` do baseline vaza p/ `FIELDS`/schema gerados e quebra o TEST-001 sem um filtro). Consolidado: (1) as 7 tabelas-molde do núcleo + enums estáticos **não são geradas** (molde fixo — só `content_type` enum e `<type>_facets` são config-driven no DB); (2) `gen-theme`/`gen-nav` emitem só o subconjunto derivável (6 cores+font / itens de coleção+adminTitle), o resto é template estático; (3) geradores moram em `cli/src/codegen/` (`cli/` materializado como T0 de S2.3); (4) `gen-zod` via `buildZodSchemas(config)` runtime; (5) determinismo: ordem de inserção preservada, sem alfabetizar chaves; (6) FacetPort real tem 5 métodos. Corte S2.1↔S2.2 esclarecido (S2.1=estrutura+seam+atributos no `validate.ts`+baseline; S2.2=mapeamento fino `buildFieldSchema`). Atualizados: §4.1 (`uiHidden`), §6 (banner de consolidação + molde-fixo), §6.2 (tabela de geradores). Ajustes de story: S2.1/S2.2/S2.5/S2.6 → Draft (@po re-valida); S2.3/S2.4/S2.7 mantêm Ready. Doc completo: `adr-003-codegen-pipeline-design.md`. |
| **2026-08-03** | **Aria (@architect)** | **Design spike (ADR-002) — destrava a Fase 2 (S2.1 bloqueada no wiring do motor).** Duas decisões travadas: **(1) seam do REGISTRY** = o `REGISTRY`/`validateContent`/`defForType` (consumidos DENTRO do core em `engine/entries.ts`/`published.ts`) deixam de ser singletons de módulo e viram **dep injetada** (`registry: RegistryBundle`) em `createEngine`, estendendo ADR-001 — a montagem config-driven acontece no `lib/core-runtime.ts` do cliente via os builders da S2.1 (elimina o risco de estado mutável/ordenação de import da alternativa `configureEngine`); **(2) extensão do `FieldConfig`** = +4 atributos (`default`, `trim`, `dedup`, `itemShape`) + tipo `ItemFieldSpec`, cobrindo 100% da nuance por-campo dos schemas gold-standard (auditoria de 9 tipos/63 campos) — sem os quais `buildZodSchema` afrouxaria a validação e quebraria os testes do cliente. Atualizados: §4.1 (`FieldConfig` estendido + `ItemFieldSpec`), §5 R1 (buildZodSchema byte-idêntico + arquivos afetados corrigidos p/ `packages/core/src/engine|media/*`), §5.6.1 (novo — seam do REGISTRY), §6.2 (`gen-zod` usa os novos atributos; `gen-content-types` alimenta o RegistryBundle). Doc completo: `adr-002-registry-seam-and-fieldconfig.md`. |
| **2026-08-04** | **Aria (@architect)** | **Design decision (ADR-004) — packaging/build do core; destrava o `next build` de produção (S2.7 AC6).** O `next build` do cliente FALHAVA: o **Turbopack** do Next 16 (sem fallback webpack) não resolve os **112 imports `.js`** (NodeNext) dos 33 arquivos `.ts`/`.tsx` do `@cms-core/core` consumido como TS-fonte cru via `transpilePackages` — 62 "Module not found". Blocker pré-existente e ortogonal (nunca houve `BUILD_ID`); `tsc`/`vitest`/`tsx` mascaravam (todos `moduleResolution:"bundler"`). **Decisão: Opção A** — o core ganha **build step `tsc → dist/`** (`tsconfig.build.json` NodeNext, emit `dist/*.js`+`*.d.ts`); os `exports` (§8.2, subpaths idênticos) mudam o **alvo** src→dist com condição **`development`→src** (DX de dev/test/CLI inalterado; só `next build` de prod lê dist). **Rejeitada Opção B** (extensionless+`bundler` no core): reescreveria 112 imports corretos, regride NodeNext, quebra publicação. `transpilePackages` deixa de ser necessário (fallback inócuo). Subpath `ui`: o `import "quill/dist/quill.snow.css"` é preservado no emit e resolvido pelo `quill` (dep) do cliente. Micro-tarefa medida: 3 arquivos (`engine/sanitize.ts`/`types.ts`/`ui-fields.ts`) têm imports extensionless (TS2835) a completar com `.js`. `dist/` git-ignored, buildado no `prebuild`+CI. Atualizados: **§8.3 (novo — estratégia de build)**. Implementação: **S2.8** (`2.8.core-packaging-build.md`), executor @dev, gate @qa — fecha o gate da S2.7 e o Marco 2. Doc completo: `adr-004-core-packaging-build.md`. |
| **2026-08-03** | **Aria (@architect)** | **Revisão de D1: revertida de "1 repositório por cliente + `@cms-core` publicado por SemVer/registry" (antiga Opção A) para MONOREPO (antiga Opção B).** Um único repositório `criador-de-cms`; core em `packages/core` linkado por `workspace:*` (sem publish/registry); um workspace por cliente em `clients/<slug>/`; deploy Vercel com Root Directory por workspace. **D2–D5 intactas.** Isolamento de dados/infra preservado via D4/D5 (não via layout de código). Atualizados: cabeçalho, Decisões Travadas (D1 + trade-off + "por que não A/registry"), §0, §2.2, §3 (reescrita), §4.1/§4.3 (`coreVersion: "workspace:*"`), §5.5, §6.4, §7.1/§7.2/§7.3/§7.5/§7.7, §8 (árvore do monorepo + §8.1 recomendação de gerenciador de workspace = **pnpm**, Turborepo só quando escalar), §9, §10 (Fase 1 reescrita: 4→5 stories — removidas publish/SemVer/registry, adicionadas setup de monorepo + CI; S4.9 vira redeploy sem bump; total 34→**35**), §11.1 (novo risco "fix do core propaga p/ todos sem versionamento" + mitigação CID), §12 (registry obsoleto; nova questão residual = gerenciador de workspace). Fase 0 (`packages/core`) já entregue e compatível. |
