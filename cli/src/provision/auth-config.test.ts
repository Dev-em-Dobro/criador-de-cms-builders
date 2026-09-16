// Config de Auth do Supabase no provisionamento — templates e endurecimento.
//
// O teste central é o do `token_hash`: com `{{ .ConfirmationURL }}` o convite e
// a recuperação de senha CHEGAM e não funcionam (o link volta para o login,
// porque a sessão vem no fragmento da URL, que o servidor nunca vê). É um
// defeito silencioso — e-mail entregue, fluxo quebrado — então fica travado
// aqui em vez de depender de alguém clicar num link para descobrir.

import { describe, it, expect } from "vitest";
import type { ClientConfig } from "@cms-core/core/config";
import { FakeHttpClient } from "./http.js";
import { SecretVault } from "./secrets.js";
import { createLogger } from "./logger.js";
import { createSupabaseAdapter } from "./supabase.js";
import { adminOrigin, buildAuthHardening, buildAuthEmailTemplates } from "./auth-config.js";
import type { ProvisionCtx } from "./types.js";
import { supabaseConfig, fullTokens } from "./__fixtures__/configs.js";
import { supabaseHandler } from "./__fixtures__/fake-providers.js";

function mkCtx(overrides: Partial<ProvisionCtx> = {}): ProvisionCtx {
  const vault = new SecretVault();
  return {
    config: supabaseConfig,
    http: new FakeHttpClient([supabaseHandler()]),
    tokens: fullTokens,
    vault,
    state: { slug: "acme", databaseKind: "supabase", resources: {} },
    env: {},
    dryRun: false,
    log: createLogger(vault, { toConsole: false }),
    maxPolls: 3,
    pollIntervalMs: 0,
    ...overrides,
  };
}

/** Só os PATCH de config/auth, na ordem em que saíram. */
function authPatches(http: FakeHttpClient): Array<Record<string, unknown>> {
  return http.calls
    .filter((c) => c.method === "PATCH" && c.url.includes("/config/auth"))
    .map((c) => c.body as Record<string, unknown>);
}

describe("templates de e-mail", () => {
  it("usa token_hash na QUERY — nunca ConfirmationURL", () => {
    const t = buildAuthEmailTemplates(supabaseConfig);
    for (const chave of [
      "mailer_templates_recovery_content",
      "mailer_templates_invite_content",
    ]) {
      const html = String(t[chave]);
      expect(html).toContain("token_hash={{ .TokenHash }}");
      // A regressão que este teste existe para impedir.
      expect(html).not.toContain("ConfirmationURL");
    }
  });

  it("aponta para a rota /auth/confirm com o tipo certo em cada e-mail", () => {
    const t = buildAuthEmailTemplates(supabaseConfig);
    expect(String(t.mailer_templates_recovery_content)).toContain(
      "{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=recovery",
    );
    expect(String(t.mailer_templates_invite_content)).toContain(
      "{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=invite",
    );
  });

  it("segue o idioma do config, e o padrão é inglês (a fábrica não é pt-only)", () => {
    // baseline tem locales.default = "pt-BR"
    const pt = buildAuthEmailTemplates(supabaseConfig);
    expect(String(pt.mailer_subjects_recovery)).toContain("Redefinir");

    const en: ClientConfig = {
      ...supabaseConfig,
      locales: { ...supabaseConfig.locales, default: "en" },
    };
    expect(String(buildAuthEmailTemplates(en).mailer_subjects_recovery)).toContain("Reset");
  });

  it("usa o adminTitle do cliente e escapa HTML", () => {
    const cfg: ClientConfig = {
      ...supabaseConfig,
      branding: { ...supabaseConfig.branding, adminTitle: 'Bar & "Cia"' },
    };
    const html = String(buildAuthEmailTemplates(cfg).mailer_templates_invite_content);
    expect(html).toContain("Bar &amp; &quot;Cia&quot;");
    expect(html).not.toContain('& "Cia"');
  });
});

describe("endurecimento de auth", () => {
  it("corrige o site_url (default de projeto novo é localhost) e libera o domínio do admin", () => {
    const h = buildAuthHardening(supabaseConfig);
    expect(h.site_url).toBe("https://cms.example.com");
    expect(h.uri_allow_list).toBe("https://cms.example.com/**");
    expect(adminOrigin(supabaseConfig)).toBe("https://cms.example.com");
  });

  it("fecha o cadastro público e exige senha de 12", () => {
    const h = buildAuthHardening(supabaseConfig);
    expect(h.disable_signup).toBe(true);
    expect(h.password_min_length).toBe(12);
    expect(String(h.password_required_characters)).toContain("0123456789");
  });

  it("aceita adminSubdomain com esquema, sem duplicar https", () => {
    const cfg: ClientConfig = {
      ...supabaseConfig,
      domains: { ...supabaseConfig.domains, adminSubdomain: "https://cms.acme.com/" },
    };
    expect(adminOrigin(cfg)).toBe("https://cms.acme.com");
  });
});

describe("adapter Supabase — ordem e alcance dos PATCH", () => {
  it("grava os templates DEPOIS do SMTP (no Free, antes disso a API recusa)", async () => {
    const http = new FakeHttpClient([supabaseHandler()]);
    await createSupabaseAdapter("content-and-auth").ensure(mkCtx({ http }));

    const patches = authPatches(http);
    const iSmtp = patches.findIndex((b) => "smtp_host" in b);
    const iTpl = patches.findIndex((b) => "mailer_templates_invite_content" in b);
    expect(iSmtp).toBeGreaterThanOrEqual(0);
    expect(iTpl).toBeGreaterThan(iSmtp);
  });

  it("endurece a auth mesmo sem chave do Resend", async () => {
    const http = new FakeHttpClient([supabaseHandler()]);
    const ctx = mkCtx({ http, tokens: { ...fullTokens, resendApiKey: undefined } });
    await createSupabaseAdapter("content-and-auth").ensure(ctx);

    const patches = authPatches(http);
    expect(patches.some((b) => b.disable_signup === true)).toBe(true);
    // ...mas sem SMTP não há template: a API recusaria.
    expect(patches.some((b) => "mailer_templates_invite_content" in b)).toBe(false);
  });

  it("manda do domínio verificado no Resend, não do e-mail do seed admin", async () => {
    const http = new FakeHttpClient([supabaseHandler()]);
    await createSupabaseAdapter("content-and-auth").ensure(mkCtx({ http }));

    const smtp = authPatches(http).find((b) => "smtp_host" in b)!;
    expect(smtp.smtp_admin_email).toBe("noreply@example.com");
    expect(smtp.smtp_admin_email).not.toBe(supabaseConfig.seedAdmin.email);
    // o default do provedor embutido (2/hora no projeto) derruba o 3º reset.
    expect(smtp.rate_limit_email_sent).toBe(30);
  });
});
