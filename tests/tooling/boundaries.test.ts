import { rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const fixtureDir = join(process.cwd(), "packages", "boundary-fixture", "src");

function runEslint(source: string) {
  rmSync(join(process.cwd(), "packages", "boundary-fixture"), { recursive: true, force: true });
  mkdirSync(fixtureDir, { recursive: true });
  const file = join(fixtureDir, "index.ts");
  writeFileSync(file, source);
  const result = Bun.spawnSync({
    cmd: ["bun", "eslint", file, "--no-ignore"],
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    output: `${result.stdout.toString()}${result.stderr.toString()}`,
  };
}

function expectBunViolation(source: string, expected: string) {
  const result = runEslint(source);
  expect(result.exitCode).not.toBe(0);
  expect(result.output).toContain(expected);
}

describe("runtime boundary linting", () => {
  test("production package code may use Node built-ins", () => {
    try {
      const result = runEslint(
        'import { join } from "node:path";\nexport const value = join("a", "b");\n',
      );
      expect(result.output).toBe("");
      expect(result.exitCode).toBe(0);
    } finally {
      rmSync(join(process.cwd(), "packages", "boundary-fixture"), { recursive: true, force: true });
    }
  });

  test("production package code rejects the Bun global", () => {
    try {
      expectBunViolation(
        'export const value = Bun.file("x");\n',
        "Production packages must not use the Bun global",
      );
    } finally {
      rmSync(join(process.cwd(), "packages", "boundary-fixture"), { recursive: true, force: true });
    }
  });

  test("production package code rejects Bun module imports", () => {
    try {
      expectBunViolation(
        'import sqlite from "bun:sqlite";\nexport { sqlite };\n',
        "Production packages must not import or re-export Bun modules",
      );
    } finally {
      rmSync(join(process.cwd(), "packages", "boundary-fixture"), { recursive: true, force: true });
    }
  });

  test("production package code rejects Bun module re-exports", () => {
    try {
      expectBunViolation(
        'export { Database } from "bun:sqlite";\n',
        "Production packages must not import or re-export Bun modules",
      );
    } finally {
      rmSync(join(process.cwd(), "packages", "boundary-fixture"), { recursive: true, force: true });
    }
  });

  test("production package code rejects dynamic Bun imports", () => {
    try {
      expectBunViolation(
        'export const value = import("bun:sqlite");\n',
        "Production packages must not import or re-export Bun modules",
      );
    } finally {
      rmSync(join(process.cwd(), "packages", "boundary-fixture"), { recursive: true, force: true });
    }
  });

  test("tooling tests may use bun:test", () => {
    const result = Bun.spawnSync({
      cmd: ["bun", "eslint", "tests/tooling/boundaries.test.ts", "--no-ignore"],
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = `${result.stdout.toString()}${result.stderr.toString()}`;
    expect(output).not.toContain("Production packages must not import or re-export Bun modules");
    expect(result.exitCode).toBe(0);
  });
});
