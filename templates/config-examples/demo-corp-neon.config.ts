// templates/config-examples/demo-corp-neon.config.ts
//
// Variante NEON do baseline gold-standard (S5.5, D5). É EXATAMENTE o
// `demoCorpConfig` de `demo-corp.config.ts`, trocando SÓ
// `providers.database` de Supabase para Neon — a auth continua no Supabase
// (projeto auth-only separado, §13). Prova o teste de equivalência cross-provider:
// o mesmo config, mudando só `database.kind`, gera runtime IDÊNTICO exceto:
//   (a) `.env.local` — as connection strings (DATABASE_URL/DIRECT_URL) por provider;
//   (b) `db/schema/profiles.generated.ts` — a FK `profiles_id_auth_users_fk` é
//       OMITIDA no caso Neon (§13.4).
// Nenhum outro `*.ts/*.css` gerado muda.
//
// Reusa a baseline por spread (ADR — sem duplicar as 9 coleções): a fonte única
// da verdade continua sendo `demo-corp.config.ts`. Só o campo `database` do
// provider é sobrescrito. A região Neon usa o formato da Neon API
// (`aws-sa-east-1`), distinto do formato Supabase (`sa-east-1`).

import type { ClientConfig } from "@cms-core/core/config";
import { demoCorpConfig } from "./demo-corp.config.js";

export const demoCorpNeonConfig: ClientConfig = {
  ...demoCorpConfig,
  providers: {
    ...demoCorpConfig.providers,
    // ÚNICA diferença vs o baseline: conteúdo no Neon (D5). A auth permanece no
    // Supabase (projeto auth-only; auth.region é independente no caso Neon).
    database: { kind: "neon", region: "aws-sa-east-1", plan: "free", branch: "main" },
  },
};

export default demoCorpNeonConfig;
