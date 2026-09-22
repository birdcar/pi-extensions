import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import YAML from "yaml";
import { builtInChannel, GENERIC_CHANNEL_BODY } from "./channels.js";
import { createWriteForError } from "./errors.js";
import type { WriteForError } from "./contract.js";

export interface ResolveWritingProfileInput {
  cwd: string;
  home?: string;
  xdgConfigHome?: string;
  envConfig?: string;
  trustedProject: boolean;
  piConfigDirName: string;
  channel: string;
  register?: string;
  activeModel?: string;
}

export interface ModelReference {
  provider: string;
  id: string;
  source: string;
  value: string;
}

export interface ResolvedWritingProfile {
  roots: { global?: string; project?: string; selected?: string };
  channel: string;
  register: string;
  prose: string;
  style?: string;
  registerBody: string;
  channelBody: string;
  model?: ModelReference;
}

interface Layer {
  root: "global" | "project";
  kind: "style" | "register" | "channel";
  name: string;
  path: string;
  exists: boolean;
  body?: string;
  metadata: LayerMetadata;
}

interface LayerMetadata {
  model?: string;
  defaultRegister?: string;
}

interface LoadedLayers {
  roots: { global?: string; project?: string; selected?: string };
  layers: Layer[];
  channelDefaultRegister?: string;
  builtInChannelBody: string;
}

const identifierPattern = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;
const recognizedFields = new Set(["model", "defaultRegister"]);

export function splitModelReference(value: string, source = "request"): ModelReference {
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) {
    throw createWriteForError("CONFIG_INVALID", `${source} model must be provider/model-id`);
  }
  return { provider: value.slice(0, slash), id: value.slice(slash + 1), source, value };
}

function assertIdentifier(value: string, label: string): void {
  if (!identifierPattern.test(value) || value.includes("..") || value.includes(sep)) {
    throw createWriteForError("CONFIG_INVALID", `${label} uses an unsafe name: ${value}`);
  }
}

function ensureContained(root: string, target: string): void {
  const rootReal = realpathSync(root);
  const targetReal = existsSync(target)
    ? realpathSync(target)
    : join(rootReal, relative(resolve(root), resolve(target)));
  const rel = relative(rootReal, targetReal);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return;
  throw createWriteForError(
    "CONFIG_INVALID",
    `configuration path escapes selected root: ${target}`,
  );
}

function globalRoot(input: ResolveWritingProfileInput): string {
  return resolve(input.xdgConfigHome ?? join(input.home ?? homedir(), ".config"), "pi-write-for");
}

