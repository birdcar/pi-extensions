/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test } from "bun:test";
import { provideService } from "@birdcar/pi-services";
import {
  WRITE_FOR_API_MAJOR,
  WRITE_FOR_REWRITE_EVENT,
  WRITE_FOR_SERVICE_ID,
} from "../src/contract.ts";
import { registerWriteForEvents } from "../src/events.ts";
import { makePi } from "./fixtures.ts";

const result = {
  text: "ok",
  channel: "slack",
  register: "pro",
  model: { provider: "p", id: "m" },
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
};

const tick = () => new Promise((resolve) => queueMicrotask(resolve));

function provideRewrite(
  harness: ReturnType<typeof makePi>,
  rewrite: (request: any) => Promise<any>,
) {
  return provideService(harness.pi, {
    id: WRITE_FOR_SERVICE_ID,
    apiMajor: WRITE_FOR_API_MAJOR,
    api: {
      draft: async () => {
        throw new Error("unused");
      },
      rewrite,
    },
  });
}

describe("rewrite event adapter", () => {
  test("accepts synchronously with completion promise", async () => {
    const harness = makePi();
    provideRewrite(harness, async () => result);
    registerWriteForEvents(harness.pi);
    let completion: Promise<any> | undefined;
    harness.pi.events.emit(WRITE_FOR_REWRITE_EVENT, {
      request: { channel: "slack", register: "pro", text: "x" },
      accept: (p: Promise<any>) => {
        completion = p;
      },
    });
    expect(completion).toBeDefined();
    await expect(completion!).resolves.toHaveProperty("text", "ok");
  });

  test("does not retry accept when the callback throws and aborts the scheduled request", async () => {
    const harness = makePi();
    let acceptCalls = 0;
    let sawAbortedSignal = false;
    provideRewrite(harness, async (request) => {
      sawAbortedSignal = request.signal.aborted;
      throw new Error("should be handled");
    });
    registerWriteForEvents(harness.pi);

    harness.pi.events.emit(WRITE_FOR_REWRITE_EVENT, {
      request: { channel: "slack", register: "pro", text: "x" },
      accept: () => {
        acceptCalls += 1;
        throw new Error("consumer failed");
      },
    });

    await tick();
    expect(acceptCalls).toBe(1);
    expect(sawAbortedSignal).toBe(true);
    expect(harness.messages).toHaveLength(1);
  });

  test("aborts scheduled work through the passed signal when accept throws with a caller signal", async () => {
    const harness = makePi();
    const caller = new AbortController();
    let sawAbortedSignal = false;
    provideRewrite(harness, async (request) => {
      sawAbortedSignal = request.signal.aborted;
      throw new Error("should be handled");
    });
    registerWriteForEvents(harness.pi);

    harness.pi.events.emit(WRITE_FOR_REWRITE_EVENT, {
      request: { channel: "slack", register: "pro", text: "x", signal: caller.signal },
      accept: () => {
        throw new Error("consumer failed");
      },
    });

    await tick();
    expect(caller.signal.aborted).toBe(false);
    expect(sawAbortedSignal).toBe(true);
  });

  test("reports malformed payloads without invoking callback properties or starting work", async () => {
    const harness = makePi();
    let calls = 0;
    provideRewrite(harness, async () => {
      calls += 1;
      return result;
    });
    registerWriteForEvents(harness.pi);

    harness.pi.events.emit(WRITE_FOR_REWRITE_EVENT, { request: { text: "x" } });
    harness.pi.events.emit(WRITE_FOR_REWRITE_EVENT, null);

    await tick();
    expect(calls).toBe(0);
    expect(harness.messages).toHaveLength(2);
  });

  test("accepts a rejected completion for duplicate providers before generation", async () => {
    const harness = makePi();
    let calls = 0;
    provideRewrite(harness, async () => {
      calls += 1;
      return result;
    });
    provideRewrite(harness, async () => {
      calls += 1;
      return result;
    });
    registerWriteForEvents(harness.pi);
    let completion: Promise<any> | undefined;

    harness.pi.events.emit(WRITE_FOR_REWRITE_EVENT, {
      request: { channel: "slack", register: "pro", text: "x" },
      accept: (p: Promise<any>) => {
        completion = p;
      },
    });

    expect(completion).toBeDefined();
    await expect(completion!).rejects.toHaveProperty("code", "SERVICE_AMBIGUOUS");
    expect(calls).toBe(0);
  });

  test("passes service failures through the accepted completion", async () => {
    const harness = makePi();
    provideRewrite(harness, async () => {
      throw new Error("model failed");
    });
    registerWriteForEvents(harness.pi);
    let completion: Promise<any> | undefined;

    harness.pi.events.emit(WRITE_FOR_REWRITE_EVENT, {
      request: { channel: "slack", register: "pro", text: "x" },
      accept: (p: Promise<any>) => {
        completion = p;
      },
    });

    await expect(completion!).rejects.toThrow("model failed");
  });

  test("passes caller cancellation signals to the service", async () => {
    const harness = makePi();
    const controller = new AbortController();
    provideRewrite(harness, async (request) => {
      if (request.signal.aborted) throw new Error("cancelled");
      return result;
    });
    registerWriteForEvents(harness.pi);
    let completion: Promise<any> | undefined;
    controller.abort();

    harness.pi.events.emit(WRITE_FOR_REWRITE_EVENT, {
      request: { channel: "slack", register: "pro", text: "x", signal: controller.signal },
      accept: (p: Promise<any>) => {
        completion = p;
      },
    });

    await expect(completion!).rejects.toThrow("cancelled");
  });

  test("unsubscribe stops handling rewrite events on shutdown", async () => {
    const harness = makePi();
    let calls = 0;
    provideRewrite(harness, async () => {
      calls += 1;
      return result;
    });
    const unsubscribe = registerWriteForEvents(harness.pi);
    unsubscribe();
    let accepted = false;

    harness.pi.events.emit(WRITE_FOR_REWRITE_EVENT, {
      request: { channel: "slack", register: "pro", text: "x" },
      accept: () => {
        accepted = true;
      },
    });

    await tick();
    expect(accepted).toBe(false);
    expect(calls).toBe(0);
  });
});
