import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { assertOnlyLockfileChanged } from "../../scripts/release.ts";

function run(args: string[], cwd: string): void {
  const result = Bun.spawnSync(args, { cwd, stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
}

describe("release lockfile refresh", () => {
  test("Bun lock refresh is frozen-installable and repeatable", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-lock-"));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "lock-fixture",
        private: true,
        packageManager: "bun@1.3.14",
        dependencies: { "is-number": "7.0.0" },
      }),
    );
    run(["bun", "install", "--lockfile-only", "--ignore-scripts"], dir);
    expect(existsSync(join(dir, "bun.lock"))).toBe(true);
    const first = readFileSync(join(dir, "bun.lock"), "utf8");
    run(["bun", "install", "--frozen-lockfile"], dir);
    run(["bun", "install", "--lockfile-only", "--ignore-scripts"], dir);
    expect(readFileSync(join(dir, "bun.lock"), "utf8")).toBe(first);
  });

  test("unexpected non-lockfile changes are rejected", () => {
    expect(assertOnlyLockfileChanged(["bun.lock"]).ok).toBe(true);
    const result = assertOnlyLockfileChanged(["bun.lock", "package.json"]);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(["unexpected release PR refresh change: package.json"]);
  });
});
