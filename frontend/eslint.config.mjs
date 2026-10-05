import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.serviceworker,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      react,
      "react-hooks": reactHooks,
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs["jsx-runtime"].rules,
      ...reactHooks.configs.recommended.rules,
      "react/prop-types": "off",
      "react/no-unknown-property": "off",
      "react-hooks/set-state-in-effect": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  globalIgnores([".next/**", "out/**", "playwright-report/**", "test-results/**"]),
  {
    files: ["**/__tests__/**", "e2e/**"],
    rules: {
      "react/display-name": "off",
      "react-hooks/rules-of-hooks": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: ["lib/stellar.ts"],
    rules: {
      "no-control-regex": "off",
    },
  },
]);
