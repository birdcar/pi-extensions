import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  WRITE_FOR_REWRITE_EVENT,
  type RewriteEventRequest,
  type WritingResult,
} from "@birdcar/pi-write-for/contract";

export default function rewriteEmail(pi: ExtensionAPI) {
  pi.registerCommand("rewrite-email", {
    description: "Rewrite text as an email and review it in the editor",
    async handler(args, ctx) {
      if (!ctx.hasUI) throw new Error("rewrite-email requires Pi UI/RPC");

      let completion: Promise<WritingResult> | undefined;
      const payload: RewriteEventRequest = {
        request: {
          channel: "email",
          register: "professional",
          text: args,
          instruction: "Make the next step clear.",
          rules: ["Use a reassuring tone; avoid jokes."],
        },
        accept(pending) {
          completion = pending;
        },
      };

      try {
        pi.events.emit(WRITE_FOR_REWRITE_EVENT, payload);
        if (!completion) {
          ctx.ui.notify("Pi Write For is not loaded; no rewrite was requested.", "warning");
          return;
        }
        const result = await completion;
        ctx.ui.setEditorText(result.text);
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}
