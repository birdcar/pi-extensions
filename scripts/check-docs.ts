import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface DocsValidationResult {
  ok: boolean;
  errors: string[];
}

const maintainedDocs = [
  "README.md",
  "AGENTS.md",
  "docs/service-discovery.md",
  "docs/releasing.md",
  "packages/services/README.md",
];

function lineFor(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function validateLinks(rootDir: string, file: string, errors: string[]): void {
  const absolute = join(rootDir, file);
  const text = readFileSync(absolute, "utf8");
  const linkPattern = /\[[^\]]+\]\(([^)]+)\)|`([^`]+\.(?:ts|md|json|yml|yaml))`/g;
  for (const match of text.matchAll(linkPattern)) {
    const raw = match[1] ?? match[2];
    if (!raw || /^(https?:|mailto:|npm:|#)/.test(raw)) continue;
    const target = raw.split("#")[0]?.trim();
    if (!target || target.startsWith("pi install ")) continue;
    const resolved = resolve(dirname(absolute), target);
    const relative = normalize(resolved.slice(resolve(rootDir).length + 1));
    if (relative.startsWith("..")) {
      errors.push(`${file}:${lineFor(text, match.index ?? 0)}: link escapes repository: ${raw}`);
    } else if (!existsSync(resolved)) {
      errors.push(`${file}:${lineFor(text, match.index ?? 0)}: missing link target: ${raw}`);
    }
  }
}

function extractExampleFiles(rootDir: string, errors: string[]): string[] {
  const examples = new Set<string>();
  for (const file of maintainedDocs) {
    const text = readFileSync(join(rootDir, file), "utf8");
    for (const match of text.matchAll(/`([^`]*tests\/fixtures\/services\/[^`]+\.ts)`/g)) {
      const target = match[1];
      if (!target) continue;
      const resolved = resolve(dirname(join(rootDir, file)), target);
      const relative = normalize(resolved.slice(resolve(rootDir).length + 1));
      if (!existsSync(resolved) || relative.startsWith("..")) {
        errors.push(
          `${file}:${lineFor(text, match.index ?? 0)}: missing referenced example: ${target}`,
        );
      } else {
        examples.add(relative);
      }
    }
  }
  return [...examples];
}

function compileExamples(rootDir: string, examples: string[], errors: string[]): void {
  if (examples.length === 0) return;
  const temp = mkdtempSync(join(tmpdir(), "pi-docs-"));
  try {
    writeFileSync(
      join(temp, "tsconfig.json"),
      JSON.stringify({
        extends: join(rootDir, "tsconfig.json"),
        compilerOptions: {
          noEmit: true,
          rootDir,
          allowImportingTsExtensions: true,
          typeRoots: [join(rootDir, "node_modules/@types")],
        },
        include: examples.map((path) => join(rootDir, path)),
      }),
    );
    execFileSync(join(rootDir, "node_modules/.bin/tsc"), ["-p", join(temp, "tsconfig.json")], {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
  } catch (error) {
    const output =
      error && typeof error === "object" ? (error as { stderr?: unknown; stdout?: unknown }) : {};
    const diagnostics = `${String(output.stdout ?? "")}${String(output.stderr ?? "")}`.trim();
    errors.push(
      `referenced TypeScript examples failed to compile: ${diagnostics || String(error)}`,
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

export function validateDocs(rootDir = process.cwd()): DocsValidationResult {
  const errors: string[] = [];
  for (const file of maintainedDocs) {
    if (!existsSync(join(rootDir, file))) {
      errors.push(`${file}: maintained documentation file is missing`);
      continue;
    }
    if (extname(file) === ".md" || file === "AGENTS.md") validateLinks(rootDir, file, errors);
  }
  const examples = extractExampleFiles(rootDir, errors);
  compileExamples(rootDir, examples, errors);
  return { ok: errors.length === 0, errors };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = validateDocs();
  if (!result.ok) {
    console.error(result.errors.join("\n"));
    process.exit(1);
  }
  console.log("documentation links and examples are valid");
}
