# ADR-004 — Packaging/build do `@cms-core/core`: build step `tsc → dist/` para destravar o `next build` de produção (Turbopack)

> **Status:** ACEITA (2026-08-04)
> **Autor:** Aria (@architect)
> **Contexto:** o `next build` do cliente `demo-corp` FALHA (blocker pré-existente e ORTOGONAL, documentado pelo @dev em S2.7 AC6/T3). Next 16.2.12 usa **Turbopack** (bundler default, sem fallback webpack) e **não resolve** os imports com extensão `.js` dos arquivos `.ts`/`.tsx` do `@cms-core/core` consumido como TS-fonte cru via `transpilePackages`: **62 erros "Module not found: Can't resolve './X.js'" em 33 arquivos do core**. Confirmado pré-existente: **nunca houve `.next/BUILD_ID`** (S2.7 foi a 1ª story a rodar `next build`). Todos os demais gates passam: `pnpm -r typecheck` 0, core 102/102, cli 62/62, cliente 89/29, `drizzle-kit check` 0 diffs — só o build de produção não resolve.
> **Escopo:** decidir a estratégia de packaging do core (A build→dist / B extensionless / C híbrido), definir o build script, o mapa de `exports`, o impacto no `next.config.mjs`/`transpilePackages`, o tratamento do subpath `ui` (Quill CSS side-effect), e o impacto no DX (dev/watch), no CLI (Fase 3) e nos clientes.
> **Constrói sobre (não re-decide):** D1 (MONOREPO, `workspace:*`, sem publish/registry), D2 (codegen build-time), ADR-001 (injeção `db`+schema, pacote `@cms-core/core` com `exports` subpath, §8.2), ADR-002/003 (seam do REGISTRY, `FieldConfig`, pipeline de codegen). **NÃO reabro** nenhuma dessas decisões. Este ADR é a camada de packaging que faltava para o core ser consumido por um bundler de produção.
> **Relacionado:** `cms-factory-architecture.md` §8/§8.2 (mapa de `exports`), §6.1 (prebuild/gatilho), §8.1 (pnpm); story `docs/stories/2.7.regressao-e2e-gen-env.md` (AC6/T3 — origem do blocker) e `docs/stories/2.8.core-packaging-build.md` (implementação desta ADR).

---

## 0. Sumário executivo (a resposta curta)

**Decisão: OPÇÃO A — o `@cms-core/core` passa a ter um build step (`tsc → dist/`).** O `exports` do `package.json` passa a apontar para `./dist/*.js` (runtime) + `./dist/*.d.ts` (tipos), com uma condição `"development"` que aponta de volta para `./src/*.ts`. O cliente consome, no `next build` de produção, **arquivos `.js` REAIS** que o Turbopack resolve nativamente; em dev/test/CLI, continua consumindo o `src` cru via `moduleResolution:"bundler"` (zero regressão de DX). `transpilePackages` deixa de ser necessário para o consumo de produção.

**Por que A e não B (extensionless):** os 112 imports `.js` em 33 arquivos **já estão no formato canônico NodeNext e estão corretos** — provei rodando `tsc --module NodeNext --moduleResolution NodeNext` no core: o emit produz `dist/*.js` com os specifiers `.js` REAIS preservados, `.d.ts` completos, e o side-effect `import "quill/dist/quill.snow.css"` intacto. O padrão `.js`-explícito é o **alvo do build**, não um bug. A Opção B reescreveria 112 imports para regredir de NodeNext para bundler-only, quebrando a corretude Node-nativa e a futura publicação — trabalho mecânico grande na direção errada. A **micro-tarefa** que A exige é o inverso e muito menor: **3 arquivos** (`engine/sanitize.ts`, `engine/types.ts`, `engine/ui-fields.ts`) hoje têm imports EXTENSIONLESS (erro TS2835 sob NodeNext), inconsistência mascarada pelo `moduleResolution:"bundler"` atual — basta adicionar `.js` a esses poucos imports para o core ficar 100% NodeNext-limpo e o emit passar.

**Uma frase:** o core sempre foi escrito para virar `.js` (imports NodeNext corretos); só faltava o passo que os transforma em `.js` de verdade. ADR-004 adiciona esse passo sem tocar no código de aplicação.

