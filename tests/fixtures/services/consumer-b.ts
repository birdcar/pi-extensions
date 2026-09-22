import { discoverService, type EventBus } from "../../../packages/services/src/index.ts";
import { echoContract, type EchoRequest, type EchoResult } from "./contract.ts";

export type ConsumerOutcome =
  | { available: false; consumer: "b" }
  | { available: true; consumer: "b"; result: EchoResult };

export async function runConsumerB(
  events: EventBus,
  request: EchoRequest,
): Promise<ConsumerOutcome> {
  const service = discoverService(events, echoContract);
  if (!service) return { available: false, consumer: "b" };
  return { available: true, consumer: "b", result: await service.echo(request) };
}
