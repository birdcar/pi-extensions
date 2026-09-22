import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createTrainingManager } from "../src/training.ts";
import { makeCtx, makePi, makeProfile } from "./fixtures.ts";

function interactive(root: string) {
  const { ctx } = makeCtx(root);
  Object.assign(ctx, {
    hasUI: true,
    ui: {
      notify() {},
      input: async () => "answer",
      select: async () => "register",
      confirm: async () => true,
      editor: async (_title: string, prefill?: string) => prefill,
    },
  });
  return ctx;
}

describe("write-for training retention", () => {
  test("cancel and shutdown release in-memory samples without deleting originals", async () => {
    const root = makeProfile();
    const original = join(root, "original.txt");
    writeFileSync(original, "user original");
    const harness = makePi();
    const manager = createTrainingManager(harness.pi, { env: { envConfig: root } });
    const ctx = interactive(root);
    await manager.start(ctx, { mode: "train", scope: "register", register: "pro" });
    await manager.admitSamples(ctx, { text: "raw sentinel sample", sourceLabel: original });
    expect(manager.current()?.samples).toHaveLength(1);
    await manager.cancel();
    expect(manager.current()).toBeUndefined();
    expect(readFileSync(original, "utf8")).toBe("user original");
  });

  test("successful save persists excerpts only and clears active session", async () => {
    const root = makeProfile();
    const harness = makePi();
    const manager = createTrainingManager(harness.pi, {
      env: { envConfig: root },
      runText: async () => ({
        text: JSON.stringify({
          bodies: { "register:pro": "## Sources\nApproved excerpt: practical voice." },
        }),
        model: { provider: "test", id: "m1" },
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      }),
    });
    const ctx = interactive(root);
    await manager.start(ctx, { mode: "train", scope: "register", register: "pro" });
    await manager.admitSamples(ctx, {
      text: "raw sentinel sample that must not be archived",
      sourceLabel: "fixture",
    });
    await manager.propose(ctx);
    const saved = await manager.reviewAndSave(ctx);
    expect(saved.failed).toEqual([]);
    expect(manager.current()).toBeUndefined();
    const profile = readFileSync(join(root, "registers", "pro.md"), "utf8");
    expect(profile).toContain("Approved excerpt");
    expect(profile).not.toContain("raw sentinel sample that must not be archived");
    expect(existsSync(join(root, "samples"))).toBe(false);
  });
});
