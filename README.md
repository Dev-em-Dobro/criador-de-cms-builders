# Criador de CMS

Uma **fábrica de CMS**: você descreve o cliente num arquivo de configuração e ela
gera um painel administrativo completo em Next.js — conteúdo, autenticação com
MFA, mídia, versões, tradução, webhooks e trilha de auditoria — já ligado a um
banco Postgres provisionado.

O que você escreve é isto:

```ts
export const acmeConfig: ClientConfig = {
  slug: "acme",
  displayName: "Acme",
  branding: { adminTitle: "Acme", colors: { brand: "#d84339", /* … */ } },
  collections: [
    {
      type: "post",
      label: "Post",
      segment: "posts",
      fields: [
        { name: "title", label: "Título", kind: "text", required: true },
        { name: "body", label: "Texto", kind: "richtext", default: "" },
        { name: "coverMediaId", label: "Capa", kind: "media" },
      ],
    },
  ],
  // …
};
```

E o que sai é um CMS funcionando, com schema de banco, migrations, validação,
formulários e navegação — todos derivados desse arquivo.

---

## Por que uma fábrica e não um template

Um template você copia uma vez e depois mantém N cópias divergentes. Aqui todo o
comportamento mora em **um pacote só** (`packages/core`), que todos os clientes
consomem por link de workspace. Um bug corrigido no core vale para todos os
clientes no próximo deploy — sem publicar pacote, sem bump de versão, sem
copiar e colar.

O que varia entre clientes (coleções, campos, cores, idiomas, provedores) não é
código escrito à mão: é **gerado** a partir do config. Isso é o que permite
entregar o quinto CMS no mesmo tempo do primeiro.

---

## Requisitos

- Node.js 18 ou mais novo
- pnpm 9 (`npm i -g pnpm`)
- Uma conta Supabase (banco + autenticação) — o plano free dá conta de um CMS
- Opcionalmente: Vercel (hospedagem), Bunny.net ou Vercel Blob (mídia),
  Resend (e-mails transacionais), Neon (banco alternativo ao Supabase)

---

## Começando

### 1. Forke e instale

```bash
git clone <o seu fork>
cd criador-de-cms
pnpm install
```

### 2. Escreva o config do seu cliente

Comece copiando um exemplo:

```bash
cp templates/config-examples/demo-corp.config.ts configs/acme.config.ts
```

Os dois exemplos em `templates/config-examples/` são completos e comentados:

| Arquivo | Mostra |
|---|---|
| `demo-corp.config.ts` | Nove content types, facets, singletons, políticas de upload — tudo num único provedor (Supabase) |
| `demo-corp-neon.config.ts` | O mesmo, com o banco no Neon e a autenticação no Supabase |

Edite slug, `displayName`, cores, domínios e — o principal — as `collections`.
Cada coleção vira uma tabela, um formulário e uma entrada no menu do admin.

Confira antes de gerar qualquer coisa:

```bash
pnpm cms-factory validate --config configs/acme.config.ts
```

O validador é severo de propósito: ele recusa, por exemplo, um config que
carregue um segredo, ou uma facet que aponte para um campo inexistente.

### 3. Gere o CMS

```bash
pnpm cms-factory create-client --config configs/acme.config.ts --skip-provision
```

Isso cria `clients/acme/` — um workspace Next.js completo —, roda o codegen e
gera as migrations do Drizzle. **Nada é criado em nenhum provedor**: é tudo
local.

### 4. Ligue num banco

Crie um projeto no Supabase, preencha `clients/acme/.env.local` (o arquivo
`.env.example` do workspace lista cada variável e onde encontrá-la) e rode,
**nesta ordem**:

```bash
pnpm --filter acme run db:migrate      # aplica o schema E fecha o banco (veja "Segurança")
pnpm --filter acme run seed:locales    # sem isto o admin abre no idioma errado
pnpm --filter acme run seed:admin -- voce@exemplo.com 'uma senha forte'
pnpm --filter acme run dev             # http://localhost:3010
```

### 5. (Opcional) Deixe a fábrica provisionar tudo

