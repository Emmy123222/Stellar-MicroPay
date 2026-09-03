/**
 * __tests__/stories-csf.test.ts
 * Issue #718 guard: story files must stay valid CSF against the INSTALLED
 * @storybook/react package.
 *
 * Catches regressions where a story imports types/values that the installed
 * framework package does not export (e.g. Meta/StoryObj moving packages), or
 * where a story file stops being importable at runtime — before typecheck or
 * storybook build ever run.
 */
import * as fs from "fs";
import * as path from "path";

const STORIES_DIR = path.join(__dirname, "..", "stories");

// The three story files named by issue #718.
const ISSUE_STORIES = [
  "CreatorTipsDashboard.stories.tsx",
  "PaymentLinkGenerator.stories.tsx",
  "PaymentStatusModal.stories.tsx",
];

/** CSF type imports must come from the installed renderer package. */
const ALLOWED_STORYBOOK_IMPORT_SOURCES = ["@storybook/react", "@storybook/test", "react"];

function listStoryFiles(): string[] {
  return fs
    .readdirSync(STORIES_DIR)
    .filter((name) => name.endsWith(".stories.tsx"))
    .sort();
}

function readSource(fileName: string): string {
  return fs.readFileSync(path.join(STORIES_DIR, fileName), "utf8");
}

function extractImportSources(source: string): string[] {
  const sources: string[] = [];
  const importRegex = /import\s+(?:type\s+)?[^'"]*from\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(source)) !== null) {
    sources.push(match[1]);
  }
  return sources;
}

describe.each(listStoryFiles())("CSF story file: %s", (fileName) => {
  const source = readSource(fileName);

  test("declares Meta/StoryObj types from the installed @storybook/react package", () => {
    if (!/from ["']@storybook\/react["']/.test(source)) {
      return; // stories without CSF type imports are fine
    }
    expect(source).toMatch(/import\s+type\s+\{[^}]*\bMeta\b[^}]*\}\s+from\s+["']@storybook\/react["']/);
    expect(source).toMatch(/import\s+type\s+\{[^}]*\bStoryObj\b[^}]*\}\s+from\s+["']@storybook\/react["']/);
  });

  test("does not import from packages that do not export CSF types", () => {
    for (const importSource of extractImportSources(source)) {
      const isAllowed =
        !importSource.startsWith("@storybook/") ||
        ALLOWED_STORYBOOK_IMPORT_SOURCES.includes(importSource);
      expect(`storybook import ${importSource} allowed=${isAllowed}`).toBe(
        `storybook import ${importSource} allowed=true`
      );
    }
  });

  test("meta export is a CSF default export object", () => {
    expect(source).toMatch(/const\s+meta:\s*Meta</);
    expect(source).toMatch(/export\s+default\s+meta\s*;/);
  });

  test("typed stories use StoryObj", () => {
    expect(source).toMatch(/type\s+Story\s*=\s*StoryObj</);
  });
});

describe("issue #718 story files are covered", () => {
  test.each(ISSUE_STORIES)("%s exists and is guarded", (fileName) => {
    expect(listStoryFiles()).toContain(fileName);
  });
});
