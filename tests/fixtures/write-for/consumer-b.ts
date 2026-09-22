import { discoverService, type EventBus } from "@birdcar/pi-services";
import type { RewriteRequest, WritingResult } from "@birdcar/pi-write-for/contract";
import { writeForContract } from "@birdcar/pi-write-for/contract";

export async function rewriteFor(
  events: EventBus,
  text: string,
): Promise<WritingResult | undefined> {
  const api = discoverService(events, writeForContract);
  if (!api) return undefined;
  const request: RewriteRequest = {
    channel: "slack",
    register: "internal",
    text,
    instruction: "Make it shorter.",
  };
  return api.rewrite(request);
}
