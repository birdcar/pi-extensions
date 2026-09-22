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
  integrity?: string;
  repositoryUrl?: string;
}

export interface PackageArtifactOptions {
  rootDir?: string;
  packagePath?: string;
  keepTemp?: boolean;
  dependencyTarballs?: string[];
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
  const root = resolve(options.rootDir ?? import.meta.dirname, options.rootDir ? "." : "..");
  const packagePath = options.packagePath ?? "packages/services";
  const packageDir = resolve(root, packagePath);
  const temp = mkdtempSync(join(tmpdir(), "pi-package-"));

  try {
    requireReadmeAndLicense(packageDir);
    run("bun", ["run", "build"], root);
    const packJson = run("npm", ["pack", "--json", "--pack-destination", temp], packageDir);
    const [packed] = JSON.parse(packJson) as Array<{
      filename: string;
      name: string;
      version: string;
      integrity?: string;
      files: Array<{ path: string }>;
    }>;
    if (!packed) throw new Error("npm pack produced no tarball metadata");
    const paths = packed.files.map((file) => file.path).sort();
    const forbidden = paths.filter((path) =>
      /(^|\/)(src|test|tests|fixtures)(\/|$)|(?<!\.d)\.ts$/.test(path),
    );
    if (forbidden.length > 0)
      throw new Error(`tarball contains forbidden files: ${forbidden.join(", ")}`);
    for (const required of [
      "dist/index.js",
      "dist/index.d.ts",
      "LICENSE",
      "README.md",
      "package.json",
    ]) {
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
    const repository = manifest.repository as string | { url?: unknown } | undefined;
    const repositoryUrl =
      typeof repository === "string"
        ? repository
        : typeof repository?.url === "string"
          ? repository.url
          : undefined;
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

    if (!existsSync(tarball)) throw new Error(`tarball missing at ${tarball}`);
    return {
      name: packed.name,
      version: packed.version,
      tarball,
      filename: packed.filename,
      files: paths,
      integrity: packed.integrity,
      repositoryUrl,
    };
  } finally {
    if (!options.keepTemp) rmSync(temp, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const services = validatePackageArtifact({ keepTemp: true });
  try {
    const writer = validatePackageArtifact({
      packagePath: "packages/write-for",
      dependencyTarballs: [services.tarball],
    });
    console.log(
      `package artifacts verified: ${basename(services.tarball)}, ${basename(writer.tarball)}`,
    );
  } finally {
    rmSync(dirname(services.tarball), { recursive: true, force: true });
  }
}
