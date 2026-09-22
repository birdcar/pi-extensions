import { createWriteForError } from "./errors.js";
import type { AdmittedSample } from "./sources.js";

export interface TrainingPromptTarget {
  kind: "style" | "register" | "channel";
  name: string;
  existingBody?: string;
  styleBody?: string;
  registerBody?: string;
  channelBody?: string;
}

export interface TrainingPromptInput {
  mode: "train" | "retrain";
  target: TrainingPromptTarget;
  answers: Record<string, string>;
  samples: AdmittedSample[];
}

export function hostInterviewGuidance(input: {
  mode: "train" | "retrain";
  scope: string;
  sourceFolder?: string;
  activeTools: string[];
  allTools: string[];
}): string {
  const supplied = input.sourceFolder
    ? `\nA local source folder was supplied: ${input.sourceFolder}. Present a plan and ask for approval before reading it.`
    : "";
  const active = input.activeTools.length ? input.activeTools.join(", ") : "none reported";
  const all = input.allTools.length ? input.allTools.join(", ") : "none reported";
  return [
    `Start a cooperative Pi Write For ${input.mode} voice-learning interview for scope ${input.scope}.`,
    "Use the writer-local tools write_for_interview, write_for_samples, and write_for_profile; do not bypass sample or save review with generic filesystem tools.",
    "Ask who wrote the sources, which quotations or other authors to exclude, the relevant audience/tone/register, permitted local paths or host tools, save destination, and any manual rules that must remain authoritative.",
    "You may use already active host tools when the user authorizes them, but do not install tools, probe credentials, activate tools, or treat tool names as permission.",
    `Active tools: ${active}. Available tool metadata: ${all}.${supplied}`,
  ].join("\n\n");
}

export function buildDistillationMessages(
  input: TrainingPromptInput,
): Array<{ role: "system" | "user"; content: string }> {
  const sampleText = input.samples
    .map(
      (sample) =>
        `Sample ${sample.id} (${sample.source}${sample.author ? `, author ${sample.author}` : ""}${sample.register ? `, register ${sample.register}` : ""}):\n${sample.text}`,
    )
    .join("\n\n---\n\n");
  const answers = Object.entries(input.answers)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  const existing = input.target.existingBody
    ? `Existing approved profile body for retraining:\n${input.target.existingBody}`
    : "No existing profile body is approved for this target.";
  return [
    {
      role: "system",
      content:
        "You distill writing voice profiles. Return only JSON with a top-level bodies object keyed by the supplied target key. Values are Markdown profile bodies. Do not include YAML frontmatter, credentials, connector commands, tool calls, or extra targets. Preserve deliberate existing manual rules unless a clear conflict is described in prose.",
    },
    {
      role: "user",
      content: [
        `Mode: ${input.mode}`,
        `Target key: ${input.target.kind}:${input.target.name}`,
        existing,
        input.target.styleBody ? `Applicable style guidance:\n${input.target.styleBody}` : "",
        input.target.registerBody
          ? `Applicable register guidance:\n${input.target.registerBody}`
          : "",
        input.target.channelBody ? `Applicable channel guidance:\n${input.target.channelBody}` : "",
        answers ? `Interview answers:\n${answers}` : "Interview answers: none recorded",
        `Admitted evidence samples:\n${sampleText}`,
        "Produce concrete voice rules, examples, source references, and uncertainties. Distinguish evidence from inference.",
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];
}

export function stripFrontmatterFromGeneratedBody(body: string): string {
  const normalized = body
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (normalized === "---" || normalized.startsWith("---\n")) {
    const frontmatter = normalized.match(/^---\n[\s\S]*?\n---(?:\n|$)/);
    if (!frontmatter) {
      throw createWriteForError("GENERATION_FAILED", "generated profile frontmatter is not closed");
    }
    return normalized.slice(frontmatter[0].length).trim();
  }
  return normalized;
}
