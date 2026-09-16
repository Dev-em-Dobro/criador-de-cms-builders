// @cms-core/cli — scaffold de um workspace-cliente (S3.2).
//
// Copia a casca Next.js config-agnóstica de `templates/client-app/` para
// `clients/<slug>/`, injeta o `client.config.ts` do cliente, copia o asset de
// logo (se declarado em `branding.logoPath`) e ajusta o `package.json` do
// workspace (name = slug, dev/start port determinístico).
//
// (D1 monorepo) NÃO cria um repositório novo — cria um WORKSPACE dentro do
// monorepo `criador-de-cms`. O root já inclui `clients/*` em `workspaces`, então
// o link de `@cms-core/core` (workspace:*) é resolvido no `pnpm install`.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { resolve, dirname, join, isAbsolute } from "node:path";
import type { ClientConfig } from "@cms-core/core/config";

/** Arquivos/pastas que NUNCA são copiados do template (defensivo — o template
 *  não deveria conter nenhum deles, mas ignoramos se algum vazar). */
const TEMPLATE_IGNORE = new Set<string>([
  "node_modules",
  ".next",
  "dist",
  ".turbo",
  "test-results",
  ".env.local",
]);

/**
 * Caminhos (relativos ao workspace) que pertencem ao CLIENTE e não ao template:
 * num re-scaffold com `--force` eles são PRESERVADOS, nunca sobrescritos.
 *
 * `db/migrations/` é o histórico do banco. O template carrega um
 * `meta/_journal.json` vazio (`entries: []`) para o drizzle-kit inicializar um
 * cliente novo; copiá-lo por cima de um cliente existente zera o journal e as
 * migrations viram órfãs — `drizzle-kit migrate` passa a reportar sucesso sem
 * aplicar nada, e um `generate` seguinte não recria o que ficou para trás.
 * Descoberto num cliente real, com o banco já provisionado.
 */
const PRESERVE_ON_FORCE = ["db/migrations"];

export interface ScaffoldOptions {
  /** ClientConfig já validado. */
  config: ClientConfig;
  /** Caminho absoluto do `client.config.ts` de origem (será injetado no destino). */
  configPath: string;
  /**
   * Nome do export de onde o config veio (`default` | `<nome>`), como resolvido
   * por `pickConfig`. Os arquivos ESTÁTICOS do template importam o config pelo
   * default (`import clientConfig from "@/client.config"`); quando o config do
   * cliente expõe um export NOMEADO, essa linha é reescrita no destino — mesma
   * regra que os geradores aplicam (gen-zod/gen-ui-fields). Default: "default".
   */
  configExportName?: string;
  /** Raiz do monorepo (onde ficam `templates/` e `clients/`). */
  repoRoot: string;
  /** Destino do workspace. Default `<repoRoot>/clients/<slug>`. */
  outDir?: string;
  /** Caminho do template. Default `<repoRoot>/templates/client-app`. */
  templateDir?: string;
  /** Se true, sobrescreve um destino já existente (default false → erro se existe). */
  force?: boolean;
}

export interface ScaffoldResult {
  /** Diretório absoluto do workspace criado. */
  outDir: string;
  /** Arquivos escritos/ajustados fora da cópia bruta do template. */
  written: string[];
}

/** Porta de dev determinística a partir do slug (3000–3999), estável por cliente. */
export function portForSlug(slug: string): number {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = (hash * 31 + slug.charCodeAt(i)) >>> 0;
  }
  return 3000 + (hash % 1000);
}

/**
 * Ajusta o `package.json` do workspace scaffoldado: name = slug, e substitui a
 * porta fixa do template (3000) pela porta determinística do slug nos scripts
 * `dev`/`start`. Retorna o JSON serializado (com newline final).
 */