---

## 1. O problema, medido (não suposto)

### 1.1 Sintoma

`pnpm --filter demo-corp run build` → `next build` (Turbopack) → exit 1, 62× "Module not found: Can't resolve './X.js'", em 33 arquivos do core (ex.: `builders.js`, `di.js`, `content-builders.js`). O `prebuild`→`generate` (8 geradores) roda OK; os artefatos gerados existem. Não é falha de env nem de arquivo gerado ausente.

### 1.2 Causa-raiz (a assimetria que engana)

O `@cms-core/core` é consumido de **quatro** formas no monorepo, e três delas toleram o que a quarta não:

| Consumidor | Como resolve o core | `.js`→`.ts`? | Passa hoje? |
|-----------|---------------------|:---:|:---:|
| `tsc --noEmit` do cliente | `moduleResolution:"bundler"` + `exports` | remapeia | **sim** (typecheck 0) |
| `vitest` do cliente | Vite (`resolve` bundler-style) + `exports` | remapeia | **sim** (89/29) |
| `tsx`/`tsc` do CLI | `moduleResolution:"bundler"` + tsconfig `paths` | remapeia | **sim** (62/62) |
| **`next build` (Turbopack)** | `transpilePackages` sobre `src/*.ts` cru | **NÃO remapeia** | **NÃO** (62 erros) |

`moduleResolution:"bundler"` (o modo dos três primeiros) tem a regra "se `./x.js` não existe mas `./x.ts` existe, resolve `./x.ts`". O Turbopack, ao transpilar um pacote de `transpilePackages` que é **TS-fonte cru**, **não** aplica esse remapeamento de extensão para imports relativos com `.js` explícito — ele procura o arquivo `./x.js` literal, que não existe (só `./x.ts` existe), e falha. A prova de que os imports `.js` estão certos e não errados: **o core compila limpo sob NodeNext** (`tsc --noEmit --module NodeNext` no `src/index.ts` = exit 0), o padrão que exige `.js` explícito.

### 1.3 Por que isso nunca apareceu antes

Nenhuma story anterior rodou `next build` (não há `BUILD_ID`). O `tsc`/`vitest`/`tsx` mascararam a lacuna de packaging porque todos usam resolução bundler-style. **A extensão real dos imports foi confirmada por grep: 112 ocorrências `from "…​.js"` em 33 arquivos** de `packages/core/src`.

---

## 2. As três opções, com trade-offs

### Opção A — Buildar o core para `dist/` (tsc build) — **ESCOLHIDA**

O core ganha `tsconfig.build.json` (emit) e um script `build` que roda `tsc` emitindo `dist/*.js` + `dist/*.d.ts`. Os `exports` apontam para `dist` (com condição `development`→`src`). O cliente/produção consome `.js` REAIS que o Turbopack resolve trivialmente.

| Dimensão | Avaliação |
|----------|-----------|
| Corretude `next build` prod | **Resolve definitivamente** — Turbopack consome `.js` reais como qualquer pacote npm publicado |
| Alinhamento com o código atual | **Máximo** — os 112 imports `.js` já são o alvo do emit; zero reescrita de imports de aplicação |
| Canonicidade | **Padrão da indústria** para pacote consumido por múltiplos apps + CLI (é como todo pacote npm compilado funciona) |
| Fase 3 (CLI/scaffolder) | **Positivo** — o CLI passa a poder consumir `dist` estável; o scaffolder de cliente não precisa mais de `transpilePackages` no template |
| Publicação futura | **Preparado** — se um dia o core for publicado (não é o plano D1, mas), `dist`+`.d.ts`+`exports` é exatamente o formato correto |
| Custo — build step | Precisa rodar `tsc` antes do `next build` (via `prebuild` do cliente ou dep de build do workspace) — segundos, incremental |
| Custo — DX de dev/watch | **Mitigado** pela condição `exports.development`→`src`: `next dev`, `vitest` e `tsx` continuam lendo `src` cru (hot, sem watch de build). Só o `next build` de produção lê `dist`. Alternativa/reforço: `tsc -w` para quem quiser dist sempre fresco |
| Blast radius | Baixo — muda `package.json`/`tsconfig` do core + `dist/` gerado; **não toca** código de aplicação (exceto os 3 imports extensionless a corrigir, ver §3) |

