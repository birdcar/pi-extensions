import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { validateDocs } from "../../scripts/check-docs.ts";

describe("documentation validation", () => {
  test("accepts maintained documentation", () => {
    expect(validateDocs().errors).toEqual([]);
  });

  test("detects broken links", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-docs-link-"));
    cpSync(".", dir, {
      recursive: true,
      filter: (source) => !source.includes("node_modules") && !source.includes(".git"),
    });
    writeFileSync(join(dir, "README.md"), "[missing](docs/nope.md)\n");
    const result = validateDocs(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("missing link target");
  });

  test("detects invalid referenced TypeScript examples", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-docs-type-"));
    cpSync(".", dir, {
      recursive: true,
      filter: (source) => !source.includes("node_modules") && !source.includes(".git"),
    });
    mkdirSync(join(dir, "tests/fixtures/services"), { recursive: true });
    writeFileSync(join(dir, "tests/fixtures/services/consumer-a.ts"), "const value: string = 1;\n");
    const result = validateDocs(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("failed to compile");
  });
});
