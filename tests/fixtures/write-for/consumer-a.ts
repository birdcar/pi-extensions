import { discoverService, type EventBus, type ServiceContract } from "@birdcar/pi-services";
import {
  writeForContract,
  type DraftRequest,
  type WriteForApi,
} from "@birdcar/pi-write-for/contract";

export const draftContract: ServiceContract<WriteForApi> = writeForContract;

export async function draftFor(events: EventBus, subject: string): Promise<string> {
  const api = discoverService(events, writeForContract);
  if (!api) return "write-for unavailable";
  const request: DraftRequest = { channel: "email", register: "professional", subject };
  return (await api.draft(request)).text;
}
