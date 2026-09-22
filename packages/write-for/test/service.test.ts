import { describe, expect, test } from "bun:test";
import { discoverService } from "@birdcar/pi-services";
import { writeForContract, type WritingResult } from "../src/contract.ts";
import { registerWriteForService } from "../src/service.ts";
import { makeCtx, makePi } from "./fixtures.ts";
import { draftFor } from "../../../tests/fixtures/write-for/consumer-a.ts";
import { rewriteFor } from "../../../tests/fixtures/write-for/consumer-b.ts";

function result(text: string): WritingResult {
  return {
    text,
    channel: "email",
    register: "pro",
    model: { provider: "test", id: "m1" },
    usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 },
  };
}

describe("write-for service", () => {
  test("is discoverable after setup and waits for session", async () => {
    const harness = makePi();
    const { ctx, root } = makeCtx();
    registerWriteForService(harness.pi, { env: { envConfig: root } });
    const api = discoverService(harness.pi.events, writeForContract)!;
    await expect(
      api.draft({ channel: "email", register: "pro", subject: "x" }),
    ).rejects.toHaveProperty("code", "NOT_READY");
    harness.start(ctx);
    await expect(
      api.draft({ channel: "email", register: "pro", subject: "x" }),
    ).resolves.toHaveProperty("text", "draft text");
  });

  test("validates public requests before readiness or signal composition", async () => {
    const harness = makePi();
    const { root } = makeCtx();
    registerWriteForService(harness.pi, { env: { envConfig: root } });
    const api = discoverService(harness.pi.events, writeForContract)!;

    await expect(api.draft(null as never)).rejects.toHaveProperty("code", "INVALID_REQUEST");
    await expect(
      api.rewrite({ channel: "email", register: "pro", text: "x", signal: {} as never }),
    ).rejects.toHaveProperty("code", "INVALID_REQUEST");
  });

  test("serves two independently authored consumers", async () => {
    const harness = makePi();
    const { ctx, root } = makeCtx();
    registerWriteForService(harness.pi, { env: { envConfig: root } });
    harness.start(ctx);

    await expect(draftFor(harness.pi.events, "launch")).resolves.toBe("draft text");
    await expect(rewriteFor(harness.pi.events, "make this shorter")).resolves.toHaveProperty(
      "text",
      "draft text",
    );
  });

  test("keeps concurrent calls isolated", async () => {
    const harness = makePi();
    const { ctx, root } = makeCtx();
    const seen: string[] = [];
    registerWriteForService(harness.pi, {
      env: { envConfig: root },
      runText: async (input) => {
        seen.push(input.messages.map((message) => message.content).join("\n"));
        await Promise.resolve();
        return result(`draft ${seen.length}`);
      },
    });
    harness.start(ctx);
    const api = discoverService(harness.pi.events, writeForContract)!;

    await Promise.all([
      api.draft({ channel: "email", register: "pro", subject: "a", rules: ["alpha"] }),
      api.draft({ channel: "email", register: "pro", subject: "b", rules: ["beta"] }),
    ]);

    expect(seen.some((prompt) => prompt.includes("alpha") && !prompt.includes("beta"))).toBeTrue();
    expect(seen.some((prompt) => prompt.includes("beta") && !prompt.includes("alpha"))).toBeTrue();
  });

  test("cancels one request without cancelling another", async () => {
    const harness = makePi();
    const { ctx, root } = makeCtx();
    registerWriteForService(harness.pi, {
      env: { envConfig: root },
      runText: (input) =>
        new Promise((resolve, reject) => {
          input.signal?.addEventListener(
            "abort",
            () => reject(Object.assign(new Error("cancelled"), { code: "GENERATION_FAILED" })),
            { once: true },
          );
          if (input.messages.some((message) => message.content.includes("keep"))) {
            queueMicrotask(() => resolve(result("kept")));
          }
        }),
    });
    harness.start(ctx);
    const api = discoverService(harness.pi.events, writeForContract)!;
    const controller = new AbortController();
    const cancelled = api.draft({
      channel: "email",
      register: "pro",
      subject: "cancel",
      signal: controller.signal,
    });
    const kept = api.draft({ channel: "email", register: "pro", subject: "keep" });
    controller.abort();

    await expect(cancelled).rejects.toHaveProperty("code", "GENERATION_FAILED");
    await expect(kept).resolves.toHaveProperty("text", "kept");
  });

  test("disposal aborts in-flight work and stale APIs reject", async () => {
    const harness = makePi();
    const { ctx, root } = makeCtx();
    const registration = registerWriteForService(harness.pi, {
      env: { envConfig: root },
      runText: (input) =>
        new Promise((_, reject) => {
          input.signal?.addEventListener(
            "abort",
            () => reject(Object.assign(new Error("disposed"), { code: "GENERATION_FAILED" })),
            { once: true },
          );
        }),
    });
    harness.start(ctx);
    const pending = registration.api.draft({ channel: "email", register: "pro", subject: "x" });
    await registration.dispose();

    await expect(pending).rejects.toHaveProperty("code", "GENERATION_FAILED");
    await expect(
      registration.api.draft({ channel: "email", register: "pro", subject: "x" }),
    ).rejects.toHaveProperty("code", "NOT_READY");
  });

  test("rediscovery uses a newly registered provider after disposal", async () => {
    const harness = makePi();
    const { ctx, root } = makeCtx();
    const first = registerWriteForService(harness.pi, {
      env: { envConfig: root },
      runText: async () => result("first"),
    });
    harness.start(ctx);
    expect(await draftFor(harness.pi.events, "x")).toBe("first");
    await first.dispose();

    registerWriteForService(harness.pi, {
      env: { envConfig: root },
      runText: async () => result("second"),
    });
    harness.start(ctx);
    expect(await draftFor(harness.pi.events, "x")).toBe("second");
  });
});
