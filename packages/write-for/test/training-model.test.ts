import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createTrainingManager } from "../src/training.ts";
import { makeCtx, makePi, makeProfile } from "./fixtures.ts";

function interactiveCtx(root: string) {
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

describe("write-for training model distillation", () => {
  test("uses configured target model without needing an existing trained body", async () => {
    const root = makeProfile();
    writeFileSync(join(root, "registers", "pro.md"), "---\nmodel: test/configured\n---\n");
    const harness = makePi();
    const seen: unknown[] = [];
    const manager = createTrainingManager(harness.pi, {
      env: { envConfig: root },
      runText: async (input) => {
        seen.push(input.model);
        return {
          text: JSON.stringify({ bodies: { "register:pro": "## Voice\nUse crisp examples." } }),
          model: { provider: "test", id: "configured" },
          usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 },
        };
      },
    });
    const ctx = interactiveCtx(root);
    await manager.start(ctx, { mode: "train", scope: "register", register: "pro" });
    await manager.admitSamples(ctx, {
      text: "The approved evidence sample.",
      sourceLabel: "fixture",
    });
    const proposal = await manager.propose(ctx);
    expect(seen).toEqual([
      {
        provider: "test",
        id: "configured",
        source: join(root, "registers", "pro.md"),
        value: "test/configured",
      },
    ]);
    expect(proposal.bodies["register:pro"]).toContain("crisp examples");
  });

  test("includes applicable style, register, and channel bodies in distillation prompts", async () => {
    const root = makeProfile();
    const harness = makePi();
    let prompt = "";
    const manager = createTrainingManager(harness.pi, {
      env: { envConfig: root },
      runText: async (input) => {
        prompt = input.messages.map((message) => message.content).join("\n");
        return {
          text: JSON.stringify({ bodies: { "channel:email": "Email voice update" } }),
          model: { provider: "test", id: "m1" },
          usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
        };
      },
    });
    const ctx = interactiveCtx(root);
    await manager.start(ctx, {
      mode: "train",
      scope: "channel",
      channel: "email",
      register: "professional",
    });
    await manager.admitSamples(ctx, { text: "approved evidence", sourceLabel: "fixture" });
    await manager.propose(ctx);
    expect(prompt).toContain("Plain style");
    expect(prompt).toContain("Professional voice");
    expect(prompt).toContain("Email format");
  });

  test("filters admitted samples to the target register before distillation", async () => {
    const root = makeProfile();
    const harness = makePi();
    let prompt = "";
    const manager = createTrainingManager(harness.pi, {
      env: { envConfig: root },
      runText: async (input) => {
        prompt = input.messages.map((message) => message.content).join("\n");
        return {
          text: JSON.stringify({ bodies: { "register:pro": "Professional evidence only" } }),
          model: { provider: "test", id: "m1" },
          usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
        };
      },
    });
    const ctx = interactiveCtx(root);
    await manager.start(ctx, { mode: "train", scope: "register", register: "pro" });
    await manager.admitSamples(ctx, {
      text: "formal relevant evidence",
      sourceLabel: "pro fixture",
      register: "pro",
    });
    await manager.admitSamples(ctx, {
      text: "casual irrelevant evidence",
      sourceLabel: "casual fixture",
      register: "casual",
    });
    await manager.propose(ctx);
    expect(prompt).toContain("formal relevant evidence");
    expect(prompt).not.toContain("casual irrelevant evidence");

    const noRelevant = createTrainingManager(harness.pi, { env: { envConfig: root } });
    await noRelevant.start(ctx, { mode: "train", scope: "register", register: "pro" });
    await noRelevant.admitSamples(ctx, {
      text: "casual only",
      sourceLabel: "casual fixture",
      register: "casual",
    });
    await expect(noRelevant.propose(ctx)).rejects.toHaveProperty("code", "SOURCE_INVALID");
  });

  test("rejects host-collected text that exceeds the shared corpus limit", async () => {
    const root = makeProfile();
    const harness = makePi();
    const ctx = interactiveCtx(root);
    const manager = createTrainingManager(harness.pi, { env: { envConfig: root } });
    await manager.start(ctx, { mode: "train", scope: "register", register: "pro" });
    await expect(
      manager.admitSamples(ctx, {
        text: "x".repeat(200_001),
        sourceLabel: "huge paste",
      }),
    ).rejects.toHaveProperty("code", "SOURCE_LIMIT");
  });

  test("rejects model output for unapproved targets and oversized corpus", async () => {
    const root = makeProfile();
    const harness = makePi();
    const ctx = interactiveCtx(root);
    const manager = createTrainingManager(harness.pi, {
      env: { envConfig: root },
      runText: async () => ({
        text: JSON.stringify({ bodies: { "channel:email": "wrong" } }),
        model: { provider: "test", id: "m1" },
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      }),
    });
    await manager.start(ctx, { mode: "train", scope: "register", register: "pro" });
    await manager.admitSamples(ctx, { text: "evidence", sourceLabel: "fixture" });
    await expect(manager.propose(ctx)).rejects.toHaveProperty("code", "INVALID_REQUEST");

    const huge = createTrainingManager(harness.pi, { env: { envConfig: root } });
    await huge.start(ctx, { mode: "train", scope: "register", register: "pro" });
    await huge.admitSamples(ctx, { text: "x".repeat(181_000), sourceLabel: "huge" });
    await expect(huge.propose(ctx)).rejects.toHaveProperty("code", "SOURCE_LIMIT");
  });
});
