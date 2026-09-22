import { resolve } from "node:path";
import {
  CONFIG_DIR_NAME,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  defaultConfigRoot,
  loadConfigLayers,
  splitModelReference,
  validateExplicitConfigRoot,
  type ModelReference,
} from "./config.js";
import {
  runText,
  selectWritingModel,
  type HostModel,
  type RunTextInput,
  type RunTextResult,
} from "./model.js";
import {
  SOURCE_LIMITS,
  describeSourcePlan,
  ingestSourcePlan,
  planSourceFolder,
  type AdmittedSample,
} from "./sources.js";
import { createWriteForError } from "./errors.js";
import {
  buildDistillationMessages,
  hostInterviewGuidance,
  type TrainingPromptTarget,
} from "./training-prompts.js";
import {
  assertTrainingIdentifier,
  createProfileProposal,
  reviewedBodyFromText,
  reviewTextForProposal,
  saveApprovedProposal,
  snapshotTargets,
  targetKey,
  type ProfileProposal,
  type TrainingTarget,
} from "./training-store.js";

export interface TrainingCommandOptions {
  mode: "train" | "retrain";
  scope?: "style" | "register" | "channel" | "all";
  register?: string;
  channel?: string;
  sourceFolder?: string;
  saveTarget?: "global" | "project";
}

export interface TrainingSession {
  id: string;
  mode: "train" | "retrain";
  scope: NonNullable<TrainingCommandOptions["scope"]>;
  register?: string;
  channel?: string;
  root: string;
  sourceFolder?: string;
  answers: Record<string, string>;
  samples: AdmittedSample[];
  proposals: ProfileProposal[];
  controller: AbortController;
  ownedTempPaths: Set<string>;
}

export interface TrainingManagerOptions {
  runText?: (input: RunTextInput) => Promise<RunTextResult>;
  env?: {
    home?: string;
    xdgConfigHome?: string;
    envConfig?: string;
    piConfigDirName?: string;
    trustedProject?: boolean;
  };
}

function activeModelReference(ctx: ExtensionContext): string | undefined {
  const model = ctx.model as
    | { provider?: string; providerName?: string; id?: string; modelId?: string }
    | undefined;
  const provider = model?.provider ?? model?.providerName;
  const id = model?.id ?? model?.modelId;
  return provider && id ? `${provider}/${id}` : undefined;
}

function projectRoot(ctx: ExtensionContext, env: TrainingManagerOptions["env"]): string {
  return `${ctx.cwd}/${env?.piConfigDirName ?? CONFIG_DIR_NAME}/write-for`;
}

function isTrustedProject(ctx: ExtensionContext, env: TrainingManagerOptions["env"]): boolean {
  return env?.trustedProject ?? ctx.isProjectTrusted();
}

function trustedProjectRoot(ctx: ExtensionContext, env: TrainingManagerOptions["env"]): string {
  if (!isTrustedProject(ctx, env)) {
    throw createWriteForError(
      "CONFIG_INVALID",
      "project save target requires a trusted project before selecting its config root",
    );
  }
  return projectRoot(ctx, env);
}

function explicitConfigRoot(
  ctx: ExtensionContext,
  env: TrainingManagerOptions["env"],
): string | undefined {
  const explicit =
    env?.envConfig ??
    (typeof process !== "undefined" ? process.env.PI_WRITE_FOR_CONFIG : undefined);
  if (!explicit) return undefined;
  return validateExplicitConfigRoot({
    cwd: ctx.cwd,
    explicit,
    trustedProject: isTrustedProject(ctx, env),
    piConfigDirName: env?.piConfigDirName ?? CONFIG_DIR_NAME,
    source: env?.envConfig ? "explicit config root" : "PI_WRITE_FOR_CONFIG",
  });
}

function globalRoot(ctx: ExtensionContext, env: TrainingManagerOptions["env"]): string {
  return explicitConfigRoot(ctx, env) ?? defaultConfigRoot(env?.home);
}

