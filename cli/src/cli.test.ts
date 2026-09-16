// @cms-core/cli — testes da cms-factory (S3.1/S3.2/S3.3).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  cpSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, findRepoRoot, run } from "./cli.js";
import {
  portForSlug,
  patchWorkspacePackageJson,
  scaffoldWorkspace,
  configImportLine,
  TEMPLATE_CONFIG_IMPORT,
} from "./scaffold.js";
import { loadClientConfig } from "./load-config.js";
import { runCodegen } from "./codegen/index.js";

const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
const repoRoot = resolve(here, "..", "..");
const baselineConfig = resolve(
  repoRoot,
  "templates/config-examples/demo-corp.config.ts",
);
const goldDir = resolve(repoRoot, "clients/demo-corp");
const templateDir = resolve(repoRoot, "templates/client-app");

/**
 * O gold-standard é a cópia de trabalho do CMS-modelo de onde a fábrica saiu —
 * um workspace real em `clients/demo-corp`, que NÃO é distribuído com o
 * repositório. Onde ele existe, os testes de equivalência comparam o codegen
 * contra ele; onde não (num fork, no CI), esses testes pulam e o resto da
 * suíte segue valendo. Um vermelho aqui num clone limpo seria só ruído.
 */
const hasGold = existsSync(goldDir);

/** Artefatos gerados commitados (exclui .env.local git-ignored). */
const GENERATED = [
  "db/schema/enums.generated.ts",
  "lib/content/content-types.generated.ts",
  "db/schema/facets.generated.ts",
  "lib/content/schemas.generated.ts",
  "lib/content/ui-fields.generated.ts",
  "app/theme.generated.css",
  "lib/admin/nav.generated.ts",
];

// ── parseArgs ────────────────────────────────────────────────────────────────
describe("parseArgs", () => {
  it("parses command + flags (space and = forms)", () => {
    const a = parseArgs([
      "create-client",
      "--config",
      "./c.ts",
      "--skip-provision",
      "--out=clients/x",
    ]);
    expect(a.command).toBe("create-client");
    expect(a.config).toBe("./c.ts");
    expect(a.skipProvision).toBe(true);
    expect(a.out).toBe("clients/x");
  });

  it("defaults skipProvision/force/dryRun to false", () => {
    const a = parseArgs(["validate", "--config=./c.ts"]);
    expect(a.command).toBe("validate");
    expect(a.config).toBe("./c.ts");
    expect(a.skipProvision).toBe(false);
    expect(a.force).toBe(false);
    expect(a.dryRun).toBe(false);
  });
});

// ── portForSlug / patchWorkspacePackageJson ──────────────────────────────────
describe("scaffold helpers", () => {
  it("portForSlug is deterministic and in 3000–3999", () => {
    const p1 = portForSlug("acme");
    const p2 = portForSlug("acme");
    expect(p1).toBe(p2);
    expect(p1).toBeGreaterThanOrEqual(3000);
    expect(p1).toBeLessThan(4000);
  });

  it("patchWorkspacePackageJson sets name=slug and rewrites ports", () => {
    const raw = JSON.stringify({
      name: "cms-client-template",
      scripts: { dev: "next dev -p 3010", start: "next start -p 3010" },
    });
    const out = patchWorkspacePackageJson(raw, "acme", "Acme Inc");
    const pkg = JSON.parse(out);
    const port = portForSlug("acme");
    expect(pkg.name).toBe("acme");
    expect(pkg.scripts.dev).toBe(`next dev -p ${port}`);
    expect(pkg.scripts.start).toBe(`next start -p ${port}`);
    expect(out.endsWith("\n")).toBe(true);
  });
});

// ── findRepoRoot ─────────────────────────────────────────────────────────────
describe("findRepoRoot", () => {
  it("finds the monorepo root from a nested dir", () => {
    const root = findRepoRoot(here);
    expect(existsSync(resolve(root, "pnpm-workspace.yaml"))).toBe(true);
  });
});

// ── loadClientConfig / validate ──────────────────────────────────────────────
describe("loadClientConfig", () => {
  it("loads + validates the baseline config", async () => {
    const { config, exportName } = await loadClientConfig(baselineConfig);
    expect(config.slug).toBe("demo-corp");
    expect(config.collections.length).toBeGreaterThan(0);
    expect(typeof exportName).toBe("string");
  });

  it("throws on an invalid config", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cms-invalid-"));
    const bad = join(dir, "bad.config.ts");
    writeFileSync(bad, "export default { slug: 123 };", "utf8");
    await expect(loadClientConfig(bad)).rejects.toThrow();
    rmSync(dir, { recursive: true, force: true });
  });
});