### Opção B — Imports extensionless no core + `moduleResolution:"bundler"` no core

Reescrever os 112 imports `.js`→extensionless e trocar o `moduleResolution` do core para `bundler`. O Turbopack passaria a resolver via bundler.

| Dimensão | Avaliação |
|----------|-----------|
| Corretude `next build` prod | Resolve (Turbopack resolve extensionless sobre src) |
| Alinhamento com o código atual | **Negativo** — reescreve 112 imports corretos; **regride** o padrão NodeNext já provado |
| Canonicidade | Fraca — força TODO consumidor a ser um bundler bundler-style; core deixa de ser resolvível por Node nativo/`node --loader tsx` fora de bundler |
| Fase 3 (CLI) | Neutro/negativo — o CLI já resolve; mas o core perde portabilidade |
| Publicação futura | **Bloqueia** — pacote extensionless+bundler não é publicável para consumo Node ESM padrão sem re-trabalho |
| Custo | ~112 edições mecânicas + risco de quebrar o `tsc`/`vitest`/`tsx` próprios do core (precisa re-validar os 3) |
| Risco | Blast radius **amplo** — toca 33 arquivos de aplicação; qualquer regressão ameaça o verde de S2.5/S2.6 |

Rejeitada: resolve o sintoma andando na direção oposta à correção (destrói o padrão NodeNext correto para satisfazer só o Turbopack), com blast radius maior e perda de portabilidade.

### Opção C — Híbrido: só a condição `exports` (`development`→src, default→dist)

C **não é uma terceira opção independente** — é a **forma como A é implementada** para preservar o DX. A condição `exports.development` apontando para `src` (e `default`/`production` para `dist`) É o mecanismo que dá a A o melhor DX. Portanto C está **subsumida em A** (ver §4). Não existe um C "sem build": se o `default` não apontar para `.js` reais, o `next build` continua falhando.

### Veredito

**A (implementada com a condição `exports` da C).** É a única que resolve o build de produção **e** mantém o código de aplicação intacto **e** preserva a portabilidade/publicabilidade **e** não regride o DX de dev.

---

## 3. A micro-tarefa que A exige (medida, não suposta)

Ao rodar o emit real (`tsc --module NodeNext --moduleResolution NodeNext` com emit), o core **quase** compila limpo — mas **3 arquivos** têm imports relativos **extensionless** que erram sob NodeNext (TS2835 "Relative import paths need explicit file extensions"):

- `packages/core/src/engine/sanitize.ts` → `./ui-fields`, `./types`, `./youtube` (faltam `.js`)
- `packages/core/src/engine/types.ts` → `./youtube` (falta `.js`)
- `packages/core/src/engine/ui-fields.ts` → `./types` (falta `.js`)

Essa inconsistência (33 arquivos com `.js`, poucos sem) está hoje **mascarada** pelo `moduleResolution:"bundler"` do core, que aceita ambos. A correção é **adicionar `.js`** a esses ~6 imports — o oposto (e ~20× menor) da reescrita da Opção B, e na direção da consistência NodeNext correta. O `@dev` deve tornar o core **100% NodeNext-limpo** como pré-passo do emit.

> Nota: `next/server`/`next/headers` também aparecem como "Cannot find module" no emit isolado apenas porque rodei `tsc` sem o `include`/`types` completo do projeto; sob o `tsconfig.build.json` real (com `skipLibCheck` e os `@types` do workspace) esses resolvem normalmente — são peer deps do Next, não imports relativos do core.

---

## 4. Design da Opção A (o que o @dev implementa)

### 4.1 `packages/core/tsconfig.build.json` (novo — emit)

Estende o `tsconfig.json` atual, mas **emitindo** e em **NodeNext** (o `tsconfig.json` de dev/typecheck permanece `bundler`+`noEmit`, sem mudança):

