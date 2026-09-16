// Fixtures de config para os testes de provisionamento. Deriva do baseline
// gold-standard (demo-corp), trocando só o database.kind — o mesmo padrão
// do gen-env.test.ts (equivalência cross-provider).

import type { ClientConfig } from "@cms-core/core/config";
import { demoCorpConfig } from "../../../../templates/config-examples/demo-corp.config.js";

/** Config Supabase single-provider (baseline). */
export const supabaseConfig: ClientConfig = {
  ...demoCorpConfig,
  slug: "acme",
};

/** Config Neon 2-provedores (mesmo baseline, só troca database.kind). */
export const neonConfig: ClientConfig = {
  ...demoCorpConfig,
  slug: "acme",
  providers: {
    ...demoCorpConfig.providers,
    database: { kind: "neon", region: "aws-sa-east-1", plan: "free" },
  },
};

/** Tokens completos (para os testes de caminho feliz). */
export const fullTokens = {
  supabaseAccessToken: "sb-access-token",
  supabaseOrgId: "org-123",
  neonApiKey: "neon-key",
  neonOrgId: "neon-org",
  bunnyAccountApiKey: "bunny-key",
  resendApiKey: "resend-key",
  vercelToken: "vercel-token",
  vercelTeamId: "team-1",
};
