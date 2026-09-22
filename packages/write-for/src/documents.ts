import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { Worker } from "node:worker_threads";
import { createWriteForError } from "./errors.js";

export type DocumentKind = "pdf" | "docx";

export interface DocumentExtractionInput {
  path: string;
  signal?: AbortSignal;
  deadlineMs?: number;
  maxCharacters?: number;
}

export interface DocumentExtractionResult {
  text: string;
  warnings: string[];
  pages?: number;
}

export function documentKindForPath(path: string): DocumentKind | undefined {
  const ext = extname(path).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (ext === ".docx") return "docx";
  return undefined;
}

export async function extractDocumentText(
  input: DocumentExtractionInput,
): Promise<DocumentExtractionResult> {
  const kind = documentKindForPath(input.path);
  if (!kind)
    throw createWriteForError("SOURCE_INVALID", `unsupported document type: ${input.path}`);
  if (input.signal?.aborted)
    throw createWriteForError("SOURCE_INVALID", "document extraction cancelled");
  const bytes = await readFile(input.path);
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  return extractDocumentBytes({
    kind,
    bytes: owned,
    path: input.path,
    signal: input.signal,
    deadlineMs: input.deadlineMs,
    maxCharacters: input.maxCharacters,
  });
}

export interface DocumentByteExtractionInput {
  kind: DocumentKind;
  bytes: Uint8Array;
  path?: string;
  signal?: AbortSignal;
  deadlineMs?: number;
  maxCharacters?: number;
}

export async function extractDocumentBytes(
  input: DocumentByteExtractionInput,
): Promise<DocumentExtractionResult> {
  const deadlineMs = input.deadlineMs ?? 15_000;
  const maxCharacters = input.maxCharacters ?? 200_000;
  if (input.signal?.aborted)
    throw createWriteForError("SOURCE_INVALID", "document extraction cancelled");

  const worker = new Worker(new URL("./document-worker.js", import.meta.url), {
    workerData: {
      kind: input.kind,
      bytes: input.bytes,
      path: input.path,
      maxCharacters,
    },
    resourceLimits: { maxOldGenerationSizeMb: 256 },
    transferList: [input.bytes.buffer as ArrayBuffer],
  });

  return await new Promise<DocumentExtractionResult>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
      worker.removeAllListeners();
    };
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    const fail = (error: unknown) => {
      finish(() =>
        reject(
          error &&
            typeof error === "object" &&
            (error as { name?: unknown }).name === "WriteForError"
            ? error
            : createWriteForError(
                "SOURCE_INVALID",
                error instanceof Error ? error.message : String(error),
              ),
        ),
      );
    };
    const timer = setTimeout(() => {
      void worker.terminate();
      fail(
        createWriteForError(
          "SOURCE_INVALID",
          `document extraction timed out after ${deadlineMs}ms`,
        ),
      );
    }, deadlineMs);
    const onAbort = () => {
      void worker.terminate();
      fail(createWriteForError("SOURCE_INVALID", "document extraction cancelled"));
    };
    input.signal?.addEventListener("abort", onAbort, { once: true });
    worker.once("message", (message: unknown) => {
      const record = message as Record<string, unknown>;
      if (record.ok) {
        finish(() =>
          resolve({
            text: String(record.text ?? ""),
            warnings: Array.isArray(record.warnings)
              ? record.warnings.filter((value): value is string => typeof value === "string")
              : [],
            pages: typeof record.pages === "number" ? record.pages : undefined,
          }),
        );
      } else {
        fail(
          createWriteForError(
            "SOURCE_INVALID",
            String(record.error ?? "document extraction failed"),
          ),
        );
      }
    });
    worker.once("error", fail);
    worker.once("exit", (code) => {
      if (code !== 0)
        fail(createWriteForError("SOURCE_INVALID", `document worker exited with code ${code}`));
    });
  });
}
