import { constants, existsSync } from "node:fs";
import { access, lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import { TextDecoder } from "node:util";
import { extractDocumentText } from "./documents.js";
import { createWriteForError, isWriteForError } from "./errors.js";

export const SOURCE_LIMITS = {
  maxFiles: 50,
  maxFileBytes: 20 * 1024 * 1024,
  maxTotalBytes: 50 * 1024 * 1024,
  maxCharacters: 200_000,
} as const;

const supportedTextExtensions = new Set([".txt", ".md", ".markdown"]);
const excludedNames = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
]);

export interface SourceCandidate {
  path: string;
  relativePath: string;
  kind: "text" | "pdf" | "docx";
  bytes: number;
}

export interface SourcePlan {
  root: string;
  candidates: SourceCandidate[];
  excluded: Array<{ path: string; reason: string }>;
  totalBytes: number;
}

export interface AdmittedSample {
  id: string;
  source: string;
  author?: string;
  register?: string;
  text: string;
  warnings: string[];
}

export interface SourceIngestionResult {
  samples: AdmittedSample[];
  diagnostics: Array<{ path: string; severity: "warning" | "error"; message: string }>;
}

function isContained(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!!rel && !rel.startsWith("..") && !resolve(rel).startsWith(resolve(root)));
}

function ensureLimit(condition: boolean, message: string): void {
  if (!condition) throw createWriteForError("SOURCE_LIMIT", message);
}

function kindForPath(path: string): SourceCandidate["kind"] | undefined {
  const ext = extname(path).toLowerCase();
  if (supportedTextExtensions.has(ext)) return "text";
  if (ext === ".pdf") return "pdf";
  if (ext === ".docx") return "docx";
  return undefined;
}

function shouldSkipDirectory(name: string): string | undefined {
  if (excludedNames.has(name)) return "excluded directory";
  if (name.startsWith(".")) return "hidden directory";
  return undefined;
}

function shouldSkipFile(name: string): string | undefined {
  if (name.startsWith(".")) return "hidden file";
  if (!kindForPath(name)) return "unsupported file type";
  return undefined;
}

export async function planSourceFolder(folder: string): Promise<SourcePlan> {
  const root = await realpath(resolve(folder)).catch(() => {
    throw createWriteForError("SOURCE_INVALID", `source folder does not exist: ${folder}`);
  });
  const rootStat = await stat(root);
  if (!rootStat.isDirectory())
    throw createWriteForError("SOURCE_INVALID", `not a directory: ${folder}`);
  await access(root, constants.R_OK).catch(() => {
    throw createWriteForError("SOURCE_INVALID", `source folder is not readable: ${folder}`);
  });

  const candidates: SourceCandidate[] = [];
  const excluded: SourcePlan["excluded"] = [];
  let totalBytes = 0;

  async function walk(dir: string): Promise<void> {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      const full = join(dir, entry.name);
      const rel = relative(root, full);
      if (entry.isDirectory()) {
        const reason = shouldSkipDirectory(entry.name);
        if (reason) {
          excluded.push({ path: rel, reason });
          continue;
        }
        await walk(full);
        continue;
      }
      if (entry.isSymbolicLink()) {
        const linkReal = await realpath(full).catch(() => undefined);
        if (!linkReal || !isContained(root, linkReal)) {
          excluded.push({ path: rel, reason: "symlink escapes selected root" });
          continue;
        }
        const linked = await lstat(linkReal).catch(() => undefined);
        if (!linked?.isFile()) {
          excluded.push({ path: rel, reason: "symlink target is not a file" });
          continue;
        }
      } else if (!entry.isFile()) {
        excluded.push({ path: rel, reason: "not a regular file" });
        continue;
      }
      const reason = shouldSkipFile(entry.name);
      if (reason) {
        excluded.push({ path: rel, reason });
        continue;
      }
      const fileStat = await stat(full);
      if (fileStat.size > SOURCE_LIMITS.maxFileBytes) {
        excluded.push({ path: rel, reason: "file exceeds per-file byte limit" });
        continue;
      }
      const kind = kindForPath(entry.name);
      if (!kind) continue;
      candidates.push({ path: full, relativePath: rel, kind, bytes: fileStat.size });
      totalBytes += fileStat.size;
    }
  }

  await walk(root);
  ensureLimit(
    candidates.length <= SOURCE_LIMITS.maxFiles,
    `too many source files (${candidates.length} > ${SOURCE_LIMITS.maxFiles})`,
  );
  ensureLimit(
    totalBytes <= SOURCE_LIMITS.maxTotalBytes,
    `source bytes exceed limit (${totalBytes} > ${SOURCE_LIMITS.maxTotalBytes})`,
  );
  return { root, candidates, excluded, totalBytes };
}

