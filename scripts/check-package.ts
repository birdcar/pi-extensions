import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface PackageArtifact {
  name: string;
  version: string;
  tarball: string;
  filename: string;
  files: string[];
}

export interface PackageArtifactOptions {
  packagePath?: string;
  keepTemp?: boolean;
  dependencyTarballs?: string[];
  skipBuild?: boolean;
}

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function requireReadmeAndLicense(packageDir: string): void {
  for (const file of ["README.md", "LICENSE"] as const) {
    if (!existsSync(join(packageDir, file)))
      throw new Error(`${file} is required before packaging`);
  }
}

export function validatePackageArtifact(options: PackageArtifactOptions = {}): PackageArtifact {
  const root = resolve(import.meta.dirname, "..");
  const packagePath = options.packagePath ?? "packages/services";
  const packageDir = resolve(root, packagePath);
  const temp = mkdtempSync(join(tmpdir(), "pi-package-"));

  try {
    requireReadmeAndLicense(packageDir);
    if (!options.skipBuild) run("bun", ["run", "build"], root);
    const packJson = run("npm", ["pack", "--json", "--pack-destination", temp], packageDir);
    const [packed] = JSON.parse(packJson) as Array<{
      filename: string;
      name: string;
      version: string;
      files: Array<{ path: string }>;
    }>;
    if (!packed) throw new Error("npm pack produced no tarball metadata");
    const paths = packed.files.map((file) => file.path).sort();
    const forbidden = paths.filter((path) =>
      /(^|\/)(src|test|tests|fixtures)(\/|$)|(?<!\.d)\.ts$/.test(path),
    );
    if (forbidden.length > 0)
      throw new Error(`tarball contains forbidden files: ${forbidden.join(", ")}`);
    const requiredFiles = [
      "dist/index.js",
      "dist/index.d.ts",
      "LICENSE",
      "README.md",
      "package.json",
    ];
    if (packagePath === "packages/write-for") {
      requiredFiles.push("dist/contract.js", "dist/contract.d.ts", "dist/document-worker.js");
    }
    for (const required of requiredFiles) {
      if (!paths.includes(required)) throw new Error(`tarball missing ${required}`);
    }

    run("npm", ["init", "-y"], temp);
    const tarball = join(temp, packed.filename);
    run(
      "npm",
      ["install", ...(options.dependencyTarballs ?? []), tarball, "--ignore-scripts"],
      temp,
    );
    const installedPackageDir = join(temp, "node_modules", packed.name);
    const manifest = JSON.parse(
      readFileSync(join(installedPackageDir, "package.json"), "utf8"),
    ) as Record<string, unknown>;
    if (manifest.name !== packed.name || manifest.version !== packed.version) {
      throw new Error(`installed package metadata does not match ${packed.name}@${packed.version}`);
    }
    for (const field of ["dependencies", "optionalDependencies", "peerDependencies"] as const) {
      const deps = manifest[field] as Record<string, string> | undefined;
      for (const [name, version] of Object.entries(deps ?? {})) {
        if (version.startsWith("workspace:") || version.startsWith("file:")) {
          throw new Error(`${field} ${name} uses non-publishable ${version}`);
        }
        if (packed.name === "@birdcar/pi-services" && name.startsWith("@earendil-works/"))
          throw new Error("services helper must not depend on Pi packages");
      }
    }

    const piExtensions = manifest.pi as { extensions?: unknown } | undefined;
    if (packed.name === "@birdcar/pi-write-for") {
      if (
        !Array.isArray(piExtensions?.extensions) ||
        !piExtensions.extensions.includes("./dist/index.js")
      ) {
        throw new Error("writer pi.extensions must include shipped ./dist/index.js");
      }
      for (const name of ["mammoth", "unpdf", "@birdcar/pi-services"] as const) {
        const deps = manifest.dependencies as Record<string, string> | undefined;
        if (!deps?.[name]) throw new Error(`writer dependency ${name} is required`);
      }
    }

    if (packed.name === "@birdcar/pi-services") {
      const secondConsumer = join(temp, "second-consumer");
      mkdirSync(secondConsumer);
      run("npm", ["init", "-y"], secondConsumer);
      run("npm", ["install", tarball, "--ignore-scripts"], secondConsumer);
      const secondCopyUrl = pathToFileURL(
        join(secondConsumer, "node_modules", packed.name, "dist/index.js"),
      ).href;

      writeFileSync(
        join(temp, "consumer.mjs"),
        `import { discoverService, provideService, isServiceError } from "${packed.name}";\n` +
          `import { createServiceError as createServiceErrorFromSecondCopy } from ${JSON.stringify(secondCopyUrl)};\n` +
          `const crossCopyError = createServiceErrorFromSecondCopy("SERVICE_CONTRACT", "from independent copy");\n` +
          `if (!isServiceError(crossCopyError) || crossCopyError.code !== "SERVICE_CONTRACT") throw new Error("cross-copy service error classification failed");\n` +
          `const listeners = new Map();\n` +
          `const host = { events: { emit(c,p){ for (const h of listeners.get(c) ?? []) h(p); }, on(c,h){ const a = listeners.get(c) ?? []; a.push(h); listeners.set(c,a); return () => listeners.set(c, a.filter(x => x !== h)); } }, on(_e,h){ this.shutdown = h; } };\n` +
          `const contract = { id: "birdcar.test.echo", apiMajor: 1, isApi(v){ return v && typeof v.echo === "function"; } };\n` +
          `const reg = provideService(host, { id: contract.id, apiMajor: 1, api: { async echo(v){ return v; } } });\n` +
          `const api = discoverService(host.events, contract); if (!api || await api.echo("ok") !== "ok") throw new Error("bad discovery");\n` +
          `await reg.dispose(); try { await api.echo("stale"); throw new Error("expected stale"); } catch (e) { if (!isServiceError(e) || e.code !== "SERVICE_DISPOSED") throw e; }\n`,
      );
      run("node", [join(temp, "consumer.mjs")], temp);

      writeFileSync(
        join(temp, "consumer.ts"),
        `import { type ServiceContract, discoverService, isServiceError } from "${packed.name}";\n` +
          `interface Api { echo(value: string): Promise<string>; }\n` +
          `const contract: ServiceContract<Api> = { id: "birdcar.test.echo", apiMajor: 1, isApi(value): value is Api { return !!value && typeof value === "object" && typeof (value as Api).echo === "function"; } };\n` +
          `discoverService({ emit() {}, on() { return () => undefined; } }, contract);\n` +
          `isServiceError({ name: "ServiceError", message: "x", code: "SERVICE_CONTRACT" });\n`,
      );
      writeFileSync(
        join(temp, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            module: "NodeNext",
            moduleResolution: "NodeNext",
            target: "ES2022",
            strict: true,
            skipLibCheck: true,
          },
          include: ["consumer.ts"],
        }),
      );
      run(
        join(root, "node_modules/.bin/tsc"),
        ["-p", join(temp, "tsconfig.json"), "--noEmit"],
        temp,
      );
    }

    if (packed.name === "@birdcar/pi-write-for") {
      const fixtureDir = join(temp, "writer-fixtures");
      mkdirSync(fixtureDir);
      const sourceFixtureDir = join(root, "packages/write-for/test/fixtures");
      const pdfFixture = join(fixtureDir, "synthetic.pdf");
      const docxFixture = join(fixtureDir, "synthetic.docx");
      writeFileSync(pdfFixture, readFileSync(join(sourceFixtureDir, "voice.pdf")));
      writeFileSync(docxFixture, readFileSync(join(sourceFixtureDir, "voice.docx")));
      writeFileSync(
        join(temp, "writer-contract-consumer.mjs"),
        `import { discoverService } from "@birdcar/pi-services";\n` +
          `import { WRITE_FOR_REWRITE_EVENT, writeForContract } from "${packed.name}/contract";\n` +
          `const listeners = new Map();\n` +
          `const events = {\n` +
          `  emit(channel, data) { for (const handler of listeners.get(channel) ?? []) handler(data); },\n` +
          `  on(channel, handler) {\n` +
          `    const handlers = listeners.get(channel) ?? new Set();\n` +
          `    handlers.add(handler);\n` +
          `    listeners.set(channel, handlers);\n` +
          `    return () => handlers.delete(handler);\n` +
          `  },\n` +
          `};\n` +
          `if (WRITE_FOR_REWRITE_EVENT !== "birdcar.write-for:v1:rewrite") throw new Error("bad rewrite event export");\n` +
          `if (discoverService(events, writeForContract) !== undefined) throw new Error("clean contract consumer should not discover an unprovided service");\n` +
          `if (!writeForContract.isApi({ draft: async () => ({}), rewrite: async () => ({}) })) throw new Error("contract guard rejected api shape");\n`,
      );
      run("node", [join(temp, "writer-contract-consumer.mjs")], temp);

      writeFileSync(
        join(temp, "writer-consumer.mjs"),
        `import { discoverService } from "@birdcar/pi-services";\n` +
          `import { WRITE_FOR_REWRITE_EVENT, writeForContract } from "${packed.name}/contract";\n` +
          `import extension from "${packed.name}";\n` +
          `const documents = await import(${JSON.stringify(pathToFileURL(join(installedPackageDir, "dist/documents.js")).href)});\n` +
          `if (typeof extension !== "function") throw new Error("extension entrypoint did not load");\n` +
          `const listeners = new Map();\n` +
          `const events = {\n` +
          `  emit(channel, data) { for (const handler of listeners.get(channel) ?? []) handler(data); },\n` +
          `  on(channel, handler) {\n` +
          `    const handlers = listeners.get(channel) ?? new Set();\n` +
          `    handlers.add(handler);\n` +
          `    listeners.set(channel, handlers);\n` +
          `    return () => handlers.delete(handler);\n` +
          `  },\n` +
          `};\n` +
          `const lifecycle = new Map();\n` +
          `const commands = new Map();\n` +
          `const tools = new Map();\n` +
          `const host = {\n` +
          `  events,\n` +
          `  on(event, handler) {\n` +
          `    const handlers = lifecycle.get(event) ?? new Set();\n` +
          `    handlers.add(handler);\n` +
          `    lifecycle.set(event, handlers);\n` +
          `    return () => handlers.delete(handler);\n` +
          `  },\n` +
          `  registerCommand(name, command) { commands.set(name, command); },\n` +
          `  registerTool(tool) { tools.set(tool.name, tool); },\n` +
          `  diagnostic(message) { throw new Error(String(message)); },\n` +
          `};\n` +
          `const state = extension(host);\n` +
          `if (!commands.has("write-for") || !tools.has("write_for_profile")) throw new Error("installed extension did not register commands/tools");\n` +
          `if (!discoverService(events, writeForContract)) throw new Error("installed extension did not provide service");\n` +
          `events.emit(WRITE_FOR_REWRITE_EVENT, { request: { channel: "email", text: "hi" }, accept(promise) { promise.catch(() => undefined); } });\n` +
          `state.dispose();\n` +
          `if (discoverService(events, writeForContract) !== undefined) throw new Error("installed extension service did not dispose");\n` +
          `const pdf = await documents.extractDocumentText({ path: ${JSON.stringify(pdfFixture)} });\n` +
          `if (!pdf.text.includes("Warm practical prose on page one.") || pdf.pages !== 2) throw new Error("installed PDF worker extraction failed");\n` +
          `const docx = await documents.extractDocumentText({ path: ${JSON.stringify(docxFixture)} });\n` +
          `if (!docx.text.includes("Split runs make one sentence.")) throw new Error("installed DOCX worker extraction failed");\n`,
      );
      run("node", [join(temp, "writer-consumer.mjs")], temp);

      writeFileSync(
        join(temp, "writer-consumer.ts"),
        `import { type WritingResult, type DraftRequest, writeForContract } from "${packed.name}/contract";\n` +
          `const request: DraftRequest = { channel: "email", subject: "status" };\n` +
          `const result: WritingResult = { text: "ok", channel: request.channel, register: "professional", model: { provider: "fixture", id: "writer" }, usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 } };\n` +
          `writeForContract.isApi({ draft: async () => result, rewrite: async () => result });\n`,
      );
      writeFileSync(
        join(temp, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            module: "NodeNext",
            moduleResolution: "NodeNext",
            target: "ES2022",
            strict: true,
            skipLibCheck: true,
          },
          include: ["writer-consumer.ts"],
        }),
      );
      run(
        join(root, "node_modules/.bin/tsc"),
        ["-p", join(temp, "tsconfig.json"), "--noEmit"],
        temp,
      );
    }

    if (!existsSync(tarball)) throw new Error(`tarball missing at ${tarball}`);
    return {
      name: packed.name,
      version: packed.version,
      tarball,
      filename: packed.filename,
      files: paths,
    };
  } finally {
    if (!options.keepTemp) rmSync(temp, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root = resolve(import.meta.dirname, "..");
  run("bun", ["run", "build"], root);
  const services = validatePackageArtifact({ keepTemp: true, skipBuild: true });
  try {
    const writer = validatePackageArtifact({
      packagePath: "packages/write-for",
      dependencyTarballs: [services.tarball],
      skipBuild: true,
    });
    console.log(
      `package artifacts verified: ${basename(services.tarball)}, ${basename(writer.tarball)}`,
    );
  } finally {
    rmSync(dirname(services.tarball), { recursive: true, force: true });
  }
}