function selectedRoot(
  ctx: ExtensionContext,
  options: TrainingCommandOptions,
  env: TrainingManagerOptions["env"],
): string {
  const explicit = explicitConfigRoot(ctx, env);
  if (explicit) return explicit;
  if (options.saveTarget === "project") return trustedProjectRoot(ctx, env);
  return defaultConfigRoot(env?.home);
}

async function chooseScope(
  ctx: ExtensionContext,
  options: TrainingCommandOptions,
): Promise<TrainingSession["scope"]> {
  if (options.scope) return options.scope;
  const choice = await ctx.ui.select("What should Pi Write For train?", [
    "style",
    "register",
    "channel",
    "all",
  ]);
  if (!choice) throw createWriteForError("INVALID_REQUEST", "training scope is required");
  return choice as TrainingSession["scope"];
}

async function resolveTargetName(
  ctx: ExtensionContext,
  kind: "register" | "channel",
  provided: string | undefined,
): Promise<string> {
  const value =
    provided?.trim() ??
    (
      await ctx.ui.input(
        `Name of the ${kind} profile to train`,
        kind === "register" ? "pro" : "slack",
      )
    )?.trim();
  if (!value) throw createWriteForError("INVALID_REQUEST", `${kind} target name is required`);
  assertTrainingIdentifier(value, kind);
  return value;
}

async function resolveSessionTargets(
  ctx: ExtensionContext,
  scope: TrainingSession["scope"],
  options: TrainingCommandOptions,
): Promise<{ register?: string; channel?: string }> {
  let register = options.register?.trim();
  let channel = options.channel?.trim();
  if (register) assertTrainingIdentifier(register, "register");
  if (channel) assertTrainingIdentifier(channel, "channel");
  if (scope === "register" || scope === "all") {
    register = await resolveTargetName(ctx, "register", register);
  }
  if (scope === "channel" || scope === "all") {
    channel = await resolveTargetName(ctx, "channel", channel);
  }
  return { register, channel };
}

function updateSessionFromAnswer(
  ctx: ExtensionContext,
  session: TrainingSession,
  key: string,
  answer: string,
  env: TrainingManagerOptions["env"],
): void {
  const normalizedKey = key.toLowerCase().replace(/[_\s-]/g, "");
  const value = answer.trim();
  if (!value) return;
  if (["register", "targetregister", "registername"].includes(normalizedKey)) {
    assertTrainingIdentifier(value, "register");
    session.register = value;
  }
  if (["channel", "targetchannel", "channelname"].includes(normalizedKey)) {
    assertTrainingIdentifier(value, "channel");
    session.channel = value;
  }
  if (
    [
      "savedestination",
      "savepath",
      "saveroot",
      "savetarget",
      "destination",
      "configroot",
      "profiledestination",
    ].includes(normalizedKey)
  ) {
    const root = rootFromSaveDestinationAnswer(ctx, value, env);
    if (root) session.root = root;
  }
}

function rootFromSaveDestinationAnswer(
  ctx: ExtensionContext,
  answer: string,
  env: TrainingManagerOptions["env"],
): string | undefined {
  const normalized = answer.trim().toLowerCase();
  if (["global", "user", "user global", "global config", "global profile"].includes(normalized))
    return globalRoot(ctx, env);
  if (
    ["project", "trusted project", "project config", "project profile", "local project"].includes(
      normalized,
    )
  )
    return trustedProjectRoot(ctx, env);
  const prefixed = answer.match(/^(?:path|root|config(?:\s+root)?|custom)\s*:\s*(.+)$/i)?.[1];
  const path = prefixed ?? (answer.startsWith("/") || answer.startsWith("~/") ? answer : undefined);
  if (!path) return undefined;
  const expanded = path.startsWith("~/")
    ? `${env?.home ?? process.env.HOME ?? ""}/${path.slice(2)}`
    : path;
  return validateExplicitConfigRoot({
    cwd: ctx.cwd,
    explicit: resolve(expanded),
    trustedProject: isTrustedProject(ctx, env),
    piConfigDirName: env?.piConfigDirName ?? CONFIG_DIR_NAME,
    source: "save destination",
  });
}

