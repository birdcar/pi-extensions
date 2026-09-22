import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { TrainingManager } from "./training.js";
import { createWriteForError } from "./errors.js";

const interviewParameters = Type.Object({
  key: Type.String({ minLength: 1 }),
  question: Type.String({ minLength: 1 }),
  multiline: Type.Optional(Type.Boolean()),
});

const samplesParameters = Type.Object({
  sourceFolder: Type.Optional(Type.String()),
  text: Type.Optional(Type.String()),
  sourceLabel: Type.Optional(Type.String()),
  author: Type.Optional(Type.String()),
  register: Type.Optional(Type.String()),
});

const profileParameters = Type.Object({
  action: Type.String({ enum: ["propose", "save", "cancel"] }),
  proposalId: Type.Optional(Type.String()),
});

function textContent(text: string): Array<{ type: "text"; text: string }> {
  return [{ type: "text", text }];
}

function compactSamples(
  samples: Array<{ id: string; source: string; warnings: string[] }>,
): string {
  if (samples.length === 0) return "No samples admitted.";
  return samples
    .map(
      (sample) =>
        `${sample.id}: ${sample.source}${sample.warnings.length ? ` (${sample.warnings.length} warnings)` : ""}`,
    )
    .join("\n");
}

export function registerTrainingTools(pi: ExtensionAPI, manager: TrainingManager): void {
  pi.registerTool({
    name: "write_for_interview",
    label: "Write For Interview",
    description: "Ask and store one structured Pi Write For voice-learning interview question.",
    promptSnippet: "write_for_interview: ask one approved voice-learning interview question.",
    promptGuidelines: [
      "Use write_for_interview before distillation when source ownership, audience, register, exclusions, or save destination is unclear.",
    ],
    parameters: interviewParameters,
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      onUpdate?.({ content: textContent("Asking the user…"), details: undefined });
      const answer = await manager.ask(ctx, params);
      return {
        content: textContent(`Recorded answer for ${params.key}.`),
        details: { key: params.key, answerLength: answer.length },
      };
    },
  });

  pi.registerTool({
    name: "write_for_samples",
    label: "Write For Samples",
    description:
      "Present, approve, and admit local or host-collected writing samples for the active Pi Write For training session.",
    promptSnippet:
      "write_for_samples: approve and admit source samples; returns sample IDs, not full corpus text.",
    promptGuidelines: [
      "Use write_for_samples to admit every source before write_for_profile; never pass unapproved source text directly to profile saving.",
    ],
    parameters: samplesParameters,
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      onUpdate?.({ content: textContent("Preparing source approval…"), details: undefined });
      const result = await manager.admitSamples(ctx, params);
      return {
        content: textContent(compactSamples(result.samples)),
        details: {
          sampleIds: result.samples.map((sample) => sample.id),
          diagnostics: result.diagnostics,
        },
      };
    },
  });

  pi.registerTool({
    name: "write_for_profile",
    label: "Write For Profile",
    description: "Propose, review/save, or cancel active Pi Write For profile learning.",
    promptSnippet:
      "write_for_profile: propose distilled profile bodies, save after built-in user approval, or cancel.",
    promptGuidelines: [
      "Use write_for_profile action=propose only after samples are admitted; action=save always invokes human review and approval.",
    ],
    parameters: profileParameters,
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      if (params.action === "cancel") {
        if (!manager.current()) {
          throw createWriteForError(
            "TRAINING_NOT_ACTIVE",
            "start /train-voice before using write-for training tools",
          );
        }
        await manager.cancel();
        return {
          content: textContent("Cancelled Pi Write For training session."),
          details: { cancelled: true },
        };
      }
      if (params.action === "propose") {
        onUpdate?.({ content: textContent("Distilling admitted samples…"), details: undefined });
        const proposal = await manager.propose(ctx);
        return {
          content: textContent(
            `Prepared proposal ${proposal.id} for ${proposal.snapshots.length} destination(s). Use write_for_profile action=save to review and save it.`,
          ),
          details: {
            proposalId: proposal.id,
            destinations: proposal.snapshots.map((snapshot) => snapshot.path),
            warnings: proposal.warnings,
            modelDetails: proposal.details,
          },
        };
      }
      if (params.action === "save") {
        onUpdate?.({ content: textContent("Requesting profile approval…"), details: undefined });
        const result = await manager.reviewAndSave(ctx, params.proposalId);
        return {
          content: textContent(
            result.failed.length
              ? `Saved ${result.saved.length} profile(s); ${result.failed.length} failed.`
              : `Saved ${result.saved.length} Pi Write For profile(s).`,
          ),
          details: result,
        };
      }
      throw createWriteForError("INVALID_REQUEST", `unsupported profile action: ${params.action}`);
    },
  });
}
