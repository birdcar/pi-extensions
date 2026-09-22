import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { DraftRequest, RewriteRequest, WritingResult } from "./contract.js";
import { createWritingEngine, type WritingEngineOptions } from "./engine.js";
import { createWriteForError } from "./errors.js";

interface ParsedCommand {
  channel?: string;
  register?: string;
  rewrite?: string;
  topic?: string;
}

function tokenize(input: string): string[] {
  return input.trim().length ? input.trim().split(/\s+/) : [];
}

export function parseWriteForArgs(args: string): ParsedCommand {
  const tokens = tokenize(args);
  const parsed: ParsedCommand = {};
  let literal = false;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (!literal && token === "--") {
      literal = true;
      continue;
    }
    if (!literal && token === "--register") {
      const value = tokens[++i];
      if (!value) throw createWriteForError("INVALID_REQUEST", "--register requires a value");
      parsed.register = value;
      continue;
    }
    if (!literal && token === "--rewrite") {
      const text = tokens
        .slice(i + 1)
        .join(" ")
        .trim();
      if (!text) throw createWriteForError("INVALID_REQUEST", "--rewrite requires text");
      parsed.rewrite = text;
      break;
    }
    if (!parsed.channel) parsed.channel = token;
    else parsed.topic = [parsed.topic, token].filter(Boolean).join(" ");
  }
  if (parsed.rewrite && parsed.topic) {
    throw createWriteForError(
      "INVALID_REQUEST",
      "--rewrite is mutually exclusive with a draft topic",
    );
  }
  return parsed;
}

function visibleTextFromSession(ctx: ExtensionCommandContext): string {
  const entries = ctx.sessionManager.getBranch() as unknown as Array<Record<string, unknown>>;
  const parts: string[] = [];
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const message = entry.message as Record<string, unknown> | undefined;
    const role = message?.role;
    if (role !== "user" && role !== "assistant") continue;
    if (!message) continue;
    const content = message.content;
    if (typeof content === "string") parts.push(`${role}: ${content}`);
    else if (Array.isArray(content)) {
      const text = content
        .map((part) => {
          if (typeof part === "string") return part;
          if (part && typeof part === "object") {
            const p = part as Record<string, unknown>;
            if (
              p.type === "tool-call" ||
              p.type === "tool_call" ||
              p.type === "tool-result" ||
              p.type === "tool_result"
            )
              return "";
            return typeof p.text === "string" ? p.text : "";
          }
          return "";
        })
        .join("")
        .trim();
      if (text) parts.push(`${role}: ${text}`);
    }
  }
  return parts.join("\n\n").trim();
}

async function present(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  result: WritingResult,
): Promise<void> {
  const message = `${result.text}\n\n— ${result.model.provider}/${result.model.id}, ${result.register} for ${result.channel}`;
  if (!ctx.hasUI) {
    pi.sendMessage?.({
      customType: "birdcar.write-for.result",
      content: message,
      display: true,
      details: undefined,
    });
    return;
  }
  ctx.ui.notify(message, "info");
}

export function registerWriteForCommands(
  pi: ExtensionAPI,
  options: WritingEngineOptions = {},
): void {
  const engine = createWritingEngine(options);
  pi.registerCommand("write-for", {
    description: "Draft or rewrite text for a configured voice/channel",
    async handler(args, ctx) {
      const parsed = parseWriteForArgs(args);
      let channel = parsed.channel;
      if (!channel) {
        if (!ctx.hasUI)
          throw createWriteForError("NO_UI", "channel is required when UI is unavailable");
        channel = (await ctx.ui.input("Write for channel", "slack")) ?? undefined;
      }
      if (!channel) throw createWriteForError("INVALID_REQUEST", "channel is required");
      if (parsed.rewrite) {
        const request: RewriteRequest = { channel, text: parsed.rewrite };
        if (parsed.register) request.register = parsed.register;
        if (ctx.signal) request.signal = ctx.signal;
        return present(pi, ctx, await engine.rewrite(ctx, request));
      }
      let subject = parsed.topic?.trim();
      let context: string | undefined;
      if (!subject) {
        context = visibleTextFromSession(ctx);
        if (!context)
          throw createWriteForError(
            "INVALID_REQUEST",
            "topic is required when session history is empty",
          );
        subject = "Summarize the visible current Pi session branch.";
      }
      const request: DraftRequest = { channel, subject };
      if (parsed.register) request.register = parsed.register;
      if (context) request.context = context;
      if (ctx.signal) request.signal = ctx.signal;
      return present(pi, ctx, await engine.draft(ctx, request));
    },
  });
}