function ensureHostSampleLimits(session: TrainingSession, text: string): void {
  const currentCharacters = session.samples.reduce((sum, sample) => sum + sample.text.length, 0);
  const nextCharacters = currentCharacters + text.length;
  if (session.samples.length + 1 > SOURCE_LIMITS.maxFiles) {
    throw createWriteForError(
      "SOURCE_LIMIT",
      `too many source samples (${session.samples.length + 1} > ${SOURCE_LIMITS.maxFiles})`,
    );
  }
  if (Buffer.byteLength(text, "utf8") > SOURCE_LIMITS.maxFileBytes) {
    throw createWriteForError(
      "SOURCE_LIMIT",
      `host-collected sample exceeds per-source byte limit (${Buffer.byteLength(text, "utf8")} > ${SOURCE_LIMITS.maxFileBytes})`,
    );
  }
  if (nextCharacters > SOURCE_LIMITS.maxCharacters) {
    throw createWriteForError(
      "SOURCE_LIMIT",
      `working corpus exceeds character limit (${nextCharacters} > ${SOURCE_LIMITS.maxCharacters})`,
    );
  }
}

function targetsForSession(session: TrainingSession): TrainingTarget[] {
  const targets: TrainingTarget[] = [];
  if (session.scope === "style" || session.scope === "all")
    targets.push({ kind: "style", name: "style", root: session.root });
  if (session.scope === "register" || session.scope === "all") {
    if (!session.register)
      throw createWriteForError("INVALID_REQUEST", "--register is required for register training");
    targets.push({ kind: "register", name: session.register, root: session.root });
  }
  if (session.scope === "channel" || session.scope === "all") {
    if (!session.channel)
      throw createWriteForError("INVALID_REQUEST", "--channel is required for channel training");
    targets.push({ kind: "channel", name: session.channel, root: session.root });
  }
  return targets;
}

function samplesForTarget(session: TrainingSession, target: TrainingTarget): AdmittedSample[] {
  if (target.kind === "style") return session.samples;
  const targetRegister = target.kind === "register" ? target.name : session.register;
  return session.samples.filter((sample) => {
    if (!sample.register) return true;
    if (!targetRegister) return false;
    return sample.register.toLowerCase() === targetRegister.toLowerCase();
  });
}

function formatDiagnosticsForReview(diagnostics: unknown[]): string {
  return diagnostics
    .map((diagnostic) => {
      if (!diagnostic || typeof diagnostic !== "object") return `- ${String(diagnostic)}`;
      const record = diagnostic as Record<string, unknown>;
      const severity = typeof record.severity === "string" ? record.severity : "notice";
      const path = typeof record.path === "string" ? `${record.path}: ` : "";
      const message = typeof record.message === "string" ? record.message : JSON.stringify(record);
      return `- ${severity}: ${path}${message}`;
    })
    .join("\n");
}

