/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test } from "bun:test";
import { createWritingEngine } from "../src/engine.ts";
import { makeCtx } from "./fixtures.ts";

describe("writing engine", () => {
  test("maps draft result metadata and composes prompts", async () => {
    const { ctx, root } = makeCtx();
    const engine = createWritingEngine({ env: { envConfig: root } });
    const result = await engine.draft(ctx, {
      channel: "email",
      register: "pro",
      subject: "Hello",
      rules: ["short"],
    });
    expect(result.text).toBe("draft text");
    expect(result.channel).toBe("email");
    expect(result.register).toBe("pro");
  });

  test("does not pass inherited active model as configured override", async () => {
    const { ctx, root } = makeCtx();
    let modelWasPassed = true;
    const engine = createWritingEngine({
      env: { envConfig: root },
      runText: async (input) => {
        modelWasPassed = input.model !== undefined;
        return {
          text: "ok",
          channel: "email",
          register: "pro",
          model: { provider: "test", id: "m1" },
          usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        };
      },
    });
    await engine.draft(ctx, { channel: "email", register: "pro", subject: "x" });
    expect(modelWasPassed).toBeFalse();
  });

  test("rejects execution fields", async () => {
    const { ctx, root } = makeCtx();
    const engine = createWritingEngine({ env: { envConfig: root } });
    await expect(
      engine.draft(ctx, { channel: "email", register: "pro", subject: "x", model: "bad" } as any),
    ).rejects.toHaveProperty("code", "INVALID_REQUEST");
  });
});
