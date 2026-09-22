import {
  discoveryChannel,
  type DiscoveryRequest,
  type ServiceDescriptor,
  type ServiceHost,
  type ServiceRegistration,
} from "./contracts.js";
import { assertDescriptorShape } from "./discovery.js";
import { createServiceError } from "./errors.js";

type AnyMethod = (this: object, ...args: unknown[]) => unknown;

function isRequest(value: unknown): value is DiscoveryRequest {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { offer?: unknown }).offer === "function"
  );
}

export function provideService<TApi extends object>(
  host: ServiceHost,
  descriptor: ServiceDescriptor<TApi>,
  options: { onDispose?: () => void | Promise<void> } = {},
): ServiceRegistration {
  assertDescriptorShape<TApi>(descriptor);
  let disposed = false;
  let disposePromise: Promise<void> | undefined;

  const wrappedEntries = Object.entries(Object.getOwnPropertyDescriptors(descriptor.api)).map(
    ([name, property]) => {
      const method = property.value as AnyMethod;
      const wrapped = (...args: unknown[]) => {
        if (disposed) {
          return Promise.reject(
            createServiceError("SERVICE_DISPOSED", "service provider has been disposed", {
              serviceId: descriptor.id,
              requestedMajor: descriptor.apiMajor,
            }),
          );
        }
        try {
          return Promise.resolve(method.apply(descriptor.api, args));
        } catch (error) {
          return Promise.reject(error);
        }
      };
      return [name, { enumerable: true, configurable: false, writable: false, value: wrapped }];
    },
  );
  const guardedApi = Object.create(null) as TApi;
  Object.defineProperties(guardedApi, Object.fromEntries(wrappedEntries));
  const guardedDescriptor: ServiceDescriptor<TApi> = {
    id: descriptor.id,
    apiMajor: descriptor.apiMajor,
    api: guardedApi,
  };

  const unsubscribe = host.events.on(discoveryChannel(descriptor.id), (payload) => {
    if (disposed || !isRequest(payload)) return;
    payload.offer(guardedDescriptor);
  });

  const dispose = async (): Promise<void> => {
    if (disposePromise) return disposePromise;
    disposed = true;
    unsubscribe();
    disposePromise = Promise.resolve().then(async () => {
      await options.onDispose?.();
    });
    return disposePromise;
  };

  host.on("session_shutdown", dispose);
  return { dispose };
}