function modelForTarget(
  ctx: ExtensionContext,
  session: TrainingSession,
  target: TrainingTarget,
  env: TrainingManagerOptions["env"],
): ModelReference | undefined {
  const channel = target.kind === "channel" ? target.name : (session.channel ?? "slack");
  const register = target.kind === "register" ? target.name : session.register;
  const loaded = loadConfigLayers({
    cwd: ctx.cwd,
    home: env?.home,
    xdgConfigHome: env?.xdgConfigHome,
    envConfig:
      env?.envConfig ??
      (typeof process !== "undefined" ? process.env.PI_WRITE_FOR_CONFIG : undefined),
    trustedProject: env?.trustedProject ?? ctx.isProjectTrusted(),
    piConfigDirName: env?.piConfigDirName ?? CONFIG_DIR_NAME,
    channel,
    register,
    activeModel: activeModelReference(ctx),
  }) as unknown as {
    layers: Array<{
      root: "global" | "project";
      kind: string;
      metadata: { model?: string };
      path: string;
    }>;
  };
  let selected: { value: string; source: string } | undefined = activeModelReference(ctx)
    ? { value: activeModelReference(ctx)!, source: "active" }
    : undefined;
  const precedence =
    target.kind === "style"
      ? ["style"]
      : target.kind === "register"
        ? ["style", "register"]
        : ["style", "register", "channel"];
  for (const root of ["global", "project"] as const) {
    for (const kind of precedence) {
      const layer = loaded.layers.find(
        (candidate) => candidate.root === root && candidate.kind === kind,
      );
      if (layer?.metadata.model) selected = { value: layer.metadata.model, source: layer.path };
    }
  }
  return selected && selected.source !== "active"
    ? splitModelReference(selected.value, selected.source)
    : undefined;
}

const conservativeCharsPerToken = 3;
const defaultOutputTokenReserve = 4096;

function modelNumberMetadata(model: HostModel, ...keys: string[]): number | undefined {
  const records: Record<string, unknown>[] = [model as Record<string, unknown>];
  const metadata = (model as Record<string, unknown>).metadata;
  if (metadata && typeof metadata === "object") records.push(metadata as Record<string, unknown>);
  const limits = (model as Record<string, unknown>).limits;
  if (limits && typeof limits === "object") records.push(limits as Record<string, unknown>);
  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
    }
  }
  return undefined;
}

function modelContextWindow(model: HostModel): number | undefined {
  return modelNumberMetadata(model, "contextWindow", "context_window", "contextLength");
}

function modelMaxTokens(model: HostModel): number | undefined {
  return modelNumberMetadata(
    model,
    "maxTokens",
    "max_tokens",
    "maxOutputTokens",
    "max_output_tokens",
  );
}

function enforcePromptFitsModel(messages: RunTextInput["messages"], model: HostModel): void {
  const contextWindow = modelContextWindow(model);
  if (!contextWindow) return;
  const reserve = Math.min(
    Math.max(modelMaxTokens(model) ?? defaultOutputTokenReserve, 1024),
    Math.max(1, contextWindow - 1),
  );
  const estimatedInputTokens = Math.ceil(
    messages.reduce((sum, message) => sum + message.content.length, 0) / conservativeCharsPerToken,
  );
  const availableInputTokens = contextWindow - reserve;
  if (estimatedInputTokens > availableInputTokens) {
    throw createWriteForError(
      "SOURCE_LIMIT",
      `training prompt is too large for the selected model context window (${estimatedInputTokens} estimated input tokens > ${availableInputTokens} available after reserving ${reserve} output tokens); approve fewer samples or select a model with a larger context window`,
    );
  }
}

type LoadedTrainingLayer = {
  root: "global" | "project";
  kind: "style" | "register" | "channel";
  body?: string;
};

type LoadedTrainingLayers = {
  layers: LoadedTrainingLayer[];
  builtInChannelBody?: string;
};

function selectedLayerBody(
  layers: LoadedTrainingLayer[],
  kind: LoadedTrainingLayer["kind"],
): string {
  const projectBody = layers
    .find((layer) => layer.root === "project" && layer.kind === kind)
    ?.body?.trim();
  if (projectBody) return projectBody;
  return layers.find((layer) => layer.root === "global" && layer.kind === kind)?.body?.trim() ?? "";
}

