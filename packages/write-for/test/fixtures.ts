/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export class TestEventBus {
  handlers = new Map<string, Set<(payload: unknown) => void>>();
  on(channel: string, handler: (payload: unknown) => void): () => void {
    const set = this.handlers.get(channel) ?? new Set();
    set.add(handler);
    this.handlers.set(channel, set);
    return () => set.delete(handler);
  }
  emit(channel: string, payload: unknown): void {
    for (const handler of [...(this.handlers.get(channel) ?? [])]) handler(payload);
  }
}

export function makePi() {
  const bus = new TestEventBus();
  const shutdown: Array<() => void | Promise<void>> = [];
  const sessionStart: Array<(event: unknown, ctx: any) => void> = [];
  const commands = new Map<string, any>();
  const messages: any[] = [];
  return {
    pi: {
      events: bus,
      on(event: string, handler: any) {
        if (event === "session_shutdown") shutdown.push(() => handler({}, undefined));
        if (event === "session_start") sessionStart.push(handler);
        return () => undefined;
      },
      registerCommand(name: string, options: any) {
        commands.set(name, options);
      },
      sendMessage(message: any) {
        messages.push(message);
      },
    } as any,
    bus,
    commands,
    messages,
    start(ctx: any) {
      for (const h of sessionStart) h({}, ctx);
    },
    async stop() {
      for (const h of shutdown) await h();
    },
  };
}

export function makeProfile() {
  const root = mkdtempSync(join(tmpdir(), "pi-write-for-"));
  mkdirSync(join(root, "registers"));
  mkdirSync(join(root, "channels"));
  writeFileSync(join(root, "style.md"), "Plain style");
  writeFileSync(join(root, "registers", "pro.md"), "Professional voice");
  writeFileSync(join(root, "registers", "professional.md"), "Professional voice");
  writeFileSync(join(root, "registers", "internal.md"), "Internal voice");
  writeFileSync(join(root, "channels", "email.md"), "Email format");
  writeFileSync(join(root, "channels", "slack.md"), "---\ndefaultRegister: pro\n---\nSlack format");
  return root;
}

export function makeCtx(root = makeProfile()) {
  const model = { provider: "test", id: "m1" };
  const calls: any[] = [];
  const ctx = {
    cwd: process.cwd(),
    model,
    hasUI: false,
    signal: undefined,
    ui: { notify() {}, input: async () => undefined },
    isProjectTrusted: () => true,
    sessionManager: { getBranch: () => [] },
    modelRegistry: {
      find: (provider: string, id: string) =>
        provider === "test" && id === "m1" ? model : undefined,
      hasConfiguredAuth: () => true,
      complete: async (_model: any, context: any) => {
        calls.push(context);
        return {
          text: "draft text",
          stopReason: "stop",
          usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: { total: 0.01 } },
        };
      },
    },
  } as any;
  return { ctx, root, calls };
}
