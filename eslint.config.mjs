import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Invisible characters (BOM, NBSP, zero-width spaces) are test data in
      // this app; in source they must be written as escapes, so readers see them.
      "no-irregular-whitespace": [
        "error",
        { skipStrings: false, skipTemplates: false, skipRegExps: false },
      ],
    },
  },
  {
    // lib/extract runs in a Web Worker and under Vitest's Node environment
    // (PRD §3), so it must not touch React, Next.js or the DOM.
    files: ["lib/extract/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["react", "react-dom", "react/*", "react-dom/*"],
              message: "lib/extract is pure TypeScript.",
            },
            {
              group: ["next", "next/*"],
              message: "lib/extract is pure TypeScript.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        ...["window", "document", "navigator", "localStorage", "indexedDB"].map(
          (name) => ({
            name,
            message: "lib/extract must run in a worker and in Node.",
          }),
        ),
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
