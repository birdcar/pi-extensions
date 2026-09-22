import {
  discoveryChannel,
  type EventBus,
  type ServiceContract,
  type ServiceDescriptor,
} from "./contracts.js";
import { createServiceError } from "./errors.js";

const SERVICE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z][a-z0-9]*)+$/u;

export function assertServiceId(id: unknown, label = "service id"): asserts id is string {
  if (typeof id !== "string" || !SERVICE_ID_PATTERN.test(id)) {
    throw createServiceError("SERVICE_CONTRACT", `${label} must be a nonempty namespaced id`);
  }
}

export function assertApiMajor(apiMajor: unknown, serviceId?: string): asserts apiMajor is number {
  if (typeof apiMajor !== "number" || !Number.isSafeInteger(apiMajor) || apiMajor <= 0) {
    throw createServiceError(
      "SERVICE_CONTRACT",
      "service apiMajor must be a positive safe integer",
      {
        serviceId,
      },
    );
  }
}

export function assertContract<TApi extends object>(
  contract: ServiceContract<TApi>,
): asserts contract is ServiceContract<TApi> {
  if (!contract || typeof contract !== "object") {
    throw createServiceError("SERVICE_CONTRACT", "service contract must be an object");
  }
  assertServiceId(contract.id);
  assertApiMajor(contract.apiMajor, contract.id);
  if (typeof contract.isApi !== "function") {
    throw createServiceError("SERVICE_CONTRACT", "service contract must provide isApi", {
      serviceId: contract.id,
      requestedMajor: contract.apiMajor,
    });
  }
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function validateServiceApi(api: unknown, serviceId: string): asserts api is object {
  const record = objectRecord(api);
  if (!record) {
    throw createServiceError("SERVICE_CONTRACT", "service api must be an object", { serviceId });
  }
  const entries = Object.entries(Object.getOwnPropertyDescriptors(api));
  if (entries.length === 0) {
    throw createServiceError("SERVICE_CONTRACT", "service api must expose at least one method", {
      serviceId,
    });
  }
  for (const [name, descriptor] of entries) {
    if (
      name === "__proto__" ||
      typeof descriptor.value !== "function" ||
      descriptor.get ||
      descriptor.set
    ) {
      throw createServiceError(
        "SERVICE_CONTRACT",
        `service api property ${name} must be an own callable data property`,
        { serviceId },
      );
    }
  }
}

export function assertDescriptorShape<TApi extends object>(
  descriptor: unknown,
): asserts descriptor is ServiceDescriptor<TApi> {
  const record = objectRecord(descriptor);
  if (!record) throw createServiceError("SERVICE_CONTRACT", "service descriptor must be an object");
  assertServiceId(record.id);
  assertApiMajor(record.apiMajor, record.id);
  validateServiceApi(record.api, record.id);
}

export function discoverService<TApi extends object>(
  events: EventBus,
  contract: ServiceContract<TApi>,
): TApi | undefined {
  assertContract(contract);
  const offers: unknown[] = [];
  let accepting = true;
  try {
    events.emit(discoveryChannel(contract.id), {
      offer: (descriptor: unknown) => {
        if (accepting) offers.push(descriptor);
      },
    });
  } finally {
    accepting = false;
  }

  if (offers.length === 0) return undefined;

  const matching: ServiceDescriptor<TApi>[] = [];
  let sawDifferentMajor = false;
  for (const offer of offers) {
    assertDescriptorShape<TApi>(offer);
    if (offer.id !== contract.id) {
      throw createServiceError("SERVICE_CONTRACT", "service descriptor id did not match request", {
        serviceId: contract.id,
        requestedMajor: contract.apiMajor,
      });
    }
    if (offer.apiMajor !== contract.apiMajor) {
      sawDifferentMajor = true;
      continue;
    }
    let valid = false;
    try {
      valid = contract.isApi(offer.api);
    } catch (cause) {
      throw createServiceError(
        "SERVICE_CONTRACT",
        `service api validator failed: ${String(cause)}`,
        { serviceId: contract.id, requestedMajor: contract.apiMajor },
      );
    }
    if (!valid) {
      throw createServiceError("SERVICE_CONTRACT", "service api failed contract validation", {
        serviceId: contract.id,
        requestedMajor: contract.apiMajor,
      });
    }
    matching.push(offer);
  }

  if (matching.length === 0 && sawDifferentMajor) {
    throw createServiceError(
      "SERVICE_INCOMPATIBLE",
      "no provider matched requested service major",
      {
        serviceId: contract.id,
        requestedMajor: contract.apiMajor,
      },
    );
  }
  if (matching.length > 1) {
    throw createServiceError("SERVICE_AMBIGUOUS", "multiple compatible providers responded", {
      serviceId: contract.id,
      requestedMajor: contract.apiMajor,
    });
  }
  return matching[0]?.api;
}
