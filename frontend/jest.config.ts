import type { Config } from "jest";

const config: Config = {
  testEnvironment: "jsdom",
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: { jsx: "react-jsx" } }],
    "^.+\\.m?js$": [
      "ts-jest",
      {
        tsconfig: {
          allowJs: true,
          module: "commonjs",
          moduleResolution: "node",
          esModuleInterop: true,
          target: "ES2020",
          resolveJsonModule: true,
        },
        diagnostics: false,
        isolatedModules: true,
      },
    ],
  },
  transformIgnorePatterns: [
    "/node_modules/(?!(@stellar|@exodus|uint8array-extras|@noble|@scure)/)",
  ],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
    "^uint8array-extras$": "<rootDir>/__mocks__/uint8array-extras.js",
  },
  setupFilesAfterEnv: ["@testing-library/jest-dom"],
  setupFiles: ["<rootDir>/jest.polyfills.js"],
  testPathIgnorePatterns: ["<rootDir>/e2e/"],
  coverageThreshold: {
    global: {
      statements: 80,
      branches: 75,
      lines: 80,
      functions: 80,
    },
  },
};

export default config;
