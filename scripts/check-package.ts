import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const packageDir = join(root, "packages/services");
const temp = mkdtempSync(join(tmpdir(), "pi-services-package-"));

function run(command: string, args: string[], cwd = root): string {
  return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

try {
  run("bun", ["run", "build"]);
  const packJson = run("npm", ["pack", "--json", "--pack-destination", temp], packageDir);
  const [packed] = JSON.parse(packJson) as Array<{
    filename: string;
    files: Array<{ path: string }>;
  }>;
  if (!packed) throw new Error("npm pack produced no tarball metadata");
  const paths = packed.files.map((file) => file.path).sort();
  const forbidden = paths.filter((path) =>
    /(^|\/)(src|test|tests|fixtures)(\/|$)|(?<!\.d)\.ts$/.test(path),
  );
  if (forbidden.length > 0)
    throw new Error(`tarball contains forbidden files: ${forbidden.join(", ")}`);
  for (const required of ["dist/index.js", "dist/index.d.ts", "LICENSE", "package.json"]) {
    if (!paths.includes(required)) throw new Error(`tarball missing ${required}`);
  }

  run("npm", ["init", "-y"], temp);
  run("npm", ["install", join(temp, packed.filename), "--ignore-scripts"], temp);
  const secondConsumer = join(temp, "second-consumer");
  mkdirSync(secondConsumer);
  run("npm", ["init", "-y"], secondConsumer);
  run("npm", ["install", join(temp, packed.filename), "--ignore-scripts"], secondConsumer);
  const secondCopyUrl = pathToFileURL(
    join(secondConsumer, "node_modules/@birdcar/pi-services/dist/index.js"),
  ).href;
  const manifest = JSON.parse(
    readFileSync(join(temp, "node_modules/@birdcar/pi-services/package.json"), "utf8"),
  ) as Record<string, unknown>;
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"] as const) {
    const deps = manifest[field] as Record<string, string> | undefined;
    for (const [name, version] of Object.entries(deps ?? {})) {
      if (version.startsWith("workspace:") || version.startsWith("file:")) {
        throw new Error(`${field} ${name} uses non-publishable ${version}`);
      }
      if (name.startsWith("@earendil-works/"))
        throw new Error("helper must not depend on Pi packages");
    }
  }

  writeFileSync(
    join(temp, "consumer.mjs"),
    `import { discoverService, provideService, isServiceError } from "@birdcar/pi-services";\n` +
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
    `import { type ServiceContract, discoverService, isServiceError } from "@birdcar/pi-services";\n` +
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
  run(join(root, "node_modules/.bin/tsc"), ["-p", join(temp, "tsconfig.json"), "--noEmit"], temp);

  const tarball = join(temp, packed.filename);
  if (!existsSync(tarball)) throw new Error(`tarball missing at ${tarball}`);
  console.log(`package artifact verified: ${basename(tarball)}`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
