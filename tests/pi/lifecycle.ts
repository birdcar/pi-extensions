import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  createEventBus,
  type EventBus,
  type ExtensionAPI,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  discoverService,
  provideService,
  isServiceError,
  type ServiceContract,
  type ServiceHost,
} from "../../packages/services/dist/index.js";

interface EchoApi {
  echo(input: { text: string; signal?: AbortSignal }): Promise<{ text: string }>;
}

type ExtensionFactory = (pi: ExtensionAPI) => void;

const contract: ServiceContract<EchoApi> = {
  id: "birdcar.test.echo",
  apiMajor: 1,
  isApi(value): value is EchoApi {
    return !!value && typeof value === "object" && typeof (value as EchoApi).echo === "function";
  },
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function abortError(): Error {
  const error = new Error("operation aborted");
  error.name = "AbortError";
  return error;
}

function createProviderFactory(): ExtensionFactory {
  return (pi) => {
    const lifetime = new AbortController();
    const api: EchoApi = {
      echo(input) {
        if (lifetime.signal.aborted || input.signal?.aborted) return Promise.reject(abortError());
        if (input.text === "active") {
          return new Promise((resolve, reject) => {
            const cleanup = () => {
              lifetime.signal.removeEventListener("abort", onAbort);
              input.signal?.removeEventListener("abort", onAbort);
            };
            const onAbort = () => {
              cleanup();
              reject(abortError());
            };
            lifetime.signal.addEventListener("abort", onAbort, { once: true });
            input.signal?.addEventListener("abort", onAbort, { once: true });
            void resolve;
          });
        }
        return Promise.resolve({ text: input.text.toUpperCase() });
      },
    };
    provideService(
      pi as ServiceHost,
      { id: contract.id, apiMajor: contract.apiMajor, api },
      { onDispose: () => lifetime.abort() },
    );
  };
}

function createConsumerFactory(startupDiscoveries: string[]): ExtensionFactory {
  return (pi) => {
    pi.on("session_start", () => {
      const api = discoverService(pi.events, contract);
      startupDiscoveries.push(api ? "available" : "missing");
    });
  };
}

async function assertStale(api: EchoApi, method: EchoApi["echo"]): Promise<void> {
  for (const call of [() => api.echo({ text: "old" }), () => method({ text: "old" })]) {
    try {
      await call();
      throw new Error("expected stale handle rejection");
    } catch (error) {
      assert(
        isServiceError(error) && error.code === "SERVICE_DISPOSED",
        "stale handle rejected structurally",
      );
    }
  }
}

async function expectAbort(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
    throw new Error("expected active operation to be aborted");
  } catch (error) {
    assert(error instanceof Error && error.name === "AbortError", "active operation aborted");
  }
}

async function createRuntime(dir: string, eventBus: EventBus, factories: ExtensionFactory[]) {
  const cwd = join(dir, "cwd");
  const agentDir = join(dir, "agent");
  const sessionDir = join(dir, "sessions");
  await Promise.all([
    mkdir(cwd, { recursive: true }),
    mkdir(agentDir, { recursive: true }),
    mkdir(sessionDir, { recursive: true }),
  ]);
  const createRuntime: CreateAgentSessionRuntimeFactory = async ({
    cwd: runtimeCwd,
    sessionManager,
    sessionStartEvent,
  }) => {
    const services = await createAgentSessionServices({
      cwd: runtimeCwd,
      agentDir,
      settingsManager: SettingsManager.inMemory(
        { cacheWarming: "off", packages: [], extensions: [], skills: [], prompts: [], themes: [] },
        { projectTrusted: true },
      ),
      resourceLoaderOptions: {
        eventBus,
        extensionFactories: factories,
        additionalExtensionPaths: [],
        additionalSkillPaths: [],
        additionalPromptTemplatePaths: [],
        additionalThemePaths: [],
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
      },
    });
    return {
      ...(await createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent,
        noTools: "all",
      })),
      services,
      diagnostics: services.diagnostics,
    };
  };
  return createAgentSessionRuntime(createRuntime, {
    cwd,
    agentDir,
    sessionManager: SessionManager.create(cwd, sessionDir),
  });
}

async function bindCurrentSession(
  runtime: Awaited<ReturnType<typeof createRuntime>>,
): Promise<void> {
  await runtime.session.bindExtensions({});
}

async function runOrder(name: string, factories: ExtensionFactory[]): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), `pi-services-lifecycle-${name}-`));
  const eventBus = createEventBus();
  const runtime = await createRuntime(dir, eventBus, factories);
  try {
    await bindCurrentSession(runtime);
    assert(discoverService(eventBus, contract), `${name}: provider discovered after startup`);
    let api = discoverService(eventBus, contract);
    assert(api, `${name}: single compatible provider after startup`);
    let retained = api.echo;
    assert((await api.echo({ text: "fresh" })).text === "FRESH", `${name}: fresh call succeeds`);

    for (let index = 0; index < 2; index += 1) {
      const active = api.echo({ text: "active" });
      active.catch(() => undefined);
      await runtime.session.reload();
      await expectAbort(active);
      await assertStale(api, retained);
      api = discoverService(eventBus, contract);
      assert(api, `${name}: provider discovered after reload ${index}`);
      retained = api.echo;
      assert(
        (await api.echo({ text: `reload-${index}` })).text === `RELOAD-${index}`,
        `${name}: fresh reload provider works ${index}`,
      );
    }

    const beforeNewSession = api;
    const beforeNewSessionMethod = retained;
    await runtime.newSession();
    await bindCurrentSession(runtime);
    await assertStale(beforeNewSession, beforeNewSessionMethod);
    api = discoverService(eventBus, contract);
    assert(api, `${name}: provider discovered after newSession`);
    assert((await api.echo({ text: "new" })).text === "NEW", `${name}: new session provider works`);
  } finally {
    await runtime.dispose();
    eventBus.clear();
    await rm(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const missingDir = await mkdtemp(join(tmpdir(), "pi-services-lifecycle-missing-"));
  const missingBus = createEventBus();
  const missingRuntime = await createRuntime(missingDir, missingBus, [createConsumerFactory([])]);
  try {
    await bindCurrentSession(missingRuntime);
    assert(
      discoverService(missingBus, contract) === undefined,
      "consumer-only runtime has no service",
    );
  } finally {
    await missingRuntime.dispose();
    missingBus.clear();
    await rm(missingDir, { recursive: true, force: true });
  }

  const providerFirstDiscoveries: string[] = [];
  await runOrder("provider-first", [
    createProviderFactory(),
    createConsumerFactory(providerFirstDiscoveries),
  ]);
  assert(
    providerFirstDiscoveries.every((state) => state === "available"),
    "provider-first consumer saw provider at startup",
  );

  const consumerFirstDiscoveries: string[] = [];
  await runOrder("consumer-first", [
    createConsumerFactory(consumerFirstDiscoveries),
    createProviderFactory(),
  ]);
  assert(
    consumerFirstDiscoveries.every((state) => state === "available"),
    "consumer-first consumer saw provider after normal startup",
  );
}

await main();
console.log("pi lifecycle proof passed");
