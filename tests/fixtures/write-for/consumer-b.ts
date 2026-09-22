import type { RewriteRequest, WriteForApi, WritingResult } from "@birdcar/pi-write-for/contract";

export function rewriteFor(api: WriteForApi, text: string): Promise<WritingResult> {
  const request: RewriteRequest = {
    channel: "slack",
    register: "internal",
    text,
    instruction: "Make it shorter.",
  };
  return api.rewrite(request);
}
