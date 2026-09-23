export interface FakeWriterModelState {
  calls: Array<{ model: unknown; context: unknown }>;
  nextText?: string;
  hangNext?: boolean;
  aborts?: Array<{ name: string }>;
}

export function createFakeWriterModelRuntime(state: FakeWriterModelState) {
  const model = {
    provider: "fixture",
    id: "writer",
    name: "Fixture Writer",
    api: "openai-chat",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0 },
    contextWindow: 50_000,
    maxTokens: 4096,
  };
  const explicitModel = { ...model, id: "explicit", name: "Explicit Fixture Writer" };
  return {
    model,
    explicitModel,
    runtime: {
      find(provider: string, id: string) {
        return this.getModel(provider, id);
      },
      getModel(provider: string, id: string) {
        return provider === "fixture" && id === "writer"
          ? model
          : provider === "fixture" && id === "explicit"
            ? explicitModel
            : undefined;
      },
      getModels() {
        return [model, explicitModel];
      },
      getAvailableSnapshot() {
        return [model, explicitModel];
      },
      getAvailable() {
        return Promise.resolve([model, explicitModel]);
      },
      hasConfiguredAuth(modelOrProvider: string | { provider?: string }) {
        return (
          (typeof modelOrProvider === "string" ? modelOrProvider : modelOrProvider.provider) ===
          "fixture"
        );
      },
      checkAuth(provider: string) {
        return Promise.resolve(provider === "fixture");
      },
      complete(selected: unknown, context: unknown, options?: { signal?: AbortSignal }) {
        return this.completeSimple(selected, context, options);
      },
      completeSimple(selected: unknown, context: unknown, options?: { signal?: AbortSignal }) {
        state.calls.push({ model: selected, context });
        const abortError = () => {
          const error = new Error("cancelled");
          error.name = "AbortError";
          return error;
        };
        if (options?.signal?.aborted) return Promise.reject(abortError());
        if (state.hangNext) {
          state.hangNext = false;
          return new Promise((_, reject) => {
            const signal = options?.signal;
            if (!signal) return;
            const rejectAbort = () => {
              signal.removeEventListener("abort", rejectAbort);
              const error = abortError();
              state.aborts?.push({ name: error.name });
              reject(error);
            };
            signal.addEventListener("abort", rejectAbort, { once: true });
          });
        }
        return Promise.resolve({
          text: state.nextText ?? "fixture draft text",
          stopReason: "stop",
          usage: { input: 11, output: 7, cacheRead: 0, cacheWrite: 0 },
        });
      },
      registerProvider() {},
      unregisterProvider() {},
      getRegisteredProviderIds() {
        return [];
      },
      getRegisteredProviderConfig() {
        return undefined;
      },
      refresh() {
        return Promise.resolve({ added: [], removed: [], updated: [] });
      },
      getError() {
        return undefined;
      },
    },
  };
}
