import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  explainInvalidWritingRequest,
  isWriteForError,
  validateDraftRequest,
  validateRewriteRequest,
  writeForContract,
  WRITE_FOR_API_MAJOR,
  WRITE_FOR_SERVICE_ID,
} from "../src/contract.ts";
import { createWriteForError } from "../src/errors.ts";

describe("write-for contract", () => {
  test("contract subpath does not initialize extension runtime", async () => {
    const contract = await import("../src/contract.ts");
    expect(contract.WRITE_FOR_SERVICE_ID).toBe("birdcar.write-for");
    expect("default" in contract).toBe(false);
  });

  test("service descriptor uses stable identity and own callable data properties", () => {
    expect(writeForContract.id).toBe(WRITE_FOR_SERVICE_ID);
    expect(writeForContract.apiMajor).toBe(WRITE_FOR_API_MAJOR);
    expect(writeForContract.isApi({ draft() {}, rewrite() {} })).toBe(true);
    const inherited = Object.create({ draft() {}, rewrite() {} });
    expect(writeForContract.isApi(inherited)).toBe(false);
    let invoked = false;
    const accessor = {
      get draft() {
        invoked = true;
        return () => undefined;
      },
      rewrite() {},
    };
    expect(writeForContract.isApi(accessor)).toBe(false);
    expect(invoked).toBe(false);
  });

  test("writer errors are structural across copies", () => {
    const error = createWriteForError("MODEL_AUTH", "missing credential");
    expect(isWriteForError(error)).toBe(true);
    expect(isWriteForError({ name: "WriteForError", code: "MODEL_AUTH", message: "x" })).toBe(true);
    expect(isWriteForError({ name: "WriteForError", code: "BOGUS", message: "x" })).toBe(false);
  });

  test("request validators reject execution fields", () => {
    expect(
      validateDraftRequest({ channel: "email", subject: "Hello", rules: ["keep it short"] }),
    ).toBe(true);
    expect(
      validateRewriteRequest({ channel: "slack", text: "Hello", instruction: "shorter" }),
    ).toBe(true);
    expect(validateDraftRequest({ channel: "email", subject: "Hello", model: "x/y" })).toBe(false);
    expect(
      explainInvalidWritingRequest({ channel: "email", subject: "Hello", provider: "x" }, "draft"),
    ).toContain("execution field provider");
    expect(
      validateRewriteRequest({ channel: "email", text: "Hello", rules: ["model: text only"] }),
    ).toBe(true);
  });

  test("independent public consumer fixtures type-check without importing index", () => {
    const temp = mkdtempSync(join(tmpdir(), "write-for-contract-"));
    writeFileSync(
      join(temp, "tsconfig.json"),
      JSON.stringify({
        extends: join(import.meta.dir, "../../../tsconfig.json"),
        compilerOptions: {
          noEmit: true,
          module: "NodeNext",
          moduleResolution: "NodeNext",
          allowImportingTsExtensions: true,
          customConditions: ["import"],
          typeRoots: [join(import.meta.dir, "../../../node_modules/@types")],
          paths: {
            "@birdcar/pi-write-for/contract": [join(import.meta.dir, "../src/contract.ts")],
            "@birdcar/pi-services": [join(import.meta.dir, "../../services/src/index.ts")],
          },
        },
        include: [
          join(import.meta.dir, "../../../tests/fixtures/write-for/consumer-a.ts"),
          join(import.meta.dir, "../../../tests/fixtures/write-for/consumer-b.ts"),
        ],
      }),
    );
    const result = Bun.spawnSync([
      join(import.meta.dir, "../../../node_modules/.bin/tsc"),
      "-p",
      join(temp, "tsconfig.json"),
    ]);
    expect(result.exitCode, `${result.stdout.toString()}${result.stderr.toString()}`).toBe(0);
  });
});
