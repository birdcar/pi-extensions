import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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
import { discoverService, isServiceError } from "../../packages/services/dist/index.js";
import writeForExtension from "../../packages/write-for/dist/index.js";
import {
  WRITE_FOR_REWRITE_EVENT,
  writeForContract,
  type WriteForApi,
} from "../../packages/write-for/dist/contract.js";
import { createFakeWriterModelRuntime } from "../fixtures/write-for/provider.js";

type ExtensionFactory = (pi: ExtensionAPI) => void;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertDisposed(error: unknown, message: string): void {
  assert(isServiceError(error) && error.code === "SERVICE_DISPOSED", message);
}

function assertCancelled(error: unknown, message: string): void {
  assert(
    error instanceof Error &&
      (error.name === "AbortError" ||
        (error.name === "WriteForError" && /cancelled|abort/i.test(error.message))),
    `${message}: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
  );
}

function countTools(runtime: Awaited<ReturnType<typeof createRuntime>>, name: string): number {
  return runtime.session.getAllTools().filter((tool: { name?: string }) => tool.name === name)
    .length;
}

function countCommands(runtime: Awaited<ReturnType<typeof createRuntime>>, name: string): number {
  const runner = (
    runtime.session as unknown as {
      _extensionRunner?: { getRegisteredCommands?: () => Array<{ invocationName?: string }> };
    }
  )._extensionRunner;
  return (
    runner?.getRegisteredCommands?.().filter((command) => command.invocationName === name).length ??
    0
  );
}

async function snapshotFiles(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  async function visit(dir: string, prefix = ""): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries.sort()) {
      const path = join(dir, entry);
      const relative = prefix ? `${prefix}/${entry}` : entry;
      const info = await stat(path);
      if (info.isDirectory()) await visit(path, relative);
      else if (info.isFile()) files.set(relative, await readFile(path, "utf8"));
    }
  }
  await visit(root);
  return files;
}

function assertSnapshotsEqual(
  before: Map<string, string>,
  after: Map<string, string>,
  message: string,
): void {
  assert(before.size === after.size, message);
  for (const [path, contents] of before) {
    assert(after.get(path) === contents, `${message}: ${path}`);
  }
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

async function writeProfile(root: string, explicitModel = false): Promise<void> {
  await Promise.all([
    mkdir(join(root, "registers"), { recursive: true }),
    mkdir(join(root, "channels"), { recursive: true }),
  ]);
  await writeFile(
    join(root, "style.md"),
    explicitModel
      ? "---\nmodel: fixture/explicit\n---\nBe concise and concrete.\n"
      : "Be concise and concrete.\n",
  );
  await writeFile(
    join(root, "registers", "professional.md"),
    "Use a helpful professional voice.\n",
  );
  await writeFile(
    join(root, "channels", "email.md"),
    "---\ndefaultRegister: professional\n---\nReturn a complete email draft.\n",
  );
}

function createConsumerFactory(states: string[]): ExtensionFactory {
  return (pi) => {
    pi.on("session_start", () => {
      states.push(discoverService(pi.events, writeForContract) ? "available" : "missing");
    });
  };
}

function createScriptedUi(confirmations: boolean[] = []) {
  return {
    notifications: [] as string[],
    async select(_title: string, options: string[]) {
      return options[0];
    },
    async confirm() {
      return confirmations.shift() ?? true;
    },
    async input(_title: string, placeholder?: string) {
      return placeholder ?? "approved";
    },
    notify(message: string) {
      this.notifications.push(message);
    },
    onTerminalInput() {
      return () => undefined;
    },
    setStatus() {},
    setWorkingMessage() {},
    setWorkingVisible() {},
    setWorkingIndicator() {},
    setHiddenThinkingLabel() {},
    setWidget() {},
    setFooter() {},
    setHeader() {},
    setTitle() {},
    async custom() {
      return undefined;
    },
    pasteToEditor() {},
    setEditorText() {},
    getEditorText() {
      return "";
    },
    async editor(_title: string, prefill?: string) {
      return prefill ?? "approved";
    },
    addAutocompleteProvider() {},
    setEditorComponent() {},
    getEditorComponent() {
      return undefined;
    },
    theme: {},
    getAllThemes() {
      return [];
    },
    getTheme() {
      return undefined;
    },
    setTheme() {
      return { success: true };
    },
    getToolsExpanded() {
      return false;
    },
    setToolsExpanded() {},
  };
}

async function createRuntime(
  dir: string,
  eventBus: EventBus,
  factories: ExtensionFactory[],
  fakeModel: { runtime: unknown; model: unknown; explicitModel?: unknown },
) {
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
      modelRuntime: fakeModel.runtime as never,
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
        model: fakeModel.model as never,
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

async function main(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pi-write-for-lifecycle-"));
  const profileRoot = join(dir, "profile");
  await writeProfile(profileRoot);
  const previousConfig = process.env.PI_WRITE_FOR_CONFIG;
  process.env.PI_WRITE_FOR_CONFIG = profileRoot;
  const eventBus = createEventBus();
  const listenerCounts = new Map<string, number>();
  const originalOn = eventBus.on.bind(eventBus);
  eventBus.on = (channel, handler) => {
    listenerCounts.set(channel, (listenerCounts.get(channel) ?? 0) + 1);
    const unsubscribe = originalOn(channel, handler);
    return () => {
      listenerCounts.set(channel, Math.max(0, (listenerCounts.get(channel) ?? 0) - 1));
      unsubscribe();
    };
  };
  const providerState: {
    calls: Array<{ model: unknown; context: unknown }>;
    nextText?: string;
    hangNext?: boolean;
    aborts?: Array<{ name: string }>;
  } = { calls: [], aborts: [] };
  const fakeModel = createFakeWriterModelRuntime(providerState);
  const beforeStates: string[] = [];
  const afterStates: string[] = [];
  let extensionState: ReturnType<typeof writeForExtension> | undefined;
  const writerFactory: ExtensionFactory = (pi) => {
    extensionState = writeForExtension(pi);
  };
  const runtime = await createRuntime(
    dir,
    eventBus,
    [createConsumerFactory(beforeStates), writerFactory, createConsumerFactory(afterStates)],
    fakeModel,
  );
  try {
    await runtime.session.bindExtensions({});
    const api = discoverService(eventBus, writeForContract);
    assert(api, "write-for service discovered from compiled extension");
    assert(beforeStates.includes("available"), "consumer loaded before writer observes service");
    assert(afterStates.includes("available"), "consumer loaded after writer observes service");

    const draft = await api.draft({ channel: "email", subject: "project update" });
    assert(draft.text === "fixture draft text", "draft uses fake provider text");
    assert(
      draft.model.provider === "fixture" && draft.model.id === "writer",
      "draft reports model",
    );
    assert(draft.usage.inputTokens === 11 && draft.usage.outputTokens === 7, "draft reports usage");

    let accepted: Promise<unknown> | undefined;
    eventBus.emit(WRITE_FOR_REWRITE_EVENT, {
      request: { channel: "email", text: "hello" },
      accept(value: Promise<unknown>) {
        accepted = value;
      },
    });
    const rewrite = (await accepted) as Awaited<ReturnType<WriteForApi["rewrite"]>>;
    assert(rewrite.text === "fixture draft text", "rewrite event resolves through service");

    const beforeCommandCalls = providerState.calls.length;
    await runtime.session.prompt("/write-for email project update");
    assert(
      providerState.calls.length === beforeCommandCalls + 1,
      "registered /write-for command reaches provider path",
    );

    const initialRewriteListeners = listenerCounts.get(WRITE_FOR_REWRITE_EVENT) ?? 0;
    let oldApi = api;
    let oldDraft = api.draft;
    for (let index = 0; index < 2; index += 1) {
      providerState.hangNext = true;
      const abortCountBeforeReload = providerState.aborts?.length ?? 0;
      const active = oldApi.draft({ channel: "email", subject: `shutdown-${index}` });
      active.catch(() => undefined);
      await runtime.session.reload();
      try {
        await active;
        throw new Error("expected reload cancellation");
      } catch (error) {
        assertCancelled(error, "reload cancels active generation with cancellation error");
        assert(
          (providerState.aborts?.length ?? 0) === abortCountBeforeReload + 1 &&
            providerState.aborts?.at(-1)?.name === "AbortError",
          "reload increments provider abort record with AbortError",
        );
      }
      try {
        await oldApi.draft({ channel: "email", subject: "stale" });
        throw new Error("expected stale api rejection");
      } catch (error) {
        assertDisposed(error, "stale api rejects with services error");
      }
      try {
        await oldDraft({ channel: "email", subject: "stale" });
        throw new Error("expected stale draft rejection");
      } catch (error) {
        assertDisposed(error, "stale destructured method rejects with services error");
      }
      await runtime.session.bindExtensions({});
      const fresh = discoverService(eventBus, writeForContract);
      assert(fresh && fresh !== oldApi, `reload ${index} publishes a fresh api object`);
      assert(
        countTools(runtime, "write_for_profile") === 1,
        "profile tool registration does not accumulate",
      );
      assert(
        countTools(runtime, "write_for_samples") === 1,
        "sample tool registration does not accumulate",
      );
      assert(
        countCommands(runtime, "write-for") === 1,
        "write-for command registration does not accumulate",
      );
      assert(
        countCommands(runtime, "train-voice") === 1,
        "training command registration does not accumulate",
      );
      assert(
        (listenerCounts.get(WRITE_FOR_REWRITE_EVENT) ?? 0) === initialRewriteListeners,
        "rewrite event listener registration does not accumulate",
      );
      oldApi = fresh;
      oldDraft = fresh.draft;
    }

    let currentApi = discoverService(eventBus, writeForContract);
    assert(currentApi, "api exists before new session");
    const beforeNewSession = currentApi;
    const beforeNewSessionDraft = currentApi.draft;
    await runtime.newSession();
    await runtime.session.bindExtensions({});
    try {
      await beforeNewSessionDraft({ channel: "email", subject: "old session" });
      throw new Error("expected stale new-session rejection");
    } catch (error) {
      assertDisposed(error, "new session stales destructured method");
    }
    currentApi = discoverService(eventBus, writeForContract);
    assert(currentApi && currentApi !== beforeNewSession, "new session discovers replacement api");

    providerState.hangNext = false;
    await runtime.session.setModel(fakeModel.explicitModel as never);
    const fallback = await currentApi.draft({ channel: "email", subject: "fallback" });
    assert(fallback.model.id === "explicit", "host model change updates fallback model");
    await runtime.session.setModel(fakeModel.model as never);
    await writeProfile(profileRoot, true);
    const explicit = await currentApi.draft({ channel: "email", subject: "explicit" });
    assert(explicit.model.id === "explicit", "explicit profile model takes precedence");

    const sourceDir = join(dir, "sources");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      join(sourceDir, "sample.md"),
      "Warm practical prose with concrete next steps.\n",
    );
    const trainingCtx = {
      cwd: join(dir, "cwd"),
      hasUI: true,
      mode: "tui",
      ui: createScriptedUi([true]),
      model: fakeModel.model,
      modelRegistry: fakeModel.runtime,
      isProjectTrusted: () => true,
      signal: undefined,
    } as never;
    assert(extensionState, "compiled writer extension returned training state");
    await extensionState.training.start(trainingCtx, {
      mode: "train",
      scope: "register",
      register: "professional",
      sourceFolder: sourceDir,
      saveTarget: "global",
    });
    let sampleTool = runtime.session.getToolDefinition("write_for_samples");
    let profileTool = runtime.session.getToolDefinition("write_for_profile");
    assert(sampleTool && profileTool, "writer-local training tools are registered");
    const ctx = { ...(trainingCtx as object), ui: createScriptedUi([false]) } as never;
    const profileSnapshotBeforeDecline = await snapshotFiles(profileRoot);
    const declined = await sampleTool.execute(
      "sample-decline",
      { sourceFolder: sourceDir, author: "fixture", register: "professional" },
      undefined,
      undefined,
      ctx,
    );
    assert(
      Array.isArray((declined.details as { sampleIds?: unknown[] }).sampleIds) &&
        (declined.details as { sampleIds: unknown[] }).sampleIds.length === 0,
      "rejected sample approval writes no samples",
    );
    assertSnapshotsEqual(
      profileSnapshotBeforeDecline,
      await snapshotFiles(profileRoot),
      "rejected sample approval leaves profile files unchanged",
    );
    providerState.nextText = JSON.stringify({
      bodies: { "register:professional": "Use warm practical prose and concrete next steps." },
    });
    const approveCtx = { ...(ctx as object), ui: createScriptedUi([true, true]) } as never;
    const approved = await sampleTool.execute(
      "sample-approve",
      { sourceFolder: sourceDir, author: "fixture", register: "professional" },
      undefined,
      undefined,
      approveCtx,
    );
    assert(
      ((approved.details as { sampleIds?: unknown[] }).sampleIds?.length ?? 0) > 0,
      "approved sample flow records admitted samples",
    );
    await extensionState.training.start(trainingCtx, {
      mode: "train",
      scope: "style",
      sourceFolder: sourceDir,
      saveTarget: "global",
    });
    sampleTool = runtime.session.getToolDefinition("write_for_samples");
    profileTool = runtime.session.getToolDefinition("write_for_profile");
    assert(sampleTool && profileTool, "style training tools are registered");
    const styleApproveCtx = { ...(ctx as object), ui: createScriptedUi([true]) } as never;
    const approvedStyle = await sampleTool.execute(
      "sample-approve-style",
      { sourceFolder: sourceDir, author: "fixture" },
      undefined,
      undefined,
      styleApproveCtx,
    );
    assert(
      ((approvedStyle.details as { sampleIds?: unknown[] }).sampleIds?.length ?? 0) > 0,
      "approved style sample flow records admitted samples",
    );

    providerState.hangNext = true;
    const callsBeforePendingProposal = providerState.calls.length;
    const abortCountBeforeTrainingDispose = providerState.aborts?.length ?? 0;
    const pendingProposal = profileTool.execute(
      "profile-pending-reload",
      { action: "propose" },
      undefined,
      undefined,
      approveCtx,
    );
    pendingProposal.catch(() => undefined);
    await waitFor(
      () => providerState.calls.length === callsBeforePendingProposal + 1,
      "pending training proposal reached provider before disposal",
    );
    void extensionState.training.dispose();
    try {
      await pendingProposal;
      throw new Error("expected pending training proposal to abort on training dispose");
    } catch (error) {
      assertCancelled(
        error,
        "training dispose cancels pending training proposal with cancellation error",
      );
      assert(
        (providerState.aborts?.length ?? 0) === abortCountBeforeTrainingDispose + 1 &&
          providerState.aborts?.at(-1)?.name === "AbortError",
        "training dispose increments provider abort record with AbortError",
      );
    }
    providerState.hangNext = false;
    await runtime.session.reload();
    await runtime.session.bindExtensions({});
    assert(
      countTools(runtime, "write_for_profile") === 1,
      "profile tool remains singly registered after pending-training reload",
    );
    assert(
      countCommands(runtime, "write-for") === 1,
      "command remains singly registered after pending-training reload",
    );
    currentApi = discoverService(eventBus, writeForContract);
    assert(currentApi, "api exists after pending-training reload");
    assert(extensionState, "writer extension returned replacement training state");
    await extensionState.training.start(trainingCtx, {
      mode: "train",
      scope: "register",
      register: "professional",
      sourceFolder: sourceDir,
      saveTarget: "global",
    });
    sampleTool = runtime.session.getToolDefinition("write_for_samples");
    profileTool = runtime.session.getToolDefinition("write_for_profile");
    assert(
      sampleTool && profileTool,
      "training tools are registered after pending-training reload",
    );
    providerState.nextText = JSON.stringify({
      bodies: { "register:professional": "Use warm practical prose and concrete next steps." },
    });
    await sampleTool.execute(
      "sample-approve-after-reload",
      { sourceFolder: sourceDir, author: "fixture", register: "professional" },
      undefined,
      undefined,
      approveCtx,
    );
    const proposal = await profileTool.execute(
      "profile-propose",
      { action: "propose" },
      undefined,
      undefined,
      approveCtx,
    );
    const proposalId = (proposal.details as { proposalId?: string }).proposalId;
    assert(proposalId, "training proposal was created");
    await profileTool.execute(
      "profile-save",
      { action: "save", proposalId },
      undefined,
      undefined,
      approveCtx,
    );
    providerState.nextText = undefined;
    assert(
      (await currentApi.draft({ channel: "email", subject: "after training" })).text ===
        "fixture draft text",
      "approved training flow leaves usable profile",
    );
  } finally {
    await runtime.dispose();
    eventBus.clear();
    if (previousConfig === undefined) delete process.env.PI_WRITE_FOR_CONFIG;
    else process.env.PI_WRITE_FOR_CONFIG = previousConfig;
    await rm(dir, { recursive: true, force: true });
  }
}

await main();
console.log("pi write-for lifecycle proof passed");
