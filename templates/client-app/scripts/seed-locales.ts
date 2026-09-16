/**
 * Popula a tabela `locales` a partir do `client.config.ts`.
 *
 * Por que existe: o registro de idiomas nasce VAZIO num cliente recém-gerado, e
 * o core então cai no fallback `"en"` (`getDefaultLocale`/`resolveLocale` em
 * `@cms-core/core/i18n`). Num CMS que não é inglês isso faz o admin procurar
 * conteúdo no idioma errado — a tela de uma página singleton abre em branco
 * mesmo com o conteúdo publicado, e a barra de idiomas aparece sem idioma
 * nenhum. Rode uma vez logo após as migrations.
 *
 * Uso:
 *   npm run seed:locales
 *
 * Re-executável: atualiza rótulo/ordem/default dos códigos já cadastrados e não
 * remove idiomas criados à mão pelo admin.
 */
export {};

try {
  process.loadEnvFile(".env.local");
} catch {
  // sem .env.local — usa o ambiente do shell
}

async function main() {
  const { eq } = await import("drizzle-orm");
  const { db } = await import("../db");
  const schema = await import("../db/schema");
  const clientConfig = (await import("../client.config")).default;

  const { default: padrao, enabled } = clientConfig.locales;
  if (!enabled?.length) {
    throw new Error("client.config.ts não declara locales.enabled");
  }

  for (const [i, loc] of enabled.entries()) {
    const [existente] = await db
      .select()
      .from(schema.locales)
      .where(eq(schema.locales.code, loc.code));

    const valores = {
      label: loc.label,
      isDefault: loc.code === padrao,
      enabled: true,
      sortOrder: i,
      updatedAt: new Date(),
    };

    if (existente) {
      await db
        .update(schema.locales)
        .set(valores)
        .where(eq(schema.locales.code, loc.code));
      console.log(`~ ${loc.code} (${loc.label})${valores.isDefault ? " — padrão" : ""}`);
    } else {
      await db.insert(schema.locales).values({ code: loc.code, ...valores });
      console.log(`+ ${loc.code} (${loc.label})${valores.isDefault ? " — padrão" : ""}`);
    }
  }

  const todos = await db.select().from(schema.locales);
  console.log(
    `\nIdiomas cadastrados: ${todos.length} · padrão: ${todos.find((l) => l.isDefault)?.code ?? "(nenhum)"}`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
