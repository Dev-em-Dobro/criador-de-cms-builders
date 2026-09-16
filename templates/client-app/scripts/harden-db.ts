/**
 * Fecha o banco do CMS para o PostgREST: liga RLS em todas as tabelas do
 * schema `public` e revoga os grants de `anon`/`authenticated`.
 *
 * ⚠️ POR QUE ISTO PRECISA EXISTIR. Um projeto Supabase publica o schema
 * `public` inteiro numa API REST (PostgREST) que responde à chave
 * *publishable* — a mesma que vai no `NEXT_PUBLIC_*`, ou seja, pública por
 * definição. Sem RLS, essa API entrega leitura E escrita de tudo a quem tiver
 * a URL do projeto: conteúdo, `leads`, a trilha de `audit_log`, os `profiles`
 * dos admins e o segredo HMAC em `webhook_endpoints`. Aconteceu de verdade no
 * CMS gerado por esta fábrica (alerta do Supabase, confirmado explorável).
 *
 * ⚠️ POR QUE NÃO CRIAMOS NENHUMA POLICY. Este CMS não usa PostgREST: o
 * `supabase-js` aqui só faz `.auth.*`, e todo acesso a dado passa pelo Drizzle
 * com a `DATABASE_URL`, cujo usuário (`postgres`) tem BYPASSRLS. Então "RLS
 * ligado + zero policies" é exatamente o que queremos — nega tudo pela API
 * pública e não custa uma linha de latência ao app. Criar policies aqui seria
 * escrever regra para um caminho que ninguém usa.
 *
 * As tabelas NÃO são hardcoded: a lista vem do catálogo do Postgres, então uma
 * coleção nova (que vira tabela nova pelo codegen) já entra na varredura.
 *
 * Uso:
 *   pnpm --filter <cliente> exec tsx scripts/harden-db.ts
 *
 * Re-executável: só age no que ainda está aberto e imprime o que mudou.
 */
export {};

try {
  process.loadEnvFile(".env.local");
} catch {
  // sem .env.local — usa o ambiente do shell
}

interface Tabela {
  nome: string;
  rls: boolean;
  policies: number;
}

async function main() {
  const { default: postgres } = await import("postgres");

  // DIRECT_URL (5432, session mode) e não o pooler: é DDL, e o pooler em modo
  // transaction é justamente o que o drizzle.config já evita para migrations.
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DIRECT_URL (ou DATABASE_URL) não definida");

  const sql = postgres(url, { prepare: false, ssl: "require" });

  const tabelas = (await sql`
    select c.relname as nome,
           c.relrowsecurity as rls,
           (select count(*)::int from pg_policies p
             where p.schemaname = 'public' and p.tablename = c.relname) as policies
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
     order by c.relname
  `) as unknown as Tabela[];

  if (tabelas.length === 0) {
    throw new Error(
      "Nenhuma tabela em `public` — rode as migrations antes do hardening.",
    );
  }

  let ligadas = 0;
  for (const t of tabelas) {
    if (t.rls) {
      console.log(`= ${t.nome} — já protegida`);
      continue;
    }
    // Nome de tabela não pode ser parâmetro de bind. Ele vem do catálogo do
    // Postgres, não de input do usuário, mas a checagem fica assim mesmo:
    // custa nada e impede que um identificador exótico vire SQL solto.
    if (!/^[a-z_][a-z0-9_]*$/i.test(t.nome)) {
      throw new Error(`Nome de tabela inesperado: ${t.nome}`);
    }
    await sql.unsafe(
      `alter table public."${t.nome}" enable row level security`,
    );
    console.log(`+ ${t.nome} — RLS ligado`);
    ligadas++;
  }

  // Cinto e suspensório: mesmo que alguém crie uma policy permissiva por
  // engano, sem GRANT o PostgREST não chega na tabela. E o DEFAULT PRIVILEGES
  // faz a próxima tabela criada pelo `postgres` já nascer fechada — o buraco
  // aqui é sempre a tabela que alguém esquece.
  await sql.unsafe(`
    revoke all on all tables in schema public from anon, authenticated;
    revoke all on all sequences in schema public from anon, authenticated;
    alter default privileges for role postgres in schema public
      revoke all on tables from anon, authenticated;
    alter default privileges for role postgres in schema public
      revoke all on sequences from anon, authenticated;
  `);
  console.log("· grants de anon/authenticated revogados (atuais e futuros)");

  const abertas = (await sql`
    select c.relname as nome from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false
  `) as unknown as { nome: string }[];

  console.log(
    `\n${tabelas.length} tabela(s) em public · ${ligadas} protegida(s) agora · ${abertas.length} ainda aberta(s)`,
  );

  await sql.end();
  // Sai diferente de zero se sobrou tabela aberta: serve de gate em pipeline.
  process.exit(abertas.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
