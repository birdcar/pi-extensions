import { describe, expect, test } from "bun:test";
import writeForExtension from "../src/index.ts";
import { parseWriteForArgs, registerWriteForCommands } from "../src/commands.ts";
import { makeCtx, makePi } from "./fixtures.ts";

describe("command entrypoint", () => {
  test("parses flags", () => {
    expect(parseWriteForArgs("email --register pro launch notes")).toEqual({
      channel: "email",
      register: "pro",
      topic: "launch notes",
    });
    expect(parseWriteForArgs("slack --rewrite make this short").rewrite).toBe("make this short");
  });

  test("registers command handler", async () => {
    const harness = makePi();
    const { ctx, root } = makeCtx();
    registerWriteForCommands(harness.pi, { env: { envConfig: root } });
    await expect(
      harness.commands.get("write-for").handler("email --register pro topic", ctx),
    ).resolves.toBeUndefined();
    expect(harness.messages.at(-1)?.content).toContain("draft text");
  });

  test("extension factory preserves state shape", () => {
    const harness = makePi();
    expect(writeForExtension(harness.pi).configDirectoryName).toBeString();
  });
});
