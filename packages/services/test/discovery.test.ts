import { describe, expect, test } from "bun:test";
import {
  discoverService,
  discoveryChannel,
  isServiceError,
  type EventBus,
  type ServiceContract,
} from "../src/index.ts";

interface EchoApi {
  echo(text: string): Promise<string>;
}

const contract: ServiceContract<EchoApi> = {
  id: "birdcar.test.echo",
  apiMajor: 1,
  isApi(value): value is EchoApi {
    return !!value && typeof value === "object" && typeof (value as EchoApi).echo === "function";
  },
};

class Bus implements EventBus {
  listeners = new Map<string, Array<(payload: unknown) => void>>();
  emit(channel: string, payload: unknown): void {
    for (const listener of this.listeners.get(channel) ?? []) listener(payload);
  }
  on(channel: string, handler: (payload: unknown) => void): () => void {
    const listeners = this.listeners.get(channel) ?? [];
    listeners.push(handler);
    this.listeners.set(channel, listeners);
    return () =>
      this.listeners.set(
        channel,
        listeners.filter((item) => item !== handler),
      );
  }
}

function offer(bus: Bus, descriptor: unknown): void {
  bus.on(discoveryChannel(contract.id), (payload) => {
    (payload as { offer(value: unknown): void }).offer(descriptor);
  });
}

function expectCode(action: () => unknown, code: string): void {
  expect(action).toThrow();
  try {
    action();
  } catch (error) {
    expect(isServiceError(error)).toBe(true);
    expect((error as { code: string }).code).toBe(code);
  }
}

describe("discoverService", () => {
  test("returns undefined when no provider responds", () => {
    expect(discoverService(new Bus(), contract)).toBeUndefined();
  });

  test("returns exactly one compatible API", async () => {
    const bus = new Bus();
    offer(bus, { id: contract.id, apiMajor: 1, api: { echo: async (text: string) => text } });
    const api = discoverService(bus, contract);
    expect(await api?.echo("ok")).toBe("ok");
  });

  test("reports incompatible majors and accepts different alternate-major shapes", () => {
    const bus = new Bus();
    offer(bus, { id: contract.id, apiMajor: 2, api: { other: () => "ignored" } });
    expectCode(() => discoverService(bus, contract), "SERVICE_INCOMPATIBLE");
  });

  test("malformed offers win over valid offers", () => {
    const bus = new Bus();
    offer(bus, { id: contract.id, apiMajor: 1, api: { echo: async () => "ok" } });
    offer(bus, { id: contract.id, apiMajor: 1, api: {} });
    expectCode(() => discoverService(bus, contract), "SERVICE_CONTRACT");
  });

  test("reports duplicate compatible providers independent of order", () => {
    const bus = new Bus();
    offer(bus, { id: contract.id, apiMajor: 1, api: { echo: async () => "a" } });
    offer(bus, { id: contract.id, apiMajor: 1, api: { echo: async () => "b" } });
    expectCode(() => discoverService(bus, contract), "SERVICE_AMBIGUOUS");
  });

  test("normalizes validator throws into contract errors", () => {
    const bus = new Bus();
    offer(bus, { id: contract.id, apiMajor: 1, api: { echo: async () => "a" } });
    expectCode(
      () =>
        discoverService(bus, {
          ...contract,
          isApi: (_value: unknown): _value is EchoApi => {
            throw new Error("boom");
          },
        }),
      "SERVICE_CONTRACT",
    );
  });

  test("ignores late asynchronous offers", async () => {
    const bus = new Bus();
    bus.on(discoveryChannel(contract.id), (payload) => {
      queueMicrotask(() =>
        (payload as { offer(value: unknown): void }).offer({
          id: contract.id,
          apiMajor: 1,
          api: { echo: async () => "late" },
        }),
      );
      setTimeout(
        () =>
          (payload as { offer(value: unknown): void }).offer({
            id: contract.id,
            apiMajor: 1,
            api: { echo: async () => "late" },
          }),
        0,
      );
    });
    expect(discoverService(bus, contract)).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(discoverService(new Bus(), contract)).toBeUndefined();
  });

  test("closes accepting window when the injected bus throws", () => {
    const events: EventBus = {
      on: () => () => undefined,
      emit: (_channel, payload) => {
        (payload as { offer(value: unknown): void }).offer({
          id: contract.id,
          apiMajor: 1,
          api: { echo: async () => "ok" },
        });
        throw new Error("bus failure");
      },
    };
    expect(() => discoverService(events, contract)).toThrow("bus failure");
  });
});
