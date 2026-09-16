// @cms-core/cli — router da `cms-factory` (S3.1 + S3.3).
//
// Comandos:
//   cms-factory validate      --config <path>            (S3.1)
//   cms-factory generate      --config <path>            (S3.1)
//   cms-factory create-client --config <path> [--skip-provision] [--out <dir>]
//                                                        (S3.3, D3+D4)
//
// A Fase 3 cobre APENAS `--skip-provision` (as etapas de infra — provision/
// deploy/smoke — são a Fase 4). Sem `--skip-provision` o comando aborta com uma
// mensagem clara apontando a Fase 4.

import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runCodegen } from "./codegen/index.js";
import {
  loadClientConfig,
  resolveConfigPath,
  ClientConfigValidationError,
} from "./load-config.js";
import { scaffoldWorkspace } from "./scaffold.js";
import { loadFactoryEnv, tokensFromEnv, preflight } from "./preflight.js";
import { provision } from "./provision/orchestrator.js";
import { runDeploy } from "./provision/deploy.js";

export interface ParsedArgs {
  command: string | undefined;
  config?: string;
  out?: string;
  db?: string;
  skipProvision: boolean;
  force: boolean;
  dryRun: boolean;
  resume: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    command: undefined,
    skipProvision: false,
    force: false,
    dryRun: false,
    resume: false,
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--config") out.config = argv[++i];
    else if (arg.startsWith("--config=")) out.config = arg.slice("--config=".length);
    else if (arg === "--out") out.out = argv[++i];
    else if (arg.startsWith("--out=")) out.out = arg.slice("--out=".length);
    else if (arg === "--db") out.db = argv[++i];
    else if (arg.startsWith("--db=")) out.db = arg.slice("--db=".length);
    else if (arg === "--skip-provision") out.skipProvision = true;
    else if (arg === "--force") out.force = true;
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--resume") out.resume = true;
    else if (!arg.startsWith("-")) positional.push(arg);
  }
  out.command = positional[0];
  return out;
}

