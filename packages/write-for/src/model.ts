import type { ModelReference } from "./config.js";
import { createWriteForError } from "./errors.js";

export interface TextMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface HostModel {
  provider?: string;
  providerName?: string;
  id?: string;
  modelId?: string;
  name?: string;
}

export interface HostModelRegistry {
  find(provider: string, modelId: string): HostModel | undefined;
  hasConfiguredAuth(model: HostModel): boolean;
  complete(
    model: HostModel,
    context: ReturnType<typeof buildPiContext>,
    options?: { signal?: AbortSignal },
  ): Promise<unknown>;
}

export interface RunTextInput {
  ctx: { model: HostModel | undefined; modelRegistry: HostModelRegistry };
  model?: ModelReference;
  messages: TextMessage[];
  signal?: AbortSignal;
}

export interface RunTextResult {
  text: string;
  model: { provider: string; id: string };
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costUsd?: number;
  };
}

function modelIdentity(model: HostModel): { provider: string; id: string } {
  const provider = model.provider ?? model.providerName;
  const id = model.id ?? model.modelId ?? model.name;
  if (!provider || !id)
    throw createWriteForError("MODEL_UNAVAILABLE", "selected model is missing identity");
  return { provider, id };
}

export function selectWritingModel(
  registry: HostModelRegistry,
  activeModel: HostModel | undefined,
  configured?: ModelReference,
): HostModel {
  const selected = configured ? registry.find(configured.provider, configured.id) : activeModel;
  if (!selected) {
    throw createWriteForError(
      "MODEL_UNAVAILABLE",
      configured
        ? `configured model is unavailable: ${configured.value}`
        : "no active model is selected",
    );
  }
  if (!registry.hasConfiguredAuth(selected)) {
    const identity = modelIdentity(selected);
    throw createWriteForError(
      "MODEL_AUTH",
      `model ${identity.provider}/${identity.id} has no configured auth`,
    );
  }
  return selected;
}

function normalizeUsage(value: unknown): RunTextResult["usage"] {
  const usage = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const number = (...names: string[]) => {
    for (const name of names) if (typeof usage[name] === "number") return usage[name] as number;
    return 0;
  };
  const result: RunTextResult["usage"] = {
    inputTokens: number("input", "inputTokens", "input_tokens", "promptTokens", "prompt_tokens"),
    outputTokens: number(
      "output",
      "outputTokens",
      "output_tokens",
      "completionTokens",
      "completion_tokens",
    ),
    cacheReadTokens: number(
      "cacheRead",
      "cacheReadTokens",
      "cache_read_tokens",
      "cachedInputTokens",
    ),
    cacheWriteTokens: number("cacheWrite", "cacheWriteTokens", "cache_write_tokens"),
  };
  if (typeof usage.costUsd === "number") result.costUsd = usage.costUsd;
  else if (typeof usage.cost === "number") result.costUsd = usage.cost;
  else if (
    usage.cost &&
    typeof usage.cost === "object" &&
    typeof (usage.cost as Record<string, unknown>).total === "number"
  )
    result.costUsd = (usage.cost as Record<string, number>).total;
  return result;
}

function buildPiContext(messages: TextMessage[]): {
  systemPrompt?: string;
  messages: Array<{ role: "user"; content: string; timestamp: number }>;
} {
  const systemPrompt = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const timestamp = Date.now();
  return {
    ...(systemPrompt ? { systemPrompt } : {}),
    messages: messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: "user" as const,
        content:
          message.role === "assistant" ? `Assistant context:\n${message.content}` : message.content,
        timestamp,
      })),
  };
}

function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;
  if (typeof record.content === "string") return record.content;
  if (Array.isArray(record.content)) {
    return record.content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const p = part as Record<string, unknown>;
          if (
            p.type === "tool-call" ||
            p.type === "tool_call" ||
            p.type === "toolCall" ||
            p.type === "reasoning"
          )
            return "";
          return typeof p.text === "string" ? p.text : "";
        }
        return "";
      })
      .join("");
  }
  if (Array.isArray(record.messages)) return record.messages.map(extractText).join("");
  return "";
}

function hasToolCall(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.toolCalls) && record.toolCalls.length > 0) return true;
  if (Array.isArray(record.content)) {
    return record.content.some(
      (part) =>
        !!part &&
        typeof part === "object" &&
        ["tool-call", "tool_call", "toolCall"].includes(
          String((part as Record<string, unknown>).type),
        ),
    );
  }
  return false;
}

function stopReason(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return typeof record.stopReason === "string"
    ? record.stopReason
    : typeof record.finishReason === "string"
      ? record.finishReason
      : undefined;
}

export async function runText(input: RunTextInput): Promise<RunTextResult> {
  if (input.signal?.aborted)
    throw createWriteForError("GENERATION_FAILED", "generation was cancelled");
  const selected = selectWritingModel(input.ctx.modelRegistry, input.ctx.model, input.model);
  const identity = modelIdentity(selected);
  const context = buildPiContext(input.messages);
  let abort: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    if (!input.signal) return;
    abort = () => reject(createWriteForError("GENERATION_FAILED", "generation was cancelled"));
    input.signal.addEventListener("abort", abort, { once: true });
  });
  const completionPromise = Promise.resolve().then(() =>
    input.ctx.modelRegistry.complete(selected, context, { signal: input.signal }),
  );
  completionPromise.catch(() => undefined);
  try {
    const final = await Promise.race([completionPromise, abortPromise]);
    const reason = stopReason(final);
    if (reason && !["stop", "end", "complete", "completed", "done"].includes(reason)) {
      throw createWriteForError("GENERATION_FAILED", `model generation stopped: ${reason}`);
    }
    if (hasToolCall(final))
      throw createWriteForError("GENERATION_FAILED", "model returned a tool call instead of text");
    const text = extractText(final);
    if (text.length === 0)
      throw createWriteForError("GENERATION_FAILED", "model returned empty text");
    const usage = normalizeUsage((final as Record<string, unknown> | undefined)?.usage);
    return { text, model: identity, usage };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      (error as { name?: unknown }).name === "WriteForError"
    )
      throw error;
    throw createWriteForError(
      "GENERATION_FAILED",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    if (input.signal && abort) input.signal.removeEventListener("abort", abort);
  }
}