function nearestProjectRoot(cwd: string, piConfigDirName: string): string | undefined {
  let current = resolve(cwd);
  while (true) {
    const candidate = join(current, piConfigDirName, "write-for");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function isProjectLocalExplicitRoot(
  cwd: string,
  explicit: string,
  piConfigDirName: string,
): boolean {
  const cwdRoot = resolve(cwd);
  const cwdRelative = relative(cwdRoot, explicit);
  if (cwdRelative === "" || (!cwdRelative.startsWith("..") && !isAbsolute(cwdRelative))) {
    return true;
  }
  let current = cwdRoot;
  while (true) {
    const candidate = resolve(current, piConfigDirName, "write-for");
    const rel = relative(candidate, explicit);
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function selectedProjectRoot(input: ResolveWritingProfileInput): string | undefined {
  if (input.envConfig) {
    const explicit = resolve(input.envConfig);
    if (!existsSync(explicit) || !lstatSync(explicit).isDirectory()) {
      throw createWriteForError(
        "CONFIG_INVALID",
        `PI_WRITE_FOR_CONFIG is not a directory: ${explicit}`,
      );
    }
    if (
      !input.trustedProject &&
      isProjectLocalExplicitRoot(input.cwd, explicit, input.piConfigDirName)
    ) {
      throw createWriteForError(
        "CONFIG_INVALID",
        "project-local PI_WRITE_FOR_CONFIG requires project trust",
      );
    }
    return explicit;
  }
  if (!input.trustedProject) return undefined;
  return nearestProjectRoot(input.cwd, input.piConfigDirName);
}

function fileFor(root: string, kind: Layer["kind"], name: string): string {
  if (kind === "style") return join(root, "style.md");
  if (kind === "register") return join(root, "registers", `${name}.md`);
  return join(root, "channels", `${name}.md`);
}

function splitFrontmatter(text: string): { yaml?: string; body: string } {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (!normalized.startsWith("---\n") && normalized !== "---") return { body: normalized.trim() };
  const frontmatter = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!frontmatter) throw createWriteForError("CONFIG_INVALID", "frontmatter is not closed");
  const yaml = frontmatter[1] ?? "";
  const body = normalized.slice(frontmatter[0].length).trim();
  return { yaml, body };
}

function metadataFromYaml(source: string, path: string, kind: Layer["kind"]): LayerMetadata {
  if (/^\s*![^=\s]/m.test(source) || /^\s*[^:#\n]+:\s*![^=\s]/m.test(source)) {
    throw createWriteForError("CONFIG_INVALID", `${path}: custom YAML tags are not supported`);
  }
  const doc = YAML.parseDocument(source, { schema: "core", prettyErrors: false });
  if (doc.errors.length > 0) {
    throw createWriteForError(
      "CONFIG_INVALID",
      `${path}: ${doc.errors[0]?.message ?? "invalid YAML"}`,
    );
  }
  const data = doc.toJSON() as unknown;
  if (data == null) return {};
  if (typeof data !== "object" || Array.isArray(data)) {
    throw createWriteForError("CONFIG_INVALID", `${path}: frontmatter must be a mapping`);
  }
  const record = data as Record<string, unknown>;
  const metadata: LayerMetadata = {};
  for (const key of Object.keys(record)) {
    if (!recognizedFields.has(key)) continue;
    const value = record[key];
    if (value === null || value === "") {
      throw createWriteForError("CONFIG_INVALID", `${path}: ${key} must not be empty`);
    }
    if (typeof value !== "string") {
      throw createWriteForError("CONFIG_INVALID", `${path}: ${key} must be a string`);
    }
    if (key === "model") {
      splitModelReference(value, path);
      metadata.model = value;
    }
    if (key === "defaultRegister") {
      if (kind !== "channel")
        throw createWriteForError(
          "CONFIG_INVALID",
          `${path}: defaultRegister is only valid for channels`,
        );
      assertIdentifier(value, "defaultRegister");
      metadata.defaultRegister = value;
    }
  }
  return metadata;
}

function readLayer(
  root: "global" | "project",
  rootPath: string,
  kind: Layer["kind"],
  name: string,
): Layer {
  const path = fileFor(rootPath, kind, name);
  ensureContained(rootPath, path);
  if (!existsSync(path)) return { root, kind, name, path, exists: false, metadata: {} };
  if (!lstatSync(path).isFile())
    throw createWriteForError("CONFIG_INVALID", `${path} is not a file`);
  const { yaml, body } = splitFrontmatter(readFileSync(path, "utf8"));
  return {
    root,
    kind,
    name,
    path,
    exists: true,
    body,
    metadata: yaml === undefined ? {} : metadataFromYaml(yaml, path, kind),
  };
}

function selectedBody(globalLayer: Layer | undefined, projectLayer: Layer | undefined): string {
  const projectBody = projectLayer?.body?.trim();
  if (projectBody) return projectBody;
  const globalBody = globalLayer?.body?.trim();
  return globalBody ?? "";
}

function modelFromLayers(layers: Layer[], activeModel?: string): ModelReference | undefined {
  let selected: { value: string; source: string } | undefined = activeModel
    ? { value: activeModel, source: "active" }
    : undefined;
  for (const root of ["global", "project"] as const) {
    for (const kind of ["style", "register", "channel"] as const) {
      const layer = layers.find((candidate) => candidate.root === root && candidate.kind === kind);
      if (layer?.metadata.model) selected = { value: layer.metadata.model, source: layer.path };
    }
  }
  return selected ? splitModelReference(selected.value, selected.source) : undefined;
}

function rootsEqual(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && resolve(a) === resolve(b);
}

export function loadConfigLayers(input: ResolveWritingProfileInput): LoadedLayers {
  assertIdentifier(input.channel, "channel");
  if (input.register) assertIdentifier(input.register, "register");
  const global = globalRoot(input);
  const project = selectedProjectRoot(input);
  const roots = { global: existsSync(global) ? global : undefined, project, selected: project };
  const rootsToRead: Array<["global" | "project", string]> = [];
  if (roots.global) rootsToRead.push(["global", roots.global]);
  if (project && !rootsEqual(project, roots.global)) rootsToRead.push(["project", project]);
  const builtIn = builtInChannel(input.channel);
  let channelDefaultRegister = builtIn?.defaultRegister;
  const channelProbeLayers = rootsToRead.map(([scope, root]) =>
    readLayer(scope, root, "channel", input.channel),
  );
  for (const layer of channelProbeLayers)
    channelDefaultRegister = layer.metadata.defaultRegister ?? channelDefaultRegister;
  const register = input.register ?? channelDefaultRegister;
  const layers: Layer[] = [];
  for (const [scope, root] of rootsToRead) {
    layers.push(readLayer(scope, root, "style", "style"));
    if (register) layers.push(readLayer(scope, root, "register", register));
    layers.push(
      channelProbeLayers.find((layer) => layer.root === scope) ??
        readLayer(scope, root, "channel", input.channel),
    );
  }
  return {
    roots,
    layers,
    channelDefaultRegister,
    builtInChannelBody: builtIn?.body ?? GENERIC_CHANNEL_BODY,
  };
}

export function resolveWritingProfile(input: ResolveWritingProfileInput): ResolvedWritingProfile {
  const loaded = loadConfigLayers(input);
  const register = input.register ?? loaded.channelDefaultRegister;
  if (!register)
    throw createWriteForError(
      "REGISTER_REQUIRED",
      `register is required for channel ${input.channel}`,
    );
  const globalStyle = loaded.layers.find(
    (layer) => layer.root === "global" && layer.kind === "style",
  );
  const projectStyle = loaded.layers.find(
    (layer) => layer.root === "project" && layer.kind === "style",
  );
  const globalRegister = loaded.layers.find(
    (layer) => layer.root === "global" && layer.kind === "register",
  );
  const projectRegister = loaded.layers.find(
    (layer) => layer.root === "project" && layer.kind === "register",
  );
  const globalChannel = loaded.layers.find(
    (layer) => layer.root === "global" && layer.kind === "channel",
  );
  const projectChannel = loaded.layers.find(
    (layer) => layer.root === "project" && layer.kind === "channel",
  );
  const style = selectedBody(globalStyle, projectStyle);
  const registerBody = selectedBody(globalRegister, projectRegister);
  if (!registerBody)
    throw createWriteForError(
      "PROFILE_NOT_CONFIGURED",
      `register ${register} has no trained voice`,
    );
  const savedChannelBody = selectedBody(globalChannel, projectChannel);
  const channelBody = savedChannelBody || loaded.builtInChannelBody;
  const prose = [style, registerBody, channelBody].filter(Boolean).join("\n\n");
  return {
    roots: loaded.roots,
    channel: input.channel,
    register,
    prose,
    style: style || undefined,
    registerBody,
    channelBody,
    model: modelFromLayers(loaded.layers, input.activeModel),
  };
}

export function isWriteForConfigError(value: unknown): value is WriteForError {
  return (
    !!value && typeof value === "object" && (value as { name?: unknown }).name === "WriteForError"
  );
}

export function defaultConfigRoot(home = homedir()): string {
  return join(home, ".config", "pi-write-for");
}

export function projectConfigRoot(cwd: string, piConfigDirName: string): string {
  return join(cwd, piConfigDirName, "write-for");
}

export function pathDepth(path: string): number {
  return parse(resolve(path)).dir.split(sep).length;
}