/** Raiz do monorepo: sobe de `cli/src/` até o dir com pnpm-workspace.yaml. */
export function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    if (
      existsSync(resolve(dir, "pnpm-workspace.yaml")) ||
      existsSync(resolve(dir, "clients"))
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

interface RunCtx {
  cwd: string;
  /** stdio para spawn — herdado por default; injetável em teste. */
  runCommand?: (cmd: string, args: string[], cwd: string) => number;
}

function defaultRunCommand(cmd: string, args: string[], cwd: string): number {
  const res = spawnSync(cmd, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  return res.status ?? 1;
}

// ── validate ────────────────────────────────────────────────────────────────
async function cmdValidate(args: ParsedArgs, ctx: RunCtx): Promise<number> {
  if (!args.config) {
    console.error("cms-factory validate: faltou --config <path>.");
    return 2;
  }
  try {
    const { config } = await loadClientConfig(args.config, ctx.cwd);
    if (args.db && args.db !== config.providers.database.kind) {
      console.error(
        `cms-factory validate: --db=${args.db} diverge de providers.database.kind=${config.providers.database.kind} no config.`,
      );
      return 1;
    }
    console.log(
      `✓ config válido: slug="${config.slug}" (${config.collections.length} coleção(ões), database=${config.providers.database.kind}).`,
    );
    return 0;
  } catch (err) {
    if (err instanceof ClientConfigValidationError) {
      console.error(err.message);
    } else {
      console.error(err instanceof Error ? err.message : String(err));
    }
    return 1;
  }
}

// ── generate ──────────────────────────────────────────────────────────────
async function cmdGenerate(args: ParsedArgs, ctx: RunCtx): Promise<number> {
  if (!args.config) {
    console.error("cms-factory generate: faltou --config <path>.");
    return 2;
  }
  try {
    const { config, exportName, workspaceDir } = await loadClientConfig(
      args.config,
      ctx.cwd,
    );
    const { written } = runCodegen(config, workspaceDir, {
      configExportName: exportName,
    });
    for (const f of written) console.log(`  gerado: ${f}`);
    console.log(`cms-factory generate: ${written.length} arquivo(s) gerado(s).`);
    return 0;
  } catch (err) {
    if (err instanceof ClientConfigValidationError) {
      console.error(err.message);
    } else {
      console.error(err instanceof Error ? err.message : String(err));
    }
    return 1;
  }
}

// ── create-client ─────────────────────────────────────────────────────────
// --skip-provision: só scaffold local + codegen + db:generate (Fase 3).
// (default):        scaffold local → provisionamento (Fase 4) → deploy skeleton.
// --dry-run:        ponta a ponta em plan-only (zero chamadas, sem tokens).
async function cmdCreateClient(args: ParsedArgs, ctx: RunCtx): Promise<number> {
  if (!args.config) {
    console.error("cms-factory create-client: faltou --config <path>.");
    return 2;
  }

  const run = ctx.runCommand ?? defaultRunCommand;
  const repoRoot = findRepoRoot(ctx.cwd);

  // 1. validate-config (falha dura aborta tudo).
  let loaded;
  try {
    loaded = await loadClientConfig(args.config, ctx.cwd);
  } catch (err) {
    if (err instanceof ClientConfigValidationError) console.error(err.message);
    else console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  const { config, exportName, configPath } = loaded;
  if (args.db && args.db !== config.providers.database.kind) {
    console.error(
      `cms-factory create-client: --db=${args.db} diverge de providers.database.kind=${config.providers.database.kind}.`,
    );
    return 1;
  }
  console.log(`[1/5] config válido — slug="${config.slug}".`);

  if (args.dryRun) {
    const dest = args.out ?? `clients/${config.slug}`;
    console.log(`[dry-run] scaffold → ${dest}; codegen; pnpm install; db:generate.`);
    if (!args.skipProvision) {
      const code = await runProvisionDryRun(config, repoRoot);
      if (code !== 0) return code;
    }
    return 0;
  }

  // 2. scaffold workspace + inject config/assets/package.json.
  let outDir: string;
  try {
    const res = scaffoldWorkspace({
      config,
      configPath,
      configExportName: exportName,
      repoRoot,
      outDir: args.out,
      force: args.force,
    });
    outDir = res.outDir;
    console.log(`[2/5] workspace scaffoldado → ${outDir}`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  // 3. link workspace (pnpm install no root resolve @cms-core/core → workspace).
  const installStatus = run("pnpm", ["install"], repoRoot);
  if (installStatus !== 0) {
    console.error(
      `[3/5] pnpm install falhou (status ${installStatus}). Workspace criado em ${outDir}; rode 'pnpm install' na raiz e retome.`,
    );
    return installStatus;
  }
  console.log("[3/5] workspace linkado (pnpm install).");

  // 4. codegen (enums, content-types, facets, zod, ui-fields, theme, nav, env).
  try {
    const { written } = runCodegen(config, outDir, {
      configExportName: exportName,
    });
    console.log(`[4/5] codegen: ${written.length} arquivo(s) gerado(s).`);
  } catch (err) {
    console.error(
      `[4/5] codegen falhou: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }

  // 5. drizzle generate (migrations a partir do schema gerado).
  const dbGenStatus = run("pnpm", ["--filter", config.slug, "run", "db:generate"], repoRoot);
  if (dbGenStatus !== 0) {
    console.error(
      `[5/5] db:generate falhou (status ${dbGenStatus}). Rode 'pnpm --filter ${config.slug} run db:generate' manualmente.`,
    );
    return dbGenStatus;
  }
  console.log("[5/5] migrations geradas (drizzle-kit).");

  if (args.skipProvision) {
    console.log(
      `\n✓ create-client (--skip-provision) concluído.\n` +
        `  workspace: ${outDir}\n` +
        `  próximo:   preencher clients/${config.slug}/.env.local e rodar, nesta ordem:\n` +
        `               pnpm --filter ${config.slug} run db:migrate    (aplica o schema E fecha o banco — o postdb:migrate\n` +
        `                                                     roda o harden:db, que liga RLS em todas as tabelas)\n` +
        `               pnpm --filter ${config.slug} run seed:locales  (sem isto o admin abre no idioma errado)\n` +
        `               pnpm --filter ${config.slug} run seed:admin -- <email> '<senha>'\n` +
        `  provision: rode sem --skip-provision para provisionar a infra (Fase 4).`,
    );
    return 0;
  }

  // 6. provisionamento real (Fase 4) — exige tokens em .factory.env.
  console.log(`\n[provision] iniciando (banco=${config.providers.database.kind})…`);
  return runProvisionReal(config, repoRoot, args.resume);
}

/** Provisionamento em modo plan-only (dry-run): zero chamadas, sem tokens. */
async function runProvisionDryRun(
  config: Parameters<typeof provision>[0]["config"],
  repoRoot: string,
): Promise<number> {
  const outcome = await provision({
    config,
    repoRoot,
    tokens: {}, // dry-run não precisa de tokens
    dryRun: true,
  });
  const deploy = await runDeploy({
    config,
    env: outcome.env,
    log: { info: console.log, warn: console.warn, plan: (m) => console.log(`[plan] ${m}`), lines: [] },
    dryRun: true,
  });
  console.log(
    `[dry-run] provision: ${outcome.composition.length} adapter(s) — ${outcome.composition.join(" → ")}; ` +
      `deploy: ${deploy.results.length} passo(s) planejados.`,
  );
  return outcome.ok ? 0 : 1;
}

/** Provisionamento real: preflight de tokens → orquestrador → deploy skeleton. */
async function runProvisionReal(
  config: Parameters<typeof provision>[0]["config"],
  repoRoot: string,
  resume: boolean,
): Promise<number> {
  const tokens = tokensFromEnv(loadFactoryEnv(repoRoot));
  const pf = preflight([config], tokens);
  if (!pf.ok) {
    console.error(
      `[provision] preflight falhou — tokens ausentes em .factory.env: ${pf.missing.join(", ")}.\n` +
        `  Preencha ./.factory.env (veja .factory.env.example) e retome.` +
        (pf.needsNeon ? "\n  (config usa database=neon ⇒ NEON_API_KEY exigido.)" : ""),
    );
    return 2;
  }
  const outcome = await provision({ config, repoRoot, tokens, resume });
  if (!outcome.ok) {
    console.error(
      `[provision] falhou${outcome.failedAt ? ` em "${outcome.failedAt}"` : ""}.` +
        (outcome.orphans.length
          ? `\n  Recursos órfãos a limpar à mão:\n    - ${outcome.orphans.join("\n    - ")}`
          : "\n  Rollback concluído — nada órfão."),
    );
    return 1;
  }
  console.log(
    `\n✓ provisionamento concluído (${config.providers.database.kind}).\n` +
      `  composição: ${outcome.composition.join(" → ")}\n` +
      (outcome.adminPassword
        ? `  senha admin (impressa UMA vez — troque no 1º login + TOTP): ${outcome.adminPassword}\n`
        : "") +
      `  deploy (migrate/seed/smoke): S4.8 — pendente de banco/tokens (execute o deploy real).`,
  );
  return 0;
}

export async function run(argv: string[], ctx: RunCtx = { cwd: process.cwd() }): Promise<number> {
  const args = parseArgs(argv);
  switch (args.command) {
    case "validate":
      return cmdValidate(args, ctx);
    case "generate":
      return cmdGenerate(args, ctx);
    case "create-client":
      return cmdCreateClient(args, ctx);
    case undefined:
    case "help":
      printUsage();
      return args.command === undefined ? 2 : 0;
    default:
      console.error(`cms-factory: comando desconhecido "${args.command}".`);
      printUsage();
      return 2;
  }
}

function printUsage(): void {
  console.log(
    [
      "cms-factory — fábrica de CMS (criador-de-cms)",
      "",
      "Uso:",
      "  cms-factory validate      --config <path>",
      "  cms-factory generate      --config <path>",
      "  cms-factory create-client --config <path> [--skip-provision] [--out <dir>] [--db <supabase|neon>] [--force] [--dry-run] [--resume]",
      "",
      "  --skip-provision  só scaffold local + codegen + db:generate (Fase 3).",
      "  (default)         scaffold + provisionamento (Supabase/Neon/Bunny/Resend/Vercel) — exige ./.factory.env.",
      "  --dry-run         ponta a ponta em plan-only (zero chamadas, sem tokens).",
      "  --resume          retoma o provisionamento pulando recursos já verificados.",
    ].join("\n"),
  );
}

// Executa quando chamado diretamente (não quando importado por testes/bin).
const invokedDirectly =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) {
  run(process.argv.slice(2)).then((code) => process.exit(code));
}