Se em vez de criar os projetos à mão você quiser que a fábrica crie o projeto
Supabase, a zona de mídia, o domínio de e-mail e o projeto na Vercel:

```bash
cp .factory.env.example .factory.env      # preencha com os SEUS tokens
pnpm cms-factory create-client --config configs/acme.config.ts --dry-run   # veja o plano primeiro
```

Tire o `--dry-run` quando o plano estiver do jeito que você quer. O
provisionamento faz rollback do que criou se falhar no meio, e `--resume` retoma
de onde parou.

> `.factory.env` **nunca** é versionado. São os seus tokens de operador, com
> poder de criar e apagar projetos inteiros nos provedores.

---

## Estrutura

```
packages/core/        @cms-core/core — todo o comportamento do CMS
                      (engine de conteúdo, auth, mídia, i18n, webhooks,
                      auditoria, componentes de UI do admin)
cli/                  a cms-factory: validate, generate, create-client,
                      codegen e provisionamento
templates/client-app/ a casca Next.js copiada para cada cliente novo
templates/config-examples/  configs de exemplo, comentados
configs/              os configs dos SEUS clientes
clients/              os CMS gerados (um workspace por cliente)
docs/architecture/    as decisões de arquitetura e o porquê de cada uma
```

### O que é gerado e o que é escrito à mão

Arquivos com `.generated.` no nome **são reescritos** a cada `generate` — editar
à mão é trabalho perdido. Se você precisa mudar algo neles, mude o config e
gere de novo. Se o config não consegue expressar o que você quer, o lugar da
mudança é `packages/core`, não o arquivo gerado.

---

## Manutenção

**Corrigir algo para todos os clientes de uma vez:** mexa em `packages/core`. O
workflow `core-blast-radius.yml` roda o typecheck e os testes de *todos* os
workspaces em `clients/*` a cada mudança no core, justamente para que uma
correção não quebre um cliente sem você perceber.

**Mudou o config de um cliente:** rode `generate` e commite os arquivos gerados
junto. O workflow `codegen-drift.yml` reprova o PR se o gerado no repositório
não bater com o que o config produz.

---

## Segurança

Dois pontos que não são opcionais:

**O banco nasce aberto.** Um projeto Supabase publica o schema `public` inteiro
numa API REST que responde à chave publicável — a mesma que vai no bundle do
navegador. Sem RLS, essa API entrega leitura e escrita de tudo a quem souber a
URL do projeto. Por isso `db:migrate` roda o `harden:db` logo em seguida
(`postdb:migrate`), que liga RLS em todas as tabelas e revoga os grants de
`anon` e `authenticated`. **Não pule esse passo, e não troque a ordem.**

**Segredo nenhum entra no config.** O `ClientConfig` guarda nomes, domínios,
regiões e cores. Chaves vivem em `.env.local` (por cliente) e `.factory.env` (do
operador), ambos fora do versionamento. O validador recusa um config que pareça
conter um segredo.

---

## Documentação

`docs/architecture/` explica as decisões e o motivo de cada uma:

- `cms-factory-architecture.md` — o desenho completo: isolamento entre clientes,
  schema, codegen, infraestrutura e banco plugável
- `adr-001` — como o core é injetado no cliente sem que um cliente importe o outro
- `adr-002` — o contrato dos campos e como ele vira Zod, formulário e coluna
- `adr-003` — o pipeline de codegen e por que ele é determinístico
- `adr-004` — como o core é empacotado (`src` em desenvolvimento, `dist` em produção)

---

## Rodando os testes

```bash
pnpm test        # todos os workspaces
pnpm typecheck
```

O core tem um teste de **equivalência** que compara o que os builders produzem
contra o schema literal do CMS que deu origem à fábrica. É ele que garante que
uma mudança no gerador não altere silenciosamente o comportamento dos CMS já
entregues.

---

## Licença

MIT — veja [LICENSE](LICENSE). Forke, modifique e cobre pelos CMS que você
gerar com isto. O único requisito é manter o aviso de copyright junto com o
código.
