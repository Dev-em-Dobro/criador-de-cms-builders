import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

/**
 * ESLint 9 flat config. `next lint` was removed in Next.js 16 — the `lint`
 * script calls the ESLint CLI directly against this file, and
 * eslint-config-next 16 ships flat-config presets natively.
 */
const config = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "db/migrations/**",
      "next-env.d.ts",
    ],
  },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      /**
       * The admin UI predates react-hooks v7's strict rule and leans on the
       * fetch-on-mount `useEffect(load, [])` idiom throughout. Surfaced as
       * warnings so new code gets flagged in review without failing the build;
       * tightening back to "error" means refactoring those components first.
       */
      "react-hooks/set-state-in-effect": "warn",
    },
  },
];

export default config;
