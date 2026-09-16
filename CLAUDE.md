# Criador de CMS — instruções para agentes

Este repositório é uma **fábrica**: ele não é um CMS, ele gera CMS. Um arquivo
de configuração por cliente vira um workspace Next.js completo em `clients/`.
Leia o `README.md` para o fluxo de uso e `docs/architecture/` para o porquê das
decisões.

## As regras que mais importam aqui

**Não edite arquivos gerados.** Qualquer arquivo com `.generated.` no nome é
reescrito pelo codegen. Para mudar o que ele contém, mude o `ClientConfig` do
cliente e rode `pnpm cms-factory generate --config configs/<slug>.config.ts`. Se
o config não consegue expressar a mudança, o lugar dela é `packages/core` —
nunca o arquivo gerado.

**Comportamento novo vai no core, não no cliente.** `packages/core` é o único
lugar onde o comportamento do CMS mora; os clientes consomem por
`workspace:*`. Código específico de cliente em `clients/<slug>/` é sinal de que
o contrato do config está faltando alguma coisa — proponha a extensão do
contrato em vez de resolver localmente.

**Um cliente nunca importa de outro.** `clients/a` não conhece `clients/b`. O
caminho entre eles é sempre `packages/core`.

**Segredo nenhum entra num `ClientConfig`.** O config guarda nomes, domínios,
regiões e cores. Chaves vivem em `.env.local` (por cliente) e `.factory.env` (do
operador) — ambos fora do versionamento. O validador recusa configs que pareçam
conter segredos; não tente contornar essa checagem.

**`db:migrate` fecha o banco.** O `postdb:migrate` roda o `harden:db`, que liga
RLS e revoga os grants públicos. Nunca sugira pular esse passo ou rodar as
migrations por fora dele — sem ele o banco fica legível e gravável por quem
tiver a URL do projeto.

## Antes de dar qualquer tarefa por concluída

```bash
pnpm typecheck
pnpm test
```

Mudou `packages/core`? Os testes de todos os workspaces em `clients/*` precisam
passar — é o que o workflow `core-blast-radius.yml` verifica. Mudou um config?
Commite os arquivos gerados junto, ou o `codegen-drift.yml` reprova o PR.