export function patchWorkspacePackageJson(
  raw: string,
  slug: string,
  displayName: string,
): string {
  const pkg = JSON.parse(raw) as Record<string, unknown> & {
    scripts?: Record<string, string>;
  };
  pkg.name = slug;
  pkg.description = `Headless CMS gerado pela fábrica criador-de-cms para ${displayName}.`;
  const port = portForSlug(slug);
  if (pkg.scripts) {
    for (const key of Object.keys(pkg.scripts)) {
      pkg.scripts[key] = pkg.scripts[key].replace(/-p\s+\d+/g, `-p ${port}`);
    }
  }
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

/**
 * Linha de import do config usada pelos arquivos estáticos do template. Neutra
 * quanto ao nome do export (default import) — o scaffold a reescreve quando o
 * config do cliente exporta com nome.
 */
export const TEMPLATE_CONFIG_IMPORT = 'import clientConfig from "@/client.config";';

/** Linha de import equivalente para um dado nome de export (espelha gen-zod). */
export function configImportLine(exportName: string): string {
  return exportName === "default"
    ? TEMPLATE_CONFIG_IMPORT
    : `import { ${exportName} as clientConfig } from "@/client.config";`;
}

/**
 * Reescreve, nos `.ts`/`.tsx` já copiados para o destino, o import do config
 * para casar com o nome do export real. No-op quando o config expõe `default`.
 * Sem isso, um config que exporta só um nome (`export const acmeConfig`) gera um
 * workspace que não compila — o template importaria um default inexistente.
 */
export function rewriteConfigImports(dir: string, exportName: string): string[] {
  const line = configImportLine(exportName);
  if (line === TEMPLATE_CONFIG_IMPORT) return [];

  const touched: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!TEMPLATE_IGNORE.has(entry.name)) walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const raw = readFileSync(full, "utf8");
      if (!raw.includes(TEMPLATE_CONFIG_IMPORT)) continue;
      writeFileSync(full, raw.split(TEMPLATE_CONFIG_IMPORT).join(line), "utf8");
      touched.push(full);
    }
  };
  walk(dir);
  return touched;
}

/**
 * Copia `templates/client-app` → `clients/<slug>/`, injeta o config e ajusta o
 * package.json. Idempotente com `force`.
 */
export function scaffoldWorkspace(opts: ScaffoldOptions): ScaffoldResult {
  const { config, configPath, repoRoot } = opts;
  const slug = config.slug;
  const templateDir =
    opts.templateDir ?? resolve(repoRoot, "templates", "client-app");
  const outDir = opts.outDir
    ? isAbsolute(opts.outDir)
      ? opts.outDir
      : resolve(repoRoot, opts.outDir)
    : resolve(repoRoot, "clients", slug);

  if (!existsSync(templateDir)) {
    throw new Error(
      `scaffold: template não encontrado em ${templateDir} (S3.2 — templates/client-app/).`,
    );
  }
  if (existsSync(outDir) && !opts.force) {
    throw new Error(
      `scaffold: destino já existe: ${outDir} (use force para sobrescrever).`,
    );
  }

  // 1. Cópia bruta do template (ignora artefatos que não deveriam estar lá e
  //    preserva o que já é do cliente — ver PRESERVE_ON_FORCE).
  const preserved = PRESERVE_ON_FORCE.filter((rel) =>
    existsSync(resolve(outDir, rel)),
  );
  mkdirSync(outDir, { recursive: true });
  cpSync(templateDir, outDir, {
    recursive: true,
    filter: (src) => {
      const rel = src.slice(templateDir.length + 1);
      const base = rel.split(/[\\/]/)[0];
      if (base !== "" && TEMPLATE_IGNORE.has(base)) return false;
      // não sobrescreve o histórico de migrations de um cliente já existente
      const norm = rel.split(/[\\/]/).join("/");
      return !preserved.some((p) => norm === p || norm.startsWith(`${p}/`));
    },
  });

  const written: string[] = [];

  // 2. Injeta o client.config.ts do cliente.
  const destConfig = join(outDir, "client.config.ts");
  copyFileSync(configPath, destConfig);
  written.push(destConfig);

  // 2b. Alinha o import do config nos arquivos estáticos do template ao nome do
  //     export real (no-op quando o config expõe `export default`).
  written.push(...rewriteConfigImports(outDir, opts.configExportName ?? "default"));

  // 3. Ajusta o package.json (name = slug, portas).
  const destPkg = join(outDir, "package.json");
  if (existsSync(destPkg)) {
    const patched = patchWorkspacePackageJson(
      readFileSync(destPkg, "utf8"),
      slug,
      config.displayName,
    );
    writeFileSync(destPkg, patched, "utf8");
    written.push(destPkg);
  }

  // 4. Copia o asset de logo, se declarado (relativo ao dir do config de origem).
  const logoPath = config.branding.logoPath;
  if (logoPath) {
    const srcLogo = isAbsolute(logoPath)
      ? logoPath
      : resolve(dirname(configPath), logoPath);
    if (existsSync(srcLogo)) {
      const destLogo = join(outDir, logoPath);
      mkdirSync(dirname(destLogo), { recursive: true });
      copyFileSync(srcLogo, destLogo);
      written.push(destLogo);
    } else {
      console.warn(
        `scaffold: branding.logoPath="${logoPath}" não encontrado em ${srcLogo} — pulado.`,
      );
    }
  }

  return { outDir, written };
}
