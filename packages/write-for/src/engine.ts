import { CONFIG_DIR_NAME, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { DraftRequest, RewriteRequest, WritingResult } from "./contract.js";
import { explainInvalidWritingRequest } from "./contract.js";
import { resolveWritingProfile, type ResolveWritingProfileInput } from "./config.js";
import { createWriteForError } from "./errors.js";
import { runText, type RunTextInput } from "./model.js";
import { composeDraftMessages, composeRewriteMessages } from "./prompts.js";

export interface EngineEnvironment {
  home?: string;
  xdgConfigHome?: string;
  envConfig?: string;
  trustedProject?: boolean;
  piConfigDirName?: string;
}

export interface WritingEngineOptions {
  env?: EngineEnvironment;
  resolveProfile?: typeof resolveWritingProfile;
  runText?: (input: RunTextInput) => Promise<WritingResult>;
}

export interface WritingEngine {
  draft(ctx: ExtensionContext, request: DraftRequest): Promise<WritingResult>;
  rewrite(ctx: ExtensionContext, request: RewriteRequest): Promise<WritingResult>;
}

function activeModelReference(ctx: ExtensionContext): string | undefined {
  const model = ctx.model as
    | { provider?: string; providerName?: string; id?: string; modelId?: string }
    | undefined;
  const provider = model?.provider ?? model?.providerName;
  const id = model?.id ?? model?.modelId;
  return provider && id ? `${provider}/${id}` : undefined;
}

function configuredProfileModel(profile: { model?: { source: string } }): RunTextInput["model"] {
  return profile.model?.source === "active" ? undefined : (profile.model as RunTextInput["model"]);
}

function profileInput(
  ctx: ExtensionContext,
  request: DraftRequest | RewriteRequest,
  env: EngineEnvironment,
): ResolveWritingProfileInput {
  return {
    cwd: ctx.cwd,
    home: env.home,
    xdgConfigHome: env.xdgConfigHome,
    envConfig:
      env.envConfig ??
      (typeof process !== "undefined" ? process.env.PI_WRITE_FOR_CONFIG : undefined),
    trustedProject: env.trustedProject ?? ctx.isProjectTrusted(),
    piConfigDirName: env.piConfigDirName ?? CONFIG_DIR_NAME,
    channel: request.channel,
    register: request.register,
    activeModel: activeModelReference(ctx),
  };
}

export function createWritingEngine(options: WritingEngineOptions = {}): WritingEngine {
  const resolveProfile = options.resolveProfile ?? resolveWritingProfile;
  const runner = options.runText ?? runText;
  const env = options.env ?? {};
  return {
    async draft(ctx, request) {
      const invalid = explainInvalidWritingRequest(request, "draft");
      if (invalid) throw createWriteForError("INVALID_REQUEST", invalid);
      const profile = resolveProfile(profileInput(ctx, request, env));
      const result = await runner({
        ctx,
        model: configuredProfileModel(profile),
        messages: composeDraftMessages(profile, request),
        signal: request.signal,
      });
      return { ...result, channel: profile.channel, register: profile.register };
    },
    async rewrite(ctx, request) {
      const invalid = explainInvalidWritingRequest(request, "rewrite");
      if (invalid) throw createWriteForError("INVALID_REQUEST", invalid);
      const profile = resolveProfile(profileInput(ctx, request, env));
      const result = await runner({
        ctx,
        model: configuredProfileModel(profile),
        messages: composeRewriteMessages(profile, request),
        signal: request.signal,
      });
      return { ...result, channel: profile.channel, register: profile.register };
    },
  };
}