// ── scaffoldWorkspace ────────────────────────────────────────────────────────
describe("scaffoldWorkspace", () => {
  let outDir: string;
  afterEach(() => {
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  it("copies template, injects config, patches package.json", async () => {
    const { config, configPath } = await loadClientConfig(baselineConfig);
    outDir = mkdtempSync(join(tmpdir(), "cms-scaffold-"));
    rmSync(outDir, { recursive: true, force: true }); // scaffold recreates it
    const res = scaffoldWorkspace({
      config,
      configPath,
      repoRoot,
      outDir,
      templateDir,
      force: true,
    });
    expect(res.outDir).toBe(outDir);
    // config injected
    expect(existsSync(join(outDir, "client.config.ts"))).toBe(true);
    // shell files copied
    expect(existsSync(join(outDir, "next.config.mjs"))).toBe(true);
    expect(existsSync(join(outDir, "db/schema/index.ts"))).toBe(true);
    // package.json patched to slug
    const pkg = JSON.parse(readFileSync(join(outDir, "package.json"), "utf8"));
    expect(pkg.name).toBe("demo-corp");
    // template must NOT ship generated artifacts
    expect(existsSync(join(outDir, "db/schema/enums.generated.ts"))).toBe(false);
  });

  // Regressão: um cliente real exportava `export default` +
  // `export const <slug>Config`, e o template trazia `demoCorpConfig`
  // hardcoded — o workspace gerado não compilava (TS2614). O template agora
  // importa o default e o scaffold reescreve a linha quando o export é nomeado.
  it("rewrites the config import to match a NAMED export", async () => {
    const { config, configPath } = await loadClientConfig(baselineConfig);
    outDir = mkdtempSync(join(tmpdir(), "cms-scaffold-named-"));
    rmSync(outDir, { recursive: true, force: true });
    scaffoldWorkspace({
      config,
      configPath,
      // o baseline não tem `export default` → pickConfig devolve o nome
      configExportName: "demoCorpConfig",
      repoRoot,
      outDir,
      templateDir,
      force: true,
    });
    const runtime = readFileSync(join(outDir, "lib/core-runtime.ts"), "utf8");
    expect(runtime).toContain(
      'import { demoCorpConfig as clientConfig } from "@/client.config";',
    );
    expect(runtime).not.toContain(TEMPLATE_CONFIG_IMPORT);
    // o corpo continua usando o alias neutro
    expect(runtime).toContain("clientConfig.collections");
    // todos os consumidores estáticos do config são reescritos, não só um
    for (const f of ["app/(admin)/layout.tsx", "lib/email/resend.ts"]) {
      expect(readFileSync(join(outDir, f), "utf8")).toContain(
        'import { demoCorpConfig as clientConfig } from "@/client.config";',
      );
    }
  });

  // Regressão: `--force` num cliente EXISTENTE copiava o `db/migrations/` do
  // template por cima, zerando `meta/_journal.json` (entries: []). As migrations
  // já aplicadas viravam órfãs e `drizzle-kit migrate` passava a reportar
  // sucesso sem aplicar nada. Pego num cliente real, banco vazio.
  it("preserves an existing client's db/migrations on --force", async () => {
    const { config, configPath } = await loadClientConfig(baselineConfig);
    outDir = mkdtempSync(join(tmpdir(), "cms-scaffold-migr-"));
    const opts = { config, configPath, repoRoot, outDir, templateDir, force: true };

    scaffoldWorkspace(opts); // 1ª geração: journal vazio vindo do template
    const journal = join(outDir, "db/migrations/meta/_journal.json");
    const sqlFile = join(outDir, "db/migrations/0000_test_migration.sql");
    // simula o que `db:generate` + `db:migrate` deixam no cliente
    writeFileSync(
      journal,
      JSON.stringify({
        version: "7",
        dialect: "postgresql",
        entries: [{ idx: 0, version: "7", when: 1, tag: "0000_test_migration", breakpoints: true }],
      }),
    );
    writeFileSync(sqlFile, "CREATE TABLE content_entries();");

    scaffoldWorkspace(opts); // 2ª geração (--force) NÃO pode destruir o histórico

    expect(JSON.parse(readFileSync(journal, "utf8")).entries).toHaveLength(1);
    expect(existsSync(sqlFile)).toBe(true);
  });

  it("leaves the config import untouched for a DEFAULT export", async () => {
    const { config, configPath } = await loadClientConfig(baselineConfig);
    outDir = mkdtempSync(join(tmpdir(), "cms-scaffold-default-"));
    rmSync(outDir, { recursive: true, force: true });
    scaffoldWorkspace({
      config,
      configPath,
      configExportName: "default",
      repoRoot,
      outDir,
      templateDir,
      force: true,
    });
    expect(readFileSync(join(outDir, "lib/core-runtime.ts"), "utf8")).toContain(
      TEMPLATE_CONFIG_IMPORT,
    );
  });
});

describe("configImportLine", () => {
  it("mirrors the codegen rule (default vs named export)", () => {
    expect(configImportLine("default")).toBe(TEMPLATE_CONFIG_IMPORT);
    expect(configImportLine("acmeConfig")).toBe(
      'import { acmeConfig as clientConfig } from "@/client.config";',
    );
  });
});

// ── end-to-end: scaffold + codegen == gold-standard generated artifacts ───────
describe("create-client (--skip-provision) reproduces the baseline artifacts", () => {
  let outDir: string;
  afterEach(() => {
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  it.skipIf(!hasGold)("scaffold + codegen match clients/demo-corp generated files", async () => {
    const { config, configPath, exportName } =
      await loadClientConfig(baselineConfig);
    outDir = join(mkdtempSync(join(tmpdir(), "cms-e2e-")), "demo-corp-gen");
    scaffoldWorkspace({
      config,
      configPath,
      repoRoot,
      outDir,
      templateDir,
      force: true,
    });
    process.env.CMS_FORCE_ENV = "1";
    runCodegen(config, outDir, { configExportName: exportName });
    for (const rel of GENERATED) {
      const gen = readFileSync(join(outDir, rel), "utf8");
      const gold = readFileSync(join(goldDir, rel), "utf8");
      expect(gen, `generated artifact should match gold: ${rel}`).toBe(gold);
    }
  });

  it("run() create-client (provision) --dry-run runs end-to-end without tokens", async () => {
    // Fase 4: sem --skip-provision, o --dry-run planeja scaffold + provision +
    // deploy ponta a ponta em plan-only — zero chamadas, sem tokens.
    const code = await run(
      ["create-client", "--config", baselineConfig, "--dry-run"],
      { cwd: repoRoot },
    );
    expect(code).toBe(0);
  });

  it("run() create-client --dry-run does not touch the filesystem", async () => {
    const code = await run(
      ["create-client", "--config", baselineConfig, "--skip-provision", "--dry-run"],
      { cwd: repoRoot },
    );
    expect(code).toBe(0);
  });

  it("run() create-client wires scaffold→codegen→db:generate (spawn stubbed)", async () => {
    outDir = join(mkdtempSync(join(tmpdir(), "cms-run-")), "demo-corp-gen");
    const calls: string[][] = [];
    const code = await run(
      [
        "create-client",
        "--config",
        baselineConfig,
        "--skip-provision",
        "--out",
        outDir,
        "--force",
      ],
      {
        cwd: repoRoot,
        runCommand: (cmd, args) => {
          calls.push([cmd, ...args]);
          return 0; // stub pnpm install / db:generate as success
        },
      },
    );
    expect(code).toBe(0);
    // scaffold happened
    expect(existsSync(join(outDir, "client.config.ts"))).toBe(true);
    // codegen happened → o artefato existe sempre; a comparação contra o gold
    // só roda onde o CMS-modelo está presente (ver `hasGold`).
    const gen = readFileSync(join(outDir, "db/schema/enums.generated.ts"), "utf8");
    expect(gen).toContain("contentTypeEnum");
    if (hasGold) {
      const gold = readFileSync(join(goldDir, "db/schema/enums.generated.ts"), "utf8");
      expect(gen).toBe(gold);
    }
    // orchestration invoked pnpm install then db:generate
    expect(calls[0][0]).toBe("pnpm");
    expect(calls.some((c) => c.includes("install"))).toBe(true);
    expect(calls.some((c) => c.includes("db:generate"))).toBe(true);
  });
});

// Guard: keep a stable ref to imports that some environments tree-shake.
beforeEach(() => {
  expect(typeof mkdirSync).toBe("function");
  expect(typeof cpSync).toBe("function");
});
