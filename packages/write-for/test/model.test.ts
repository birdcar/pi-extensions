/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test } from "bun:test";
import { runText, type HostModelRegistry, type RunTextInput } from "../src/model.ts";

const model = { provider: "test", id: "m1" };
const configuredModel = { provider: "test", id: "configured" };

function makeRunnerCtx(registry: HostModelRegistry, active = model): RunTextInput["ctx"] {
  return { model: active, modelRegistry: registry };
}

describe("model runner", () => {
  test("uses active model, builds Pi context, and normalizes real usage", async () => {
    let sentContext: any;
    const registry: HostModelRegistry = {
      find: () => undefined,
      hasConfiguredAuth: () => true,
      complete: async (_model, context) => {
        sentContext = context;
        return {
          role: "assistant",
          content: [{ type: "text", text: "ok" }],
          stopReason: "stop",
          usage: {
            input: 3,
            output: 4,
            cacheRead: 5,
            cacheWrite: 6,
            cost: { total: 0.02 },
          },
        };
      },
    };
    const result = await runText({
      ctx: makeRunnerCtx(registry),
      messages: [
        { role: "system", content: "policy" },
        { role: "user", content: "hi" },
      ],
    });
    expect(sentContext).toMatchObject({
      systemPrompt: "policy",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(sentContext.messages[0].timestamp).toBeNumber();
    expect(result.text).toBe("ok");
    expect(result.model).toEqual({ provider: "test", id: "m1" });
    expect(result.usage).toEqual({
      inputTokens: 3,
      outputTokens: 4,
      cacheReadTokens: 5,
      cacheWriteTokens: 6,
      costUsd: 0.02,
    });
  });

  test("selects the configured model through the registry instead of the active model", async () => {
    const selected: any[] = [];
    const registry: HostModelRegistry = {
      find: (provider, id) =>
        provider === "test" && id === "configured" ? configuredModel : undefined,
      hasConfiguredAuth: () => true,
      complete: async (selectedModel) => {
        selected.push(selectedModel);
        return { text: "configured output", stopReason: "stop" };
      },
    };

    const result = await runText({
      ctx: makeRunnerCtx(registry),
      model: { provider: "test", id: "configured", value: "test/configured", source: "profile" },
      messages: [],
    });

    expect(selected).toEqual([configuredModel]);
    expect(result.model).toEqual({ provider: "test", id: "configured" });
  });

  test("rejects missing auth", async () => {
    const registry: HostModelRegistry = {
      find: () => undefined,
      hasConfiguredAuth: () => false,
      complete: async () => ({ text: "should not run" }),
    };
    await expect(runText({ ctx: makeRunnerCtx(registry), messages: [] })).rejects.toHaveProperty(
      "code",
      "MODEL_AUTH",
    );
  });

  test("rejects non-success stop reasons and provider error results", async () => {
    for (const stopReason of ["length", "error", "aborted"]) {
      const registry: HostModelRegistry = {
        find: () => undefined,
        hasConfiguredAuth: () => true,
        complete: async () => ({ text: "partial", stopReason }),
      };
      await expect(runText({ ctx: makeRunnerCtx(registry), messages: [] })).rejects.toHaveProperty(
        "code",
        "GENERATION_FAILED",
      );
    }
  });

  test("rejects empty output and thrown stream errors", async () => {
    const emptyRegistry: HostModelRegistry = {
      find: () => undefined,
      hasConfiguredAuth: () => true,
      complete: async () => ({ text: "", stopReason: "stop" }),
    };
    await expect(
      runText({ ctx: makeRunnerCtx(emptyRegistry), messages: [] }),
    ).rejects.toHaveProperty("code", "GENERATION_FAILED");

    const throwingRegistry: HostModelRegistry = {
      find: () => undefined,
      hasConfiguredAuth: () => true,
      complete: async () => {
        throw new Error("provider failed");
      },
    };
    await expect(
      runText({ ctx: makeRunnerCtx(throwingRegistry), messages: [] }),
    ).rejects.toHaveProperty("code", "GENERATION_FAILED");
  });

  test("rejects mixed text and camelCase toolCall content", async () => {
    const registry: HostModelRegistry = {
      find: () => undefined,
      hasConfiguredAuth: () => true,
      complete: async () => ({
        content: [
          { type: "text", text: "partial draft" },
          { type: "toolCall", toolName: "postMessage", args: {} },
        ],
        stopReason: "stop",
      }),
    };
    await expect(runText({ ctx: makeRunnerCtx(registry), messages: [] })).rejects.toHaveProperty(
      "code",
      "GENERATION_FAILED",
    );
  });

  test("settles promptly on cancellation before and during a call", async () => {
    const registry: HostModelRegistry = {
      find: () => undefined,
      hasConfiguredAuth: () => true,
      complete: async () => new Promise(() => undefined),
    };

    const alreadyCancelled = new AbortController();
    alreadyCancelled.abort();
    await expect(
      runText({ ctx: makeRunnerCtx(registry), messages: [], signal: alreadyCancelled.signal }),
    ).rejects.toHaveProperty("code", "GENERATION_FAILED");

    const controller = new AbortController();
    const promise = runText({
      ctx: makeRunnerCtx(registry),
      messages: [],
      signal: controller.signal,
    });
    controller.abort();
    await expect(promise).rejects.toHaveProperty("code", "GENERATION_FAILED");
  });
});