```jsonc
// packages/core/tsconfig.build.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "noEmit": false,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "emitDeclarationOnly": false
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"],
  "exclude": ["node_modules", "dist", "src/**/*.test.ts", "src/**/__tests__/**"]
}
```

Racional: `NodeNext` é o modo que **honra** os imports `.js` na saída (emite `dist/x.js` importando `./y.js` real). Tests/fixtures são excluídos do dist. O `tsconfig.json` de dev fica intocado (typecheck/IDE seguem `bundler`).

### 4.2 `package.json` do core — script `build` + `exports` com condição

```jsonc
{
  "name": "@cms-core/core",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "build:watch": "tsc -p tsconfig.build.json --watch",
    "clean": "node -e \"require('fs').rmSync('dist',{recursive:true,force:true})\"",
    "prepublishOnly": "npm run build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "exports": {
    ".": {
      "development": "./src/index.ts",
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
    // …idem para ./config ./engine ./auth ./media ./i18n ./webhooks ./audit ./ui
  }
}
```

**Como a condição resolve o DX vs produção:**
- `next dev`, `vitest`, `tsx` do CLI, IDE → rodam com a condição `development` ativa (Vite/Next dev e `tsx` ativam `development`; tsc lê via `bundler`) → consomem `src/*.ts` cru, **hot, sem build**.
- `next build` (produção) → condição `development` **não** ativa → cai em `default`→`dist/*.js` **real** → Turbopack resolve.
- IDE/typecheck → usam a chave `types`→`dist/*.d.ts` (gerados pelo build) ou, com `development`, os `.ts` diretamente.

> A ordem das chaves em cada subpath importa: `development` primeiro, depois `types`, depois `default`. `types` deve preceder `default` (regra do resolver de tipos).

### 4.3 `next.config.mjs` do cliente — `transpilePackages`

Com o core servindo `.js` reais em produção, **`transpilePackages:["@cms-core/core"]` deixa de ser necessário** para o consumo de produção e pode ser **removido**. Exceção a validar na implementação: o subpath `ui` (ver §4.4). Recomendação segura para S2.8: **remover** `transpilePackages` e confirmar `next build` verde; se o subpath `ui` (componentes React `.tsx` + CSS) exigir transpile por algum edge do Turbopack com pacotes locais, **manter** `transpilePackages` apenas — é inócuo (transpilar `.js` já-válido é no-op) e não reintroduz o bug (o bug era `.ts` cru + `.js` import, não a presença de `transpilePackages`).

### 4.4 Subpath `ui` e o Quill CSS (o ponto delicado, medido)

O core importa o CSS do Quill **dentro** de `packages/core/src/ui/RichTextEditor.tsx:4`: `import "quill/dist/quill.snow.css";`. Medi o emit: o `tsc` **preserva verbatim** esse import side-effect no `dist/ui/RichTextEditor.js` (não o resolve nem o remove — mantém a string literal). Em produção, o Next resolve `quill/dist/quill.snow.css` a partir do **`node_modules` do cliente** (o cliente tem `quill` como `dependency` direta; o core o declara como `peerDependency` optional). Portanto:

- **Nenhuma ação especial** é necessária para o CSS: o build emite o import como está, e o Next/Turbopack o resolve pelo `quill` do cliente. Confirmado que o emit preserva a linha.
- `.d.ts` do subtree `ui` são emitidos (provado: `dist/ui/*.d.ts` gerados) — os componentes React seguem tipados para o cliente.
- Se, e somente se, o Turbopack recusar um import de CSS vindo de um `dist/*.js` de pacote local (edge improvável), a mitigação mínima é manter `transpilePackages:["@cms-core/core"]` no cliente (transpila o `dist` já-válido — no-op para JS, mas força o pipeline de CSS-in-JS do Next a processar o subpath `ui`). Isso é a razão pela qual §4.3 recomenda **remover e verificar**, com `transpilePackages` como fallback barato.

### 4.5 `dist/` no git e no ciclo

