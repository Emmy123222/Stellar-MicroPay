import js from "@eslint/js";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  js.configs.recommended,
  tseslint.configs.base,
  {
    files: ["**/*.{js,jsx,ts,tsx,mjs}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest,
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
      ...reactHooks.configs.flat.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/no-unknown-property": "off",
      "react-hooks/set-state-in-effect": "off",
      "react/display-name": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-require-imports": "off",
      "no-control-regex": "off",
      "no-redeclare": "off",
      "no-unused-vars": "off",
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-undef": "off",
    },
  },
  {
    files: ["public/sw.js"],
    languageOptions: {
      globals: {
        clients: "readonly",
      },
    },
  },
  globalIgnores([".next/**", "out/**", "playwright-report/**", "test-results/**"]),
  {
    rules: {
      "import/no-anonymous-default-export": "off",
    },
  },
  {
    files: ["**/__tests__/**", "e2e/**"],
    rules: {
      "react/display-name": "off",
      "react-hooks/rules-of-hooks": "off",
    },
  },
]);
