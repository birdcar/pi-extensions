import { describe, expect, test } from "bun:test";
import {
  discoverService,
  discoveryChannel,
  isServiceError,
  provideService,
  type EventBus,
  type ServiceHost,
} from "../src/index.ts";
import { echoContract } from "../../../tests/fixtures/services/contract.ts";
import { createEchoProvider } from "../../../tests/fixtures/services/provider.ts";
import { runConsumerA } from "../../../tests/fixtures/services/consumer-a.ts";
import { runConsumerB } from "../../../tests/fixtures/services/consumer-b.ts";

class Host implements ServiceHost {
  events: EventBus;
  shutdowns: Array<() => void | Promise<void>> = [];
  private listeners = new Map<string, Array<(payload: unknown) => void>>();
  constructor() {
    this.events = {
      emit: (channel, payload) => {
        for (const listener of this.listeners.get(channel) ?? []) listener(payload);
      },
      on: (channel, handler) => {
        const list = this.listeners.get(channel) ?? [];
        list.push(handler);
        this.listeners.set(channel, list);
        return () =>
          this.listeners.set(
            channel,
            list.filter((item) => item !== handler),
          );
      },
    };
  }
  on(event: "session_shutdown", handler: () => void | Promise<void>): void {
    if (event === "session_shutdown") this.shutdowns.push(handler);
  }
  count(channel: string): number {
    return this.listeners.get(channel)?.length ?? 0;
  }
  async shutdown(): Promise<void> {
    await Promise.all(this.shutdowns.map((handler) => handler()));
  }
}

describe("provideService and fixture execution", () => {
  test("registers provider, preserves receiver, and serves consumers without identity registration", async () => {
    const host = new Host();
    const provider = createEchoProvider(host, "fixture");
    const a = runConsumerA(host.events, { text: "one" });
    const b = runConsumerB(host.events, { text: "two" });
    expect(provider.activeCount()).toBe(2);
    provider.releaseNext();
    provider.releaseNext();
    expect(await a).toEqual({
      available: true,
      consumer: "a",
      result: { text: "ONE", consumer: "fixture" },
    });
    expect(await b).toEqual({
      available: true,
      consumer: "b",
      result: { text: "TWO", consumer: "fixture" },
    });
  });

  test("missing provider is explicit unavailable and invocation failures propagate", async () => {
    const missing = await runConsumerA(new Host().events, { text: "x" });
    expect(missing).toEqual({ available: false, consumer: "a" });
    const host = new Host();
    createEchoProvider(host);
    await expect(runConsumerA(host.events, { text: "throw" })).rejects.toThrow("fixture failure");
  });

  test("cancellation is isolated per request and provider shutdown cancels active work", async () => {
    const host = new Host();
    const provider = createEchoProvider(host);
    const cancelled = new AbortController();
    const first = runConsumerA(host.events, { text: "first", signal: cancelled.signal });
    const second = runConsumerB(host.events, { text: "second" });
    cancelled.abort();
    await expect(first).rejects.toThrow("operation aborted");
    expect(provider.activeCount()).toBe(1);
    provider.releaseNext();
    expect((await second).available).toBe(true);

    const third = runConsumerA(host.events, { text: "third" });
    expect(provider.activeCount()).toBe(1);
    await host.shutdown();
    await expect(third).rejects.toThrow("operation aborted");
  });

  test("retained API objects and destructured methods reject after dispose", async () => {
    const host = new Host();
    const provider = createEchoProvider(host);
    const api = discoverService(host.events, echoContract);
    expect(api).toBeDefined();
    const echo = api!.echo;
    await provider.registration.dispose();
    await provider.registration.dispose();
    expect(host.count(discoveryChannel(echoContract.id))).toBe(0);
    await expect(api!.echo({ text: "x" })).rejects.toMatchObject({ code: "SERVICE_DISPOSED" });
    await expect(echo({ text: "x" })).rejects.toMatchObject({ code: "SERVICE_DISPOSED" });
  });

  test("guarded APIs do not expose inherited implementation methods", () => {
    const host = new Host();
    const rawApi = Object.create({ inherited: () => "unguarded" }) as {
      echo: () => Promise<{ text: string; consumer: string }>;
      inherited?: () => string;
    };
    rawApi.echo = async () => ({ text: "x", consumer: "x" });
    provideService(host, { id: echoContract.id, apiMajor: 1, api: rawApi });
    const api = discoverService(host.events, echoContract) as typeof rawApi | undefined;
    expect(api).toBeDefined();
    expect(Object.getPrototypeOf(api!)).toBeNull();
    expect(api!.inherited).toBeUndefined();
  });

  test("dispose is concurrent and reports cleanup failures without restoring callable state", async () => {
    const host = new Host();
    const registration = provideService(
      host,
      {
        id: echoContract.id,
        apiMajor: 1,
        api: { echo: async () => ({ text: "x", consumer: "x" }) },
      },
      {
        onDispose: () => {
          throw new Error("cleanup failed");
        },
      },
    );
    const api = discoverService(host.events, echoContract)!;
    const [a, b] = await Promise.allSettled([registration.dispose(), registration.dispose()]);
    expect(a.status).toBe("rejected");
    expect(b.status).toBe("rejected");
    try {
      await api.echo({ text: "x" });
      throw new Error("expected disposed service call to fail");
    } catch (error) {
      expect(isServiceError(error)).toBe(true);
    }
  });

  test("ignores unknown discovery requests", () => {
    const host = new Host();
    createEchoProvider(host);
    expect(() => host.events.emit(discoveryChannel(echoContract.id), {})).not.toThrow();
  });
});
