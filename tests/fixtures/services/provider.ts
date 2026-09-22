import {
  provideService,
  type ServiceHost,
  type ServiceRegistration,
} from "../../../packages/services/src/index.ts";
import { assertEchoRequest, echoContract, type EchoApi, type EchoResult } from "./contract.ts";

export interface FixtureProvider {
  registration: ServiceRegistration;
  releaseNext(value?: unknown): void;
  activeCount(): number;
}

function abortError(): Error {
  const error = new Error("operation aborted");
  error.name = "AbortError";
  return error;
}

export function createEchoProvider(host: ServiceHost, consumer = "provider"): FixtureProvider {
  const lifetime = new AbortController();
  const waiters = new Set<() => void>();
  const releaseNext = (): void => {
    const [release] = waiters;
    release?.();
  };
  const api: EchoApi & { failSync?: () => Promise<EchoResult> } = {
    async echo(request) {
      assertEchoRequest(request);
      if (request.text === "throw") throw new Error("fixture failure");
      const signal = request.signal;
      if (signal?.aborted || lifetime.signal.aborted) throw abortError();
      await new Promise<void>((resolve, reject) => {
        const cleanup = (): void => {
          waiters.delete(done);
          signal?.removeEventListener("abort", onAbort);
          lifetime.signal.removeEventListener("abort", onAbort);
        };
        const done = (): void => {
          cleanup();
          resolve();
        };
        const onAbort = (): void => {
          cleanup();
          reject(abortError());
        };
        waiters.add(done);
        signal?.addEventListener("abort", onAbort, { once: true });
        lifetime.signal.addEventListener("abort", onAbort, { once: true });
      });
      return { text: request.text.toUpperCase(), consumer };
    },
  };
  const registration = provideService(
    host,
    { id: echoContract.id, apiMajor: 1, api },
    {
      onDispose: () => {
        lifetime.abort();
        for (const release of [...waiters]) release();
      },
    },
  );
  return { registration, releaseNext, activeCount: () => waiters.size };
}
