import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "bun:test";
import { resolveWritingProfile } from "../src/config.ts";
import { isWriteForError } from "../src/contract.ts";

function root(): string {
  return mkdtempSync(join(tmpdir(), "write-for-config-"));
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function base(cwd: string, home: string) {
  return { cwd, home, trustedProject: true, piConfigDirName: ".pi", channel: "email" };
}

describe("write-for config resolution", () => {
  test("uses global profiles and built-in default registers", () => {
    const dir = root();
    const home = join(dir, "home");
    write(join(home, ".config/pi-write-for/style.md"), "Global style");
    write(join(home, ".config/pi-write-for/registers/professional.md"), "Professional voice");
    const profile = resolveWritingProfile(base(join(dir, "work"), home));
    expect(profile.register).toBe("professional");
    expect(profile.prose).toContain("Global style");
    expect(profile.prose).toContain("Professional voice");
    expect(profile.channelBody).toContain("email");
  });

  test("nearest trusted project root overrides farther ancestors but frontmatter-only bodies inherit", () => {
    const dir = root();
    const home = join(dir, "home");
    const outer = join(dir, "repo/.pi/write-for");
    const inner = join(dir, "repo/app/.pi/write-for");
    write(join(home, ".config/pi-write-for/style.md"), "Global style");
    write(join(home, ".config/pi-write-for/registers/professional.md"), "Global voice");
    write(join(home, ".config/pi-write-for/channels/email.md"), "Global channel");
    write(join(outer, "registers/professional.md"), "Outer voice");
    write(join(inner, "style.md"), "---\nmodel: local/style\n---\n");
    write(join(inner, "channels/email.md"), "Local channel");
    const profile = resolveWritingProfile(base(join(dir, "repo/app/src"), home));
    expect(profile.style).toBe("Global style");
    expect(profile.registerBody).toBe("Global voice");
    expect(profile.channelBody).toBe("Local channel");
    expect(profile.model?.value).toBe("local/style");
  });

  test("environment root is selected and project-local env roots require trust", () => {
    const dir = root();
    const home = join(dir, "home");
    const envRoot = join(dir, "chosen");
    write(join(envRoot, "registers/professional.md"), "Chosen voice");
    write(join(home, ".config/pi-write-for/registers/professional.md"), "Global voice");
    const profile = resolveWritingProfile({ ...base(join(dir, "work"), home), envConfig: envRoot });
    expect(profile.registerBody).toBe("Chosen voice");
    expect(() =>
      resolveWritingProfile({ ...base(join(dir, "work"), home), envConfig: join(dir, "missing") }),
    ).toThrow();
    const local = join(dir, "work/config");
    write(join(local, "registers/professional.md"), "Local voice");
    expect(() =>
      resolveWritingProfile({
        ...base(join(dir, "work"), home),
        envConfig: local,
        trustedProject: false,
      }),
    ).toThrow("trust");
    const ancestorLocal = join(dir, "repo/.pi/write-for");
    write(join(ancestorLocal, "registers/professional.md"), "Ancestor voice");
    expect(() =>
      resolveWritingProfile({
        ...base(join(dir, "repo/app"), home),
        envConfig: ancestorLocal,
        trustedProject: false,
      }),
    ).toThrow("trust");
  });

  test("trust denial ignores project config but still allows global profiles", () => {
    const dir = root();
    const home = join(dir, "home");
    write(join(home, ".config/pi-write-for/registers/professional.md"), "Global voice");
    write(join(dir, "repo/.pi/write-for/registers/professional.md"), "Project voice");
    const profile = resolveWritingProfile({
      ...base(join(dir, "repo"), home),
      trustedProject: false,
    });
    expect(profile.registerBody).toBe("Global voice");
  });

  test("missing or empty required voices fail", () => {
    const dir = root();
    expect(() => resolveWritingProfile(base(join(dir, "work"), join(dir, "home")))).toThrow(
      "professional",
    );
    write(join(dir, "home/.config/pi-write-for/registers/professional.md"), "   ");
    expect(() => resolveWritingProfile(base(join(dir, "work"), join(dir, "home")))).toThrow(
      "trained voice",
    );
  });

  test("malformed frontmatter, unsafe names, and symlink escapes fail", () => {
    const dir = root();
    const home = join(dir, "home");
    write(join(home, ".config/pi-write-for/registers/professional.md"), "Voice");
    write(join(home, ".config/pi-write-for/channels/email.md"), "---\nmodel: \n---\nBody");
    expect(() => resolveWritingProfile(base(join(dir, "work"), home))).toThrow();
    expect(() =>
      resolveWritingProfile({ ...base(join(dir, "work"), home), register: "../bad" }),
    ).toThrow();

    const safe = join(dir, "safe");
    const outside = join(dir, "outside.md");
    write(outside, "escaped");
    mkdirSync(join(safe, "registers"), { recursive: true });
    symlinkSync(outside, join(safe, "registers/professional.md"));
    expect(() =>
      resolveWritingProfile({
        ...base(join(dir, "work"), join(dir, "clean-home")),
        envConfig: safe,
      }),
    ).toThrow("escapes");
  });

  test("custom channels require a register unless they define a default", () => {
    const dir = root();
    const home = join(dir, "home");
    write(join(home, ".config/pi-write-for/registers/internal.md"), "Internal voice");
    expect(() =>
      resolveWritingProfile({ ...base(join(dir, "work"), home), channel: "pager" }),
    ).toThrow("register");
    write(
      join(home, ".config/pi-write-for/channels/pager.md"),
      "---\r\ndefaultRegister: internal\r\n---\r\nPager format",
    );
    const profile = resolveWritingProfile({ ...base(join(dir, "work"), home), channel: "pager" });
    expect(profile.register).toBe("internal");
    expect(profile.channelBody).toBe("Pager format");
  });

  test("frontmatter closing delimiter must be on its own line", () => {
    const dir = root();
    const home = join(dir, "home");
    write(join(home, ".config/pi-write-for/registers/professional.md"), "Voice");
    write(
      join(home, ".config/pi-write-for/channels/email.md"),
      "---\nmodel: local/email\n---not closed",
    );
    expect(() => resolveWritingProfile(base(join(dir, "work"), home))).toThrow(
      "frontmatter is not closed",
    );
  });

  test("model precedence is global style/register/channel then local style/register/channel", () => {
    const dir = root();
    const home = join(dir, "home");
    const project = join(dir, "repo/.pi/write-for");
    write(join(home, ".config/pi-write-for/style.md"), "---\nmodel: global/style\n---\nStyle");
    write(
      join(home, ".config/pi-write-for/registers/professional.md"),
      "---\nmodel: global/register\n---\nVoice",
    );
    write(
      join(home, ".config/pi-write-for/channels/email.md"),
      "---\nmodel: global/channel\n---\nGlobal channel",
    );
    write(join(project, "style.md"), "---\nmodel: local/style\n---\n");
    write(join(project, "registers/professional.md"), "---\nmodel: local/register\n---\n");
    write(join(project, "channels/email.md"), "---\nmodel: local/channel/deep\n---\nLocal channel");
    const profile = resolveWritingProfile({
      ...base(join(dir, "repo"), home),
      activeModel: "active/model",
    });
    expect(profile.model).toMatchObject({
      provider: "local",
      id: "channel/deep",
      value: "local/channel/deep",
    });
    expect(profile.registerBody).toBe("Voice");
  });

  test("errors remain structural", () => {
    try {
      resolveWritingProfile({ ...base(root(), root()), channel: "Bad/Name" });
      throw new Error("expected failure");
    } catch (error) {
      expect(isWriteForError(error)).toBe(true);
    }
  });
});