export function makeSampleId(prefix = "sample"): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function strictDecodeUtf8(bytes: Uint8Array, path: string): string {
  if (bytes.includes(0))
    throw createWriteForError("SOURCE_INVALID", `${path} appears to be binary`);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    throw createWriteForError("SOURCE_INVALID", `${path} is not valid UTF-8`);
  }
}

async function readCandidate(
  candidate: SourceCandidate,
  signal?: AbortSignal,
): Promise<{ text: string; warnings: string[] }> {
  if (signal?.aborted) throw createWriteForError("SOURCE_INVALID", "source ingestion cancelled");
  if (candidate.kind === "text") {
    const text = strictDecodeUtf8(await readFile(candidate.path), candidate.relativePath).trim();
    if (!text) throw createWriteForError("SOURCE_INVALID", `${candidate.relativePath} is empty`);
    return { text, warnings: [] };
  }
  const result = await extractDocumentText({
    path: candidate.path,
    signal,
    maxCharacters: SOURCE_LIMITS.maxCharacters,
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("exceeds extracted character limit")) {
      throw createWriteForError("SOURCE_LIMIT", message);
    }
    throw error;
  });
  return { text: result.text, warnings: result.warnings };
}

export async function ingestSourcePlan(
  plan: SourcePlan,
  options: { author?: string; register?: string; signal?: AbortSignal } = {},
): Promise<SourceIngestionResult> {
  const samples: AdmittedSample[] = [];
  const diagnostics: SourceIngestionResult["diagnostics"] = [];
  let characters = 0;
  for (const candidate of plan.candidates) {
    try {
      const { text, warnings } = await readCandidate(candidate, options.signal);
      characters += text.length;
      ensureLimit(
        characters <= SOURCE_LIMITS.maxCharacters,
        `extracted text exceeds character limit (${characters} > ${SOURCE_LIMITS.maxCharacters})`,
      );
      samples.push({
        id: makeSampleId(),
        source: candidate.relativePath,
        author: options.author,
        register: options.register,
        text,
        warnings,
      });
      for (const warning of warnings)
        diagnostics.push({ path: candidate.relativePath, severity: "warning", message: warning });
    } catch (error) {
      if (isWriteForError(error) && error.code === "SOURCE_LIMIT") throw error;
      diagnostics.push({
        path: candidate.relativePath,
        severity: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (samples.length === 0) throw createWriteForError("SOURCE_INVALID", "no usable source samples");
  return { samples, diagnostics };
}

export function describeSourcePlan(plan: SourcePlan): string {
  const counts = new Map<string, number>();
  for (const candidate of plan.candidates)
    counts.set(candidate.kind, (counts.get(candidate.kind) ?? 0) + 1);
  const countText = [...counts].map(([kind, count]) => `${count} ${kind}`).join(", ") || "0 files";
  return `${basename(plan.root)}: ${plan.candidates.length} candidate files (${countText}), ${plan.excluded.length} excluded`;
}

export function assertSourceExists(path: string): void {
  if (!existsSync(path))
    throw createWriteForError("SOURCE_INVALID", `source does not exist: ${path}`);
}