function guidanceBodiesForTarget(
  ctx: ExtensionContext,
  session: TrainingSession,
  target: TrainingTarget,
  env: TrainingManagerOptions["env"],
): Pick<TrainingPromptTarget, "styleBody" | "registerBody" | "channelBody"> {
  const channel = target.kind === "channel" ? target.name : (session.channel ?? "slack");
  const register = target.kind === "register" ? target.name : session.register;
  const loaded = loadConfigLayers({
    cwd: ctx.cwd,
    home: env?.home,
    xdgConfigHome: env?.xdgConfigHome,
    envConfig:
      env?.envConfig ??
      (typeof process !== "undefined" ? process.env.PI_WRITE_FOR_CONFIG : undefined),
    trustedProject: env?.trustedProject ?? ctx.isProjectTrusted(),
    piConfigDirName: env?.piConfigDirName ?? CONFIG_DIR_NAME,
    channel,
    register,
    activeModel: activeModelReference(ctx),
  }) as unknown as LoadedTrainingLayers;
  const channelBody =
    selectedLayerBody(loaded.layers, "channel") || loaded.builtInChannelBody?.trim() || undefined;
  return {
    styleBody: selectedLayerBody(loaded.layers, "style") || undefined,
    registerBody: selectedLayerBody(loaded.layers, "register") || undefined,
    channelBody,
  };
}

function parseModelBodies(text: string, targets: TrainingTarget[]): Record<string, string> {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    if (targets.length === 1) return { [targetKey(targets[0]!)]: text.trim() };
    throw createWriteForError("GENERATION_FAILED", "model did not return valid proposal JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw createWriteForError("GENERATION_FAILED", "model proposal must be an object");
  }
  const bodies = (parsed as Record<string, unknown>).bodies ?? parsed;
  if (!bodies || typeof bodies !== "object" || Array.isArray(bodies)) {
    throw createWriteForError("GENERATION_FAILED", "model proposal must include bodies");
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(bodies as Record<string, unknown>)) {
    if (typeof value !== "string")
      throw createWriteForError("GENERATION_FAILED", `proposal body ${key} is not text`);
    result[key] = value;
  }
  return result;
}

async function cleanupSession(session: TrainingSession): Promise<void> {
  session.controller.abort();
  session.samples.splice(0, session.samples.length);
  session.proposals.splice(0, session.proposals.length);
  session.answers = {};
  session.ownedTempPaths.clear();
}

export class TrainingManager {
  private active?: TrainingSession;
  private readonly runner: (input: RunTextInput) => Promise<RunTextResult>;
  constructor(
    private readonly pi: ExtensionAPI,
    private readonly options: TrainingManagerOptions = {},
  ) {
    this.runner = options.runText ?? runText;
  }

  current(): TrainingSession | undefined {
    return this.active;
  }