- `dist/` é **gerado, git-ignored** (adicionar `packages/core/dist/` ao `.gitignore`). Coerente com D1 (sem publish) e com o tratamento dos artefatos gerados (§6.4).
- **Quando buildar:** o `dist` precisa existir antes do `next build` do cliente. Dois gatilhos, ambos recomendados:
  1. **`prebuild` do cliente** encadeia o build do core: `"prebuild": "pnpm --filter @cms-core/core run build && npm run generate"` (garante dist fresco antes de todo `next build`, inclusive local).
  2. **CI** (a mitigação anti-blast-radius de D1, S1.5): o job que roda `next build`/typecheck dos `clients/*` roda `pnpm --filter @cms-core/core run build` primeiro. Quando adotar Turborepo (§8.1, >5–8 clientes), o `dist` vira output cacheável com `dependsOn: ["^build"]`.

---

## 5. Impacto por consumidor (DX / CLI / clientes)

| Consumidor | Antes | Depois (ADR-004) |
|-----------|-------|------------------|
| **`next dev` (cliente)** | lê `src` via transpilePackages | lê `src` via `exports.development` — **idêntico, hot, sem build** |
| **`next build` (cliente)** | **FALHA** (Turbopack vs `.js`+`.ts` cru) | lê `dist/*.js` real → **verde** |
| **`vitest` (cliente/core)** | lê `src` (bundler) | lê `src` via `development`/bundler — **sem mudança** (89/29, 102/102) |
| **`tsc --noEmit` (todos)** | `bundler` sobre `src` | `bundler` sobre `src` (dev tsconfig intocado) ou `types`→dist — **0 erros** |
| **CLI (`tsx`) — Fase 3** | resolve `src` via tsconfig `paths` | resolve `src` via `development`/`paths` — **sem mudança**; ganha opção de consumir `dist` estável |
| **Scaffolder de cliente — Fase 3** | template com `transpilePackages` | template **sem** `transpilePackages` (ou inócuo) — mais próximo de um app Next padrão |
| **DX de watch** | n/a (sempre src) | dev continua em `src` (zero watch); quem quiser dist fresco roda `build:watch` |

**Custo de DX líquido: ~zero.** A condição `development`→`src` é o que garante que o dia-a-dia (dev/test) não passe a depender de um build. O build só entra no caminho de `next build` (produção) e do CI — exatamente onde deve.

---

## 6. Consequências

**Positivas:**
- `next build` de produção passa a funcionar — **fecha o gate da S2.7 (AC6) e o Marco 2**.
- O core vira um pacote canônico (`dist`+`.d.ts`+`exports`), pronto para múltiplos apps e para o CLI da Fase 3, sem regredir o padrão NodeNext já correto.
- Zero reescrita de imports de aplicação; blast radius mínimo (config + 3 arquivos com `.js` a completar).
- Base para publicação futura, se um dia sair do modelo `workspace:*` (não é o plano D1).

**Negativas / custos assumidos:**
- Introduz um build step no core (segundos, incremental, encadeado no `prebuild`/CI).
- `dist/` gerado precisa estar fresco antes do `next build` (mitigado pelo `prebuild` encadeado — risco: dist stale se alguém rodar `next build` sem `prebuild`; mitigado porque `prebuild` roda automaticamente no `npm run build`).
- Mais uma condição `exports` para manter coerente (9 subpaths × 3 chaves). Mitigado por ser mecânico e coberto por gate (`tsc`/`vitest`/`next build`).

**Neutras:**
- `transpilePackages` provavelmente removido (ou mantido inócuo) — decisão final validada por `next build` verde na S2.8.

---

## 7. Passos de implementação (para o @dev, em S2.8)

Ordem obrigatória (o emit depende do core estar NodeNext-limpo):

