import { readFile } from "node:fs/promises";
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { extractDocumentBytes, extractDocumentText } from "../dist/documents.js";

const fixtures = join(import.meta.dir, "fixtures");

describe("write-for native document extraction", () => {
  test("extracts real text PDF pages", async () => {
    const result = await extractDocumentText({ path: join(fixtures, "voice.pdf") });
    expect(result.text).toContain("Warm practical prose on page one.");
    expect(result.text).toContain("Page 2");
    expect(result.pages).toBe(2);
  });

  test("extracts DOCX split runs", async () => {
    const result = await extractDocumentText({ path: join(fixtures, "voice.docx") });
    expect(result.text).toContain("Split runs make one sentence.");
    expect(result.text).toContain("concrete next steps");
  });

  test("reports textless and encrypted documents", async () => {
    await expect(
      extractDocumentText({ path: join(fixtures, "textless.pdf") }),
    ).rejects.toHaveProperty("code", "SOURCE_INVALID");
    await expect(extractDocumentText({ path: join(fixtures, "encrypted.pdf") })).rejects.toThrow(
      "encrypted",
    );
  });

  test("cancels an in-flight emitted worker extraction promptly", async () => {
    const controller = new AbortController();
    const bytes = new Uint8Array(await readFile(join(fixtures, "voice.pdf")));
    const extraction = extractDocumentBytes({
      kind: "pdf",
      path: join(fixtures, "voice.pdf"),
      bytes,
      signal: controller.signal,
    });
    queueMicrotask(() => controller.abort());
    await expect(extraction).rejects.toHaveProperty("code", "SOURCE_INVALID");
    await expect(extraction).rejects.toThrow("cancelled");
  });

  test("reports emitted worker deadline and parser-failure diagnostics", async () => {
    await expect(
      extractDocumentText({ path: join(fixtures, "voice.pdf"), deadlineMs: 1 }),
    ).rejects.toThrow("timed out");
    await expect(
      extractDocumentBytes({
        kind: "docx",
        path: "corrupt.docx",
        bytes: new TextEncoder().encode("not a zip archive"),
      }),
    ).rejects.toHaveProperty("code", "SOURCE_INVALID");
  });
});
