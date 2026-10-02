import type { Config } from "jest";

const config: Config = {
  testEnvironment: "jsdom",
  transform: { "^.+\\.tsx?$": ["ts-jest", { tsconfig: { jsx: "react-jsx" } }] },
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/$1" },
  // Web Crypto (SubtleCrypto) is absent under jsdom; the request-signing
  // helpers in lib/requestSignature.ts need it to compute HMAC signatures.
  setupFiles: ["<rootDir>/jest.polyfills.ts"],
  setupFilesAfterEnv: ["@testing-library/jest-dom"],
  testPathIgnorePatterns: ["<rootDir>/e2e/"],
};

export default config;
