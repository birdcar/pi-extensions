import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { provideService, type ServiceRegistration } from "@birdcar/pi-services";
import {
  WRITE_FOR_API_MAJOR,
  WRITE_FOR_SERVICE_ID,
  type DraftRequest,
  type RewriteRequest,
  type WriteForApi,
  type WritingResult,
  explainInvalidWritingRequest,
} from "./contract.js";
import { createWritingEngine, type WritingEngine, type WritingEngineOptions } from "./engine.js";
import { createWriteForError } from "./errors.js";

export interface WriteForServiceRegistration {
  dispose(): Promise<void>;
  api: WriteForApi;
}

function combineSignals(signals: Array<AbortSignal | undefined>): {
  signal: AbortSignal;
  dispose(): void;
} {
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose() {
      for (const signal of signals) signal?.removeEventListener("abort", abort);
    },
  };
}

export function registerWriteForService(
  pi: ExtensionAPI,
  options: WritingEngineOptions = {},
): WriteForServiceRegistration {
  const engine: WritingEngine = createWritingEngine(options);
  const lifetime = new AbortController();
  let activeContext: ExtensionContext | undefined;
  let disposed = false;

  pi.on("session_start", (_event, ctx) => {
    activeContext = ctx;
  });
  pi.on("session_shutdown", () => {
    activeContext = undefined;
  });

  const withContext = async <T extends DraftRequest | RewriteRequest>(
    request: T,
    kind: "draft" | "rewrite",
    run: (ctx: ExtensionContext, request: T) => Promise<WritingResult>,
  ) => {
    const invalid = explainInvalidWritingRequest(request, kind);
    if (invalid) throw createWriteForError("INVALID_REQUEST", invalid);
    if (disposed || lifetime.signal.aborted)
      throw createWriteForError("NOT_READY", "write-for service is not available");
    const ctx = activeContext;
    if (!ctx)
      throw createWriteForError("NOT_READY", "write-for service is not ready until session_start");
    const combined = combineSignals([lifetime.signal, request.signal]);
    try {
      return await run(ctx, { ...request, signal: combined.signal });
    } finally {
      combined.dispose();
    }
  };

  const api: WriteForApi = Object.create(null) as WriteForApi;
  Object.defineProperties(api, {
    draft: {
      enumerable: true,
      value: (request: DraftRequest) =>
        withContext(request, "draft", (ctx, req) => engine.draft(ctx, req as DraftRequest)),
    },
    rewrite: {
      enumerable: true,
      value: (request: RewriteRequest) =>
        withContext(request, "rewrite", (ctx, req) => engine.rewrite(ctx, req as RewriteRequest)),
    },
  });

  const registration: ServiceRegistration = provideService(
    pi,
    { id: WRITE_FOR_SERVICE_ID, apiMajor: WRITE_FOR_API_MAJOR, api },
    {
      onDispose: () => {
        disposed = true;
        activeContext = undefined;
        lifetime.abort();
      },
    },
  );

  return { api, dispose: () => registration.dispose() };
}
