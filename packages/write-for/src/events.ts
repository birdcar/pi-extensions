import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverService } from "@birdcar/pi-services";
import {
  WRITE_FOR_REWRITE_EVENT,
  type RewriteEventRequest,
  type RewriteRequest,
  writeForContract,
} from "./contract.js";
import { createWriteForError } from "./errors.js";

function isRewriteRequest(value: unknown): value is RewriteRequest {
  return !!value && typeof value === "object";
}

function diagnostic(pi: ExtensionAPI, message: string): void {
  try {
    pi.sendMessage?.({
      customType: "birdcar.write-for.diagnostic",
      content: message,
      display: false,
    });
  } catch {
    // Diagnostics must never expose source text or break event delivery.
  }
}

function composeSignals(adapterSignal: AbortSignal, callerSignal?: AbortSignal): AbortSignal {
  if (!callerSignal) return adapterSignal;
  const anySignal = (
    AbortSignal as typeof AbortSignal & {
      any?: (signals: AbortSignal[]) => AbortSignal;
    }
  ).any;
  if (typeof anySignal === "function") return anySignal([adapterSignal, callerSignal]);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (adapterSignal.aborted || callerSignal.aborted) abort();
  else {
    adapterSignal.addEventListener("abort", abort, { once: true });
    callerSignal.addEventListener("abort", abort, { once: true });
  }
  return controller.signal;
}

export function registerWriteForEvents(pi: ExtensionAPI): () => void {
  return pi.events.on(WRITE_FOR_REWRITE_EVENT, (payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      diagnostic(pi, "write-for rewrite event payload must be an object");
      return;
    }
    const envelope = payload as Partial<RewriteEventRequest>;
    if (typeof envelope.accept !== "function" || !isRewriteRequest(envelope.request)) {
      diagnostic(pi, "write-for rewrite event payload is missing request or accept callback");
      return;
    }
    let controller: AbortController | undefined;
    try {
      const service = discoverService(pi.events, writeForContract);
      if (!service) throw createWriteForError("NOT_READY", "write-for service is unavailable");
      controller = new AbortController();
      const request = {
        ...envelope.request,
        signal: composeSignals(controller.signal, envelope.request.signal),
      };
      const completion = Promise.resolve().then(() => service.rewrite(request));
      completion.catch(() => undefined);
      try {
        envelope.accept(completion);
      } catch {
        controller.abort();
        diagnostic(pi, "write-for rewrite event accept callback failed");
      }
    } catch (error) {
      controller?.abort();
      const completion = Promise.reject(error);
      completion.catch(() => undefined);
      try {
        envelope.accept(completion);
      } catch {
        diagnostic(pi, "write-for rewrite event accept callback failed");
      }
    }
  });
}
