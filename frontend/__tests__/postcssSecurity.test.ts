/**
 * postcssSecurity.test.ts
 * Issue #813 – regression coverage for the PostCSS source-map advisories.
 *
 * PostCSS < 8.5.26 could consume an arbitrary sourceMappingURL comment from
 * untrusted CSS input and disclose/emit it through generated source maps
 * (style-output XSS and source-map file disclosure). These tests pin the
 * patched dependency range and verify that a hostile sourceMappingURL is
 * never carried into the generated map or output.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";

const input = `.card { display: flex; }\n/*# sourceMappingURL=https://evil.example/steal.css.map */\n`;

const plugins = [tailwindcss, autoprefixer];

describe("PostCSS source-map disclosure guard (issue #813)", () => {
  it("never carries an arbitrary sourceMappingURL into an inline map", async () => {
    // A hostile external mapping reference (local path form used by the
    // advisory: old PostCSS would read that file into the generated map).
    const hostileInput = `.card { display: flex; }\n/*# sourceMappingURL=/definitely/not/a/real/file/leak.css.map */\n`;

    const result = await postcss(plugins).process(hostileInput, {
      from: "input.css",
      map: { inline: true },
    });

    const inlineMap = /sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/=]+)/.exec(
      result.css,
    );
    expect(inlineMap).not.toBeNull();

    const decodedMap = JSON.parse(
      Buffer.from(inlineMap![1], "base64").toString("utf8"),
    ) as {
      sources?: string[];
    };
    // The generated map must reference only the processed input — the
    // hostile mapping must never be consumed as an external source.
    expect(decodedMap.sources).toEqual(["input.css"]);
    expect(JSON.stringify(decodedMap.sources)).not.toContain("leak.css.map");
  });

  it("produces no external map when none is requested", async () => {
    const result = await postcss(plugins).process(input, { from: "input.css" });
    expect(result.map).toBeUndefined();
  });

  it("pins the patched PostCSS and Autoprefixer ranges", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(__dirname, "../package.json"), "utf8"),
    ) as {
      devDependencies: Record<string, string>;
    };
    expect(packageJson.devDependencies.postcss).toBe("^8.5.26");
    expect(packageJson.devDependencies.autoprefixer).toBe("^10.5.4");
  });

  it("runs a patched PostCSS version at runtime", () => {
    const postcssPackageJson = JSON.parse(
      readFileSync(
        path.join(__dirname, "../node_modules/postcss/package.json"),
        "utf8",
      ),
    ) as { version: string };
    const [major, minor, patch] = postcssPackageJson.version
      .split(".")
      .map((part) => Number.parseInt(part, 10));
    expect(major).toBe(8);
    expect(minor).toBeGreaterThanOrEqual(5);
    if (minor === 5) {
      expect(patch).toBeGreaterThanOrEqual(26);
    }
  });
});
