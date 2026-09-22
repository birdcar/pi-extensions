import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { SOURCE_LIMITS, ingestSourcePlan, planSourceFolder } from "../dist/sources.js";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "write-for-sources-"));
}

describe("write-for source ingestion", () => {
  test("plans deterministic supported files and excludes hidden/build/symlink escapes", async () => {
    const root = temp();
    writeFileSync(join(root, "b.md"), "B");
    writeFileSync(join(root, "a.txt"), "A");
    mkdirSync(join(root, ".git"));
    writeFileSync(join(root, ".git", "secret.txt"), "no");
    mkdirSync(join(root, "dist"));
    writeFileSync(join(root, "dist", "out.txt"), "no");
    const outside = join(temp(), "outside.txt");
    writeFileSync(outside, "outside");
    symlinkSync(outside, join(root, "escape.txt"));

    const plan = await planSourceFolder(root);
    expect(plan.candidates.map((candidate) => candidate.relativePath)).toEqual(["a.txt", "b.md"]);
    expect(plan.excluded.map((item) => item.reason)).toContain("excluded directory");
    expect(plan.excluded.map((item) => item.reason)).toContain("symlink escapes selected root");
  });

  test("rejects invalid UTF-8 and admits usable samples with metadata", async () => {
    const root = temp();
    writeFileSync(join(root, "voice.txt"), "clear author sample");
    writeFileSync(join(root, "bad.txt"), Buffer.from([0xff, 0xfe]));
    const plan = await planSourceFolder(root);
    const result = await ingestSourcePlan(plan, { author: "user", register: "pro" });
    expect(result.samples).toHaveLength(1);
    expect(result.samples[0]).toMatchObject({
      source: "voice.txt",
      author: "user",
      register: "pro",
    });
    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
  });

  test("exceeding corpus characters rejects the whole admission attempt", async () => {
    const root = temp();
    writeFileSync(join(root, "a.txt"), "a".repeat(120_000));
    writeFileSync(join(root, "b.txt"), "b".repeat(SOURCE_LIMITS.maxCharacters - 100_000));
    const plan = await planSourceFolder(root);
    await expect(ingestSourcePlan(plan)).rejects.toHaveProperty("code", "SOURCE_LIMIT");
  });
});
