import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  globalIgnores([".next/**", "out/**", "playwright-report/**", "test-results/**"]),
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
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
