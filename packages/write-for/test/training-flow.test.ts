import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import writeForExtension from "../src/index.ts";
import { parseTrainingArgs } from "../src/commands.ts";
import { createTrainingManager } from "../src/training.ts";
import { makeCtx, makePi, makeProfile } from "./fixtures.ts";

function uiCtx(root?: string) {
  const { ctx } = makeCtx(root);
  const answers: string[] = [];
  Object.assign(ctx, {
    hasUI: true,
    ui: {
      notify(message: string) {
        answers.push(message);
      },
      input: async () => "answer",
      select: async () => "style",
      confirm: async () => true,
      editor: async (_title: string, prefill?: string) => prefill,
    },
  });
  return { ctx, answers };
}

describe("write-for training flow", () => {
  test("parses training flags", () => {
    expect(parseTrainingArgs("--register pro --source samples --project")).toEqual({
      scope: "register",
      register: "pro",
      sourceFolder: "samples",
      saveTarget: "project",
    });
    expect(parseTrainingArgs("--all --register pro --channel email")).toEqual({
      scope: "all",
      register: "pro",
      channel: "email",
    });
  });

  test("registers commands/tools and sends host guidance", async () => {
    const harness = makePi();
    writeForExtension(harness.pi);
    expect([...harness.tools.keys()].sort()).toEqual([
      "write_for_interview",
      "write_for_profile",
      "write_for_samples",
    ]);
    const { ctx } = uiCtx();
    await harness.commands.get("train-voice").handler("--style", ctx);
    expect(harness.userMessages.at(-1).content).toContain("write_for_samples");
    const result = await harness.tools.get("write_for_interview").execute(
      "t1",
      {
        key: "author",
        question: "Who wrote this?",
      },
      undefined,
      undefined,
      ctx,
    );
    expect(result.content[0].text).toContain("Recorded answer");
  });

  test("headless training fails NO_UI and replacement asks first", async () => {
    const harness = makePi();
    writeForExtension(harness.pi);
    const { ctx: headless } = makeCtx();
    await expect(
      harness.commands.get("train-voice").handler("--style", headless),
    ).rejects.toHaveProperty("code", "NO_UI");

    const { ctx } = uiCtx();
    await harness.commands.get("train-voice").handler("--style", ctx);
    let asked = false;
    ctx.ui.confirm = async () => {
      asked = true;
      return true;
    };
    await harness.commands.get("retrain-voice").handler("--style", ctx);
    expect(asked).toBe(true);
  });

  test("tools reject outside active training", async () => {
    const harness = makePi();
    writeForExtension(harness.pi);
    const { ctx } = uiCtx();
    await expect(
      harness.tools
        .get("write_for_profile")
        .execute("t1", { action: "propose" }, undefined, undefined, ctx),
    ).rejects.toHaveProperty("code", "TRAINING_NOT_ACTIVE");
    await expect(
      harness.tools
        .get("write_for_profile")
        .execute("t1", { action: "cancel" }, undefined, undefined, ctx),
    ).rejects.toHaveProperty("code", "TRAINING_NOT_ACTIVE");
  });

  test("project save target requires trusted project and interview can update destination", async () => {
    const harness = makePi();
    writeForExtension(harness.pi);
    const { ctx } = uiCtx();
    ctx.isProjectTrusted = () => false;
    await expect(
      harness.commands.get("train-voice").handler("--style --project", ctx),
    ).rejects.toHaveProperty("code", "CONFIG_INVALID");

    const customRoot = makeProfile();
    ctx.isProjectTrusted = () => true;
    ctx.ui.input = async () => `path: ${customRoot}`;
    const manager = createTrainingManager(harness.pi);
    await manager.start(ctx, { mode: "train", scope: "style" });
    await manager.ask(ctx, {
      key: "save_destination",
      question: "Where should profiles be saved?",
    });
    expect(manager.current()?.root).toBe(customRoot);
  });

  test("folder diagnostics require review before admitting remaining samples", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-write-for-sources-"));
    writeFileSync(join(dir, "good.txt"), "usable training prose");
    writeFileSync(join(dir, "bad.txt"), new Uint8Array([0, 1, 2]));
    const harness = makePi();
    const { ctx } = uiCtx();
    const confirmations: string[] = [];
    ctx.ui.confirm = async (title: string) => {
      confirmations.push(title);
      return confirmations.length === 1;
    };
    const manager = createTrainingManager(harness.pi);
    await manager.start(ctx, { mode: "train", scope: "register", register: "pro" });
    const result = await manager.admitSamples(ctx, { sourceFolder: dir });
    expect(confirmations).toEqual([
      "Admit Pi Write For sources?",
      "Admit remaining Pi Write For samples?",
    ]);
    expect(result.samples).toEqual([]);
    expect(manager.current()?.samples).toEqual([]);
  });

  test("explicit project-local config roots require trusted project for training saves", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-write-for-local-"));
    const cwd = join(dir, "repo", "app");
    const explicit = join(dir, "repo", ".pi", "write-for");
    mkdirSync(explicit, { recursive: true });
    mkdirSync(cwd, { recursive: true });
    const harness = makePi();
    const { ctx } = uiCtx();
    ctx.cwd = cwd;
    ctx.isProjectTrusted = () => false;
    const manager = createTrainingManager(harness.pi, {
      env: { envConfig: explicit, trustedProject: false },
    });
    await expect(manager.start(ctx, { mode: "train", scope: "style" })).rejects.toHaveProperty(
      "code",
      "CONFIG_INVALID",
    );
  });
});