  async start(ctx: ExtensionContext, options: TrainingCommandOptions): Promise<TrainingSession> {
    if (!ctx.hasUI)
      throw createWriteForError(
        "NO_UI",
        "voice training requires Pi UI/RPC; export sources and configure profiles manually in headless mode",
      );
    if (this.active) {
      const replace = await ctx.ui.confirm(
        "Replace active training session?",
        "A Pi Write For training session is already active. Replace it?",
      );
      if (!replace) throw createWriteForError("INVALID_REQUEST", "training session already active");
      await cleanupSession(this.active);
      this.active = undefined;
    }
    const scope = await chooseScope(ctx, options);
    const targets = await resolveSessionTargets(ctx, scope, options);
    const session: TrainingSession = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      mode: options.mode,
      scope,
      register: targets.register,
      channel: targets.channel,
      root: selectedRoot(ctx, options, this.options.env),
      sourceFolder: options.sourceFolder,
      answers: {},
      samples: [],
      proposals: [],
      controller: new AbortController(),
      ownedTempPaths: new Set(),
    };
    this.active = session;
    const guidance = hostInterviewGuidance({
      mode: session.mode,
      scope: session.scope,
      sourceFolder: session.sourceFolder,
      activeTools: this.pi.getActiveTools?.() ?? [],
      allTools: (this.pi.getAllTools?.() ?? [])
        .map((tool: { name?: unknown }) => String(tool.name ?? ""))
        .filter(Boolean),
    });
    this.pi.sendUserMessage?.(guidance, { deliverAs: "followUp" });
    return session;
  }

  async ask(
    ctx: ExtensionContext,
    params: { key: string; question: string; multiline?: boolean },
  ): Promise<string> {
    const session = this.requireActive();
    if (!ctx.hasUI) throw createWriteForError("NO_UI", "training interview requires UI");
    const answer =
      params.multiline && ctx.ui.editor
        ? await ctx.ui.editor(params.question, session.answers[params.key] ?? "")
        : await ctx.ui.input(params.question, session.answers[params.key] ?? "");
    if (answer == null)
      throw createWriteForError("INVALID_REQUEST", "interview question was cancelled");
    session.answers[params.key] = answer;
    updateSessionFromAnswer(ctx, session, params.key, answer, this.options.env);
    return answer;
  }

  async admitSamples(
    ctx: ExtensionContext,
    params: {
      sourceFolder?: string;
      text?: string;
      sourceLabel?: string;
      author?: string;
      register?: string;
    },
  ): Promise<{ samples: AdmittedSample[]; diagnostics: unknown[] }> {
    const session = this.requireActive();
    if (!ctx.hasUI) throw createWriteForError("NO_UI", "sample admission requires UI");
    const diagnostics: unknown[] = [];
    if (params.text) {
      const approved = await ctx.ui.confirm(
        "Admit Pi Write For sample?",
        `Admit host-collected text sample ${params.sourceLabel ?? "pasted text"}?`,
      );
      if (!approved)
        return { samples: [], diagnostics: [{ severity: "warning", message: "sample declined" }] };
      const text = params.text.trim();
      if (!text) throw createWriteForError("SOURCE_INVALID", "sample text is empty");
      ensureHostSampleLimits(session, text);
      const sample: AdmittedSample = {
        id: `${session.id}-host-${session.samples.length + 1}`,
        source: params.sourceLabel ?? "host-collected text",
        author: params.author,
        register: params.register ?? session.register,
        text,
        warnings: [],
      };
      session.samples.push(sample);
      return { samples: [sample], diagnostics };
    }
    const folder = params.sourceFolder ?? session.sourceFolder;
    if (!folder) throw createWriteForError("SOURCE_INVALID", "sourceFolder or text is required");
    const plan = await planSourceFolder(folder);
    const approved = await ctx.ui.confirm(
      "Admit Pi Write For sources?",
      `Admit sources: ${describeSourcePlan(plan)}?`,
    );
    if (!approved)
      return {
        samples: [],
        diagnostics: [{ severity: "warning", message: "source plan declined" }],
      };
    const result = await ingestSourcePlan(plan, {
      author: params.author,
      register: params.register ?? session.register,
      signal: ctx.signal ?? session.controller.signal,
    });
    if (result.diagnostics.length > 0) {
      const admitRemaining = await ctx.ui.confirm(
        "Admit remaining Pi Write For samples?",
        [
          "Some approved source files produced warnings or errors during ingestion.",
          formatDiagnosticsForReview(result.diagnostics),
          `Admit the ${result.samples.length} usable sample(s) and skip failed files?`,
        ].join("\n\n"),
      );
      if (!admitRemaining) {
        return { samples: [], diagnostics: result.diagnostics };
      }
    }
    const existingCharacters = session.samples.reduce((sum, sample) => sum + sample.text.length, 0);
    const admittedCharacters = result.samples.reduce((sum, sample) => sum + sample.text.length, 0);
    if (session.samples.length + result.samples.length > SOURCE_LIMITS.maxFiles) {
      throw createWriteForError(
        "SOURCE_LIMIT",
        `too many source samples (${session.samples.length + result.samples.length} > ${SOURCE_LIMITS.maxFiles})`,
      );
    }
    if (existingCharacters + admittedCharacters > SOURCE_LIMITS.maxCharacters) {
      throw createWriteForError(
        "SOURCE_LIMIT",
        `working corpus exceeds character limit (${existingCharacters + admittedCharacters} > ${SOURCE_LIMITS.maxCharacters})`,
      );
    }
    session.samples.push(...result.samples);
    return { samples: result.samples, diagnostics: result.diagnostics };
  }

  async propose(ctx: ExtensionContext): Promise<ProfileProposal> {
    const session = this.requireActive();
    if (session.samples.length === 0)
      throw createWriteForError("SOURCE_INVALID", "no admitted samples are available");
    const targets = targetsForSession(session);
    const snapshots = await snapshotTargets(targets);
    const bodies: Record<string, string> = {};
    const details: Array<{
      target: string;
      model: RunTextResult["model"];
      usage: RunTextResult["usage"];
    }> = [];
    for (const target of targets) {
      const snapshot = snapshots.find(
        (candidate) => targetKey(candidate.target) === targetKey(target),
      );
      const guidance = guidanceBodiesForTarget(ctx, session, target, this.options.env);
      const relevantSamples = samplesForTarget(session, target);
      if (relevantSamples.length === 0) {
        throw createWriteForError(
          "SOURCE_INVALID",
          `no admitted samples are relevant to ${targetKey(target)}; approve matching samples before distillation`,
        );
      }
      const messages = buildDistillationMessages({
        mode: session.mode,
        target: {
          kind: target.kind,
          name: target.name,
          existingBody: snapshot?.body,
          ...guidance,
        },
        answers: session.answers,
        samples: relevantSamples,
      });
      const configuredModel = modelForTarget(ctx, session, target, this.options.env);
      const selectedModel = selectWritingModel(ctx.modelRegistry, ctx.model, configuredModel);
      enforcePromptFitsModel(messages, selectedModel);
      const result = await this.runner({
        ctx,
        model: configuredModel,
        messages,
        signal: ctx.signal ?? session.controller.signal,
      });
      Object.assign(bodies, parseModelBodies(result.text, [target]));
      details.push({ target: targetKey(target), model: result.model, usage: result.usage });
    }
    const proposal = createProfileProposal({ snapshots, bodies, details });
    session.proposals.push(proposal);
    return proposal;
  }

  async reviewAndSave(
    ctx: ExtensionContext,
    proposalId?: string,
  ): Promise<{ saved: string[]; failed: unknown[] }> {
    const session = this.requireActive();
    if (!ctx.hasUI) throw createWriteForError("NO_UI", "profile approval requires UI");
    const proposal = proposalId
      ? session.proposals.find((candidate) => candidate.id === proposalId)
      : session.proposals.at(-1);
    if (!proposal) throw createWriteForError("INVALID_REQUEST", "no proposal is ready to save");
    for (const snapshot of proposal.snapshots) {
      const key = targetKey(snapshot.target);
      const edited = await ctx.ui.editor(
        `Review Pi Write For profile proposal for ${snapshot.path}`,
        reviewTextForProposal(proposal, snapshot),
      );
      if (edited == null)
        throw createWriteForError("INVALID_REQUEST", "proposal review was cancelled");
      proposal.bodies[key] = reviewedBodyFromText(edited);
    }
    const approved = await ctx.ui.confirm(
      "Save Pi Write For profiles?",
      "Save the reviewed Pi Write For profile changes?",
    );
    if (!approved) throw createWriteForError("INVALID_REQUEST", "proposal was not approved");
    const result = await saveApprovedProposal(proposal);
    if (result.failed.length === 0) await cleanupSession(session);
    this.active = result.failed.length === 0 ? undefined : session;
    return result;
  }

  async cancel(): Promise<void> {
    if (!this.active) return;
    await cleanupSession(this.active);
    this.active = undefined;
  }

  async dispose(): Promise<void> {
    await this.cancel();
  }

  private requireActive(): TrainingSession {
    if (!this.active)
      throw createWriteForError(
        "TRAINING_NOT_ACTIVE",
        "start /train-voice before using write-for training tools",
      );
    return this.active;
  }
}

export function createTrainingManager(
  pi: ExtensionAPI,
  options?: TrainingManagerOptions,
): TrainingManager {
  return new TrainingManager(pi, options);
}
