import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { defaultConfigRoot } from "./config.js";
import { createWriteForError } from "./errors.js";
import { stripFrontmatterFromGeneratedBody } from "./training-prompts.js";

export type TrainingTargetKind = "style" | "register" | "channel";

export interface TrainingTarget {
  kind: TrainingTargetKind;
  name: string;
  root: string;
}

export interface ProfileSnapshot {
  target: TrainingTarget;
  path: string;
  existed: boolean;
  bytes?: string;
  hash?: string;
  frontmatter?: string;
  body: string;
}

export interface ProfileProposal {
  id: string;
  snapshots: ProfileSnapshot[];
  bodies: Record<string, string>;
  warnings: string[];
  details?: unknown;
}

export interface SaveResult {
  saved: string[];
  failed: Array<{ path: string; message: string }>;
}

const identifierPattern = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;

export function assertTrainingIdentifier(value: string, label: string): void {
  if (!identifierPattern.test(value) || value.includes("..") || value.includes(sep)) {
    throw createWriteForError("CONFIG_INVALID", `${label} uses an unsafe name: ${value}`);
  }
}

export function targetKey(target: Pick<TrainingTarget, "kind" | "name">): string {
  return `${target.kind}:${target.name}`;
}

export function pathForTrainingTarget(target: TrainingTarget): string {
  assertTrainingIdentifier(target.name, target.kind);
  const root = resolve(target.root || defaultConfigRoot());
  if (target.kind === "style") return join(root, "style.md");
  if (target.kind === "register") return join(root, "registers", `${target.name}.md`);
  return join(root, "channels", `${target.name}.md`);
}

function hash(bytes: string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function splitProfileFile(bytes: string): { frontmatter?: string; body: string } {
  const normalized = bytes.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (!normalized.startsWith("---\n")) return { body: normalized.trim() };
  const match = normalized.match(/^(---\n[\s\S]*?\n---)(?:\n|$)([\s\S]*)$/);
  if (!match) throw createWriteForError("CONFIG_INVALID", "frontmatter is not closed");
  return { frontmatter: match[1], body: (match[2] ?? "").trim() };
}

export async function snapshotTarget(target: TrainingTarget): Promise<ProfileSnapshot> {
  const path = pathForTrainingTarget(target);
  if (!existsSync(path)) return { target, path, existed: false, body: "" };
  const bytes = await readFile(path, "utf8");
  const split = splitProfileFile(bytes);
  return { target, path, existed: true, bytes, hash: hash(bytes), ...split };
}

export async function snapshotTargets(targets: TrainingTarget[]): Promise<ProfileSnapshot[]> {
  return Promise.all(targets.map((target) => snapshotTarget(target)));
}

export function createProfileProposal(input: {
  snapshots: ProfileSnapshot[];
  bodies: Record<string, string>;
  warnings?: string[];
  details?: unknown;
}): ProfileProposal {
  const allowed = new Set(input.snapshots.map((snapshot) => targetKey(snapshot.target)));
  const bodies: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.bodies)) {
    if (!allowed.has(key))
      throw createWriteForError("INVALID_REQUEST", `model proposed unapproved target ${key}`);
    const body = stripFrontmatterFromGeneratedBody(value);
    if (!body) throw createWriteForError("GENERATION_FAILED", `empty proposed body for ${key}`);
    bodies[key] = body;
  }
  for (const key of allowed) {
    if (!bodies[key])
      throw createWriteForError("GENERATION_FAILED", `missing proposed body for ${key}`);
  }
  return {
    id: randomUUID(),
    snapshots: input.snapshots,
    bodies,
    warnings: input.warnings ?? [],
    details: input.details,
  };
}

async function assertSnapshotCurrent(snapshot: ProfileSnapshot): Promise<void> {
  if (!existsSync(snapshot.path)) {
    if (!snapshot.existed) return;
    throw createWriteForError("PROPOSAL_STALE", `${snapshot.path} was deleted after review`);
  }
  const current = await readFile(snapshot.path, "utf8");
  if (!snapshot.existed || hash(current) !== snapshot.hash) {
    throw createWriteForError("PROPOSAL_STALE", `${snapshot.path} changed after review`);
  }
}

function composeProfile(snapshot: ProfileSnapshot, body: string): string {
  const normalizedBody = body.trim();
  return `${snapshot.frontmatter ? `${snapshot.frontmatter}\n` : ""}${normalizedBody}\n`;
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${Date.now()}.${process.pid}.tmp`);
  try {
    await writeFile(temp, contents, "utf8");
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function saveApprovedProposal(proposal: ProfileProposal): Promise<SaveResult> {
  const saved: string[] = [];
  const failed: SaveResult["failed"] = [];
  for (const snapshot of proposal.snapshots) {
    const body = proposal.bodies[targetKey(snapshot.target)];
    if (!body) continue;
    try {
      await withFileMutationQueue(snapshot.path, async () => {
        await assertSnapshotCurrent(snapshot);
        await atomicWrite(snapshot.path, composeProfile(snapshot, body));
      });
      saved.push(snapshot.path);
    } catch (error) {
      failed.push({
        path: snapshot.path,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { saved, failed };
}

const reviewBodyStart = "<!-- PI_WRITE_FOR_BODY_START -->";
const reviewBodyEnd = "<!-- PI_WRITE_FOR_BODY_END -->";

function bodyLines(body: string): string[] {
  return body
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
}

function simpleLineDiff(
  before: string,
  after: string,
): { additions: string[]; removals: string[] } {
  const beforeLines = bodyLines(before);
  const afterLines = bodyLines(after);
  const beforeSet = new Set(beforeLines);
  const afterSet = new Set(afterLines);
  return {
    additions: afterLines.filter((line) => !beforeSet.has(line)),
    removals: beforeLines.filter((line) => !afterSet.has(line)),
  };
}

function bulletLines(lines: string[], prefix: string): string {
  return lines.length ? lines.map((line) => `${prefix} ${line}`).join("\n") : "None";
}

export function reviewTextForProposal(
  proposal: ProfileProposal,
  snapshot?: ProfileSnapshot,
): string {
  const snapshots = snapshot ? [snapshot] : proposal.snapshots;
  return snapshots
    .map((item) => {
      const key = targetKey(item.target);
      const proposed = proposal.bodies[key] ?? "";
      const diff = simpleLineDiff(item.body, proposed);
      const conflict = diff.removals.length
        ? "Potential conflict: proposed body removes existing/manual profile lines. Review removals before saving."
        : "Conflicts: none detected by line review.";
      const warnings = [conflict, ...proposal.warnings]
        .filter(Boolean)
        .map((warning) => `- ${warning}`)
        .join("\n");
      const before = item.body || "<new file>";
      return [
        `Destination: ${item.path}`,
        `Target: ${targetKey(item.target)}`,
        "Warnings/conflicts:",
        warnings || "- None",
        "",
        "Edit the final approved body between the markers below. Existing content, additions, and removals are shown for review before final confirmation.",
        reviewBodyStart,
        proposed,
        reviewBodyEnd,
        "",
        "Existing content:",
        before,
        "",
        "Additions:",
        bulletLines(diff.additions, "+"),
        "",
        "Removals:",
        bulletLines(diff.removals, "-"),
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

export function reviewedBodyFromText(text: string): string {
  const start = text.indexOf(reviewBodyStart);
  if (start === -1) return text.trim();
  const bodyStart = start + reviewBodyStart.length;
  const end = text.indexOf(reviewBodyEnd, bodyStart);
  if (end === -1) return text.slice(bodyStart).trim();
  return text.slice(bodyStart, end).trim();
}
