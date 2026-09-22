import type { ServiceContract } from "@birdcar/pi-services";
import {
  writeForContract,
  type DraftRequest,
  type WriteForApi,
} from "@birdcar/pi-write-for/contract";

export const draftContract: ServiceContract<WriteForApi> = writeForContract;

export async function draftFor(api: WriteForApi, subject: string): Promise<string> {
  const request: DraftRequest = { channel: "email", register: "professional", subject };
  return (await api.draft(request)).text;
}