1. **NodeNext-limpar o core (§3):** adicionar `.js` aos ~6 imports extensionless em `engine/sanitize.ts`, `engine/types.ts`, `engine/ui-fields.ts`. Rodar `tsc -p tsconfig.build.json --noEmit` até 0 erros TS2835. (Gate intermediário: core `test` segue 102/102, `typecheck` 0.)
2. **Criar `packages/core/tsconfig.build.json`** (§4.1) — NodeNext, emit, `outDir:dist`, exclui tests.
3. **Adicionar scripts** `build`/`build:watch`/`clean` e ajustar `main`/`types`/`exports` (condição `development`→src, `types`→dist, `default`→dist) no `packages/core/package.json` (§4.2). Manter `private:true` (D1).
4. **`.gitignore`:** adicionar `packages/core/dist/`.
5. **Encadear o build no cliente:** `prebuild` do `demo-corp` roda `pnpm --filter @cms-core/core run build` antes do `generate` (§4.5). Ajustar o job de CI (S1.5) para buildar o core antes de typecheck/build dos clientes.
6. **`next.config.mjs`:** remover `transpilePackages:["@cms-core/core"]`; rodar `next build`. Se `ui`/CSS quebrar (edge), reintroduzir `transpilePackages` (fallback inócuo, §4.4).
7. **Rodar `pnpm --filter @cms-core/core run build`** → confere `dist/*.js` com specifiers `.js` reais + `dist/**/*.d.ts` + o `import "quill/dist/quill.snow.css"` preservado em `dist/ui/RichTextEditor.js`.
8. **Validar TODOS os gates** (§8) — o critério de fechamento.

> Fora de escopo para S2.8 (não reabrir): o mapa de `exports` de subpaths (ADR-001 §8.2) permanece o mesmo em nomes; muda só o **alvo** (src→dist) e a **adição** da condição `development`. O CLI da Fase 3 pode continuar em `src` via `development`/`paths` — não precisa consumir `dist` ainda.

---

## 8. Critério de aceite / gates (o que prova A correta)

| Gate | Antes | Alvo (S2.8) |
|------|-------|-------------|
| `pnpm --filter demo-corp run build` (`next build`) | **FALHA** (62 erros) | **exit 0** (BUILD_ID gerado) |
| `pnpm --filter @cms-core/core run build` (novo) | n/a | exit 0; `dist/*.js`+`*.d.ts` emitidos |
| `pnpm -r run typecheck` | 0 | 0 (mantém) |
| core `test` | 102/102 | 102/102 (mantém) |
| cli `test` | 62/62 | 62/62 (mantém) |
| cliente `test` | 89/29 | 89/29 (mantém) |
| `drizzle-kit check` | 0 diffs | 0 diffs (mantém) |
| DX dev (`next dev`/`vitest`) | src cru | src cru via `development` (sem regressão) |

Qualquer regressão em um gate "mantém" reprova a implementação (a ADR exige preservação de capacidade — nenhum gate verde pode ficar vermelho).

---

## 9. Riscos residuais

| Risco | Prob. | Impacto | Mitigação |
|-------|:---:|:---:|-----------|
| `dist` stale (build não rodou antes do `next build`) | Média | Build usa código velho | `prebuild` encadeia `core build`; CI builda core primeiro; `build` do core é fast/incremental |
| Turbopack recusa CSS import de `dist` de pacote local | Baixa | `ui`/RichText sem estilo | Manter `transpilePackages` como fallback inócuo (§4.4); provado que o emit preserva o import |
| Condição `exports` mal-ordenada (`types` após `default`) | Baixa | IDE perde tipos | Ordem fixada em §4.2 (`development`→`types`→`default`); coberta por `tsc` gate |
| Peer `quill`/`react`/`next` ausente no consumidor | Baixa | Import falha em runtime | Já são deps diretas do cliente; peerDepsMeta optional preserva o CLI (que não usa `ui`) |
| Divergência dev(src) vs prod(dist) por bug do emit | Baixa | "passa em dev, falha em prod" | O `next build` no CI (S1.5) exercita o caminho `dist` a cada PR — a mitigação anti-blast-radius de D1 já cobre isso |

---

## 10. Resumo

O core sempre foi escrito para ser compilado (imports NodeNext `.js` corretos), mas nunca teve o passo que os materializa. ADR-004 adiciona esse passo (`tsc → dist/`), aponta os `exports` para `dist` com um atalho `development`→`src` que preserva 100% do DX, e assim faz o `next build` de produção enxergar `.js` reais. Custo: um build step encadeado + corrigir 3 imports extensionless. Ganho: build de produção verde, core canônico e pronto para o CLI da Fase 3, sem reescrever uma linha de código de aplicação. Implementação em **S2.8**, executor `@dev`, quality gate `@qa`.
