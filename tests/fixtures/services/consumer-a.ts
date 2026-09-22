import { discoverService, type EventBus } from "../../../packages/services/src/index.ts";
import { echoContract, type EchoRequest, type EchoResult } from "./contract.ts";

export type ConsumerOutcome =
  | { available: false; consumer: "a" }
  | { available: true; consumer: "a"; result: EchoResult };

export async function runConsumerA(
  events: EventBus,
  request: EchoRequest,
): Promise<ConsumerOutcome> {
  const service = discoverService(events, echoContract);
  if (!service) return { available: false, consumer: "a" };
  return { available: true, consumer: "a", result: await service.echo(request) };
}
