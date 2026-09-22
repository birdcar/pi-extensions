export interface ServiceContract<TApi extends object> {
  id: string;
  apiMajor: number;
  isApi(value: unknown): value is TApi;
}

export interface WritingOptions {
  channel: string;
  register?: string;
  rules?: string[];
  context?: string;
  signal?: AbortSignal;
}

export interface DraftRequest extends WritingOptions {
  subject: string;
}

export interface RewriteRequest extends WritingOptions {
  text: string;
  instruction?: string;
}

export interface WritingResult {
  text: string;
  channel: string;
  register: string;
  model: { provider: string; id: string };
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costUsd?: number;
  };
}

export interface WriteForApi {
  draft(request: DraftRequest): Promise<WritingResult>;
  rewrite(request: RewriteRequest): Promise<WritingResult>;
}

export const WRITE_FOR_SERVICE_ID = "birdcar.write-for";
export const WRITE_FOR_API_MAJOR = 1;
export const WRITE_FOR_REWRITE_EVENT = "birdcar.write-for:v1:rewrite";

export interface RewriteEventRequest {
  request: RewriteRequest;
  accept(completion: Promise<WritingResult>): void;
}

const forbiddenExecutionFields = new Set(["model", "provider", "baseUrl"]);
const identifierPattern = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;
const baseKeys = new Set(["channel", "register", "rules", "context", "signal"]);
const draftKeys = new Set([...baseKeys, "subject"]);
const rewriteKeys = new Set([...baseKeys, "text", "instruction"]);

function hasOwnCallableDataProperty(value: object, name: "draft" | "rewrite"): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  return !!descriptor && "value" in descriptor && typeof descriptor.value === "function";
}

export const writeForContract: ServiceContract<WriteForApi> = {
  id: WRITE_FOR_SERVICE_ID,
  apiMajor: WRITE_FOR_API_MAJOR,
  isApi(value: unknown): value is WriteForApi {
    return (
      !!value &&
      typeof value === "object" &&
      hasOwnCallableDataProperty(value, "draft") &&
      hasOwnCallableDataProperty(value, "rewrite")
    );
  },
};

export const WRITE_FOR_ERROR_CODES = [
  "INVALID_REQUEST",
  "CONFIG_INVALID",
  "PROFILE_NOT_CONFIGURED",
  "REGISTER_REQUIRED",
  "MODEL_UNAVAILABLE",
  "MODEL_AUTH",
  "GENERATION_FAILED",
  "NOT_READY",
  "NO_UI",
  "TRAINING_NOT_ACTIVE",
  "SOURCE_INVALID",
  "SOURCE_LIMIT",
  "PROPOSAL_STALE",
] as const;

export type WriteForErrorCode = (typeof WRITE_FOR_ERROR_CODES)[number];

export interface WriteForError extends Error {
  name: "WriteForError";
  code: WriteForErrorCode;
}

export function isWriteForError(value: unknown): value is WriteForError {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { name?: unknown; message?: unknown; code?: unknown };
  return (
    candidate.name === "WriteForError" &&
    typeof candidate.message === "string" &&
    typeof candidate.code === "string" &&
    WRITE_FOR_ERROR_CODES.includes(candidate.code as WriteForErrorCode)
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validateBaseRequest(
  value: Record<string, unknown>,
  allowedKeys: Set<string>,
): string | undefined {
  for (const field of forbiddenExecutionFields) {
    if (field in value) return `request must not include execution field ${field}`;
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) return `unknown request field ${key}`;
  }
  if (typeof value.channel !== "string" || value.channel.length === 0) return "channel is required";
  if (!identifierPattern.test(value.channel)) return "channel must be a safe identifier";
  if ("register" in value && typeof value.register !== "string") return "register must be a string";
  if (typeof value.register === "string" && !identifierPattern.test(value.register)) {
    return "register must be a safe identifier";
  }
  if ("context" in value && typeof value.context !== "string") return "context must be a string";
  if ("signal" in value) {
    const signal = value.signal as {
      aborted?: unknown;
      addEventListener?: unknown;
      removeEventListener?: unknown;
    };
    if (
      !signal ||
      typeof signal !== "object" ||
      typeof signal.aborted !== "boolean" ||
      typeof signal.addEventListener !== "function" ||
      typeof signal.removeEventListener !== "function"
    ) {
      return "signal must be an AbortSignal";
    }
  }
  if (
    "rules" in value &&
    (!Array.isArray(value.rules) || !value.rules.every((rule) => typeof rule === "string"))
  ) {
    return "rules must be strings";
  }
  return undefined;
}

export function validateDraftRequest(value: unknown): value is DraftRequest {
  if (!isPlainRecord(value)) return false;
  if (validateBaseRequest(value, draftKeys)) return false;
  return typeof value.subject === "string" && value.subject.length > 0;
}

export function validateRewriteRequest(value: unknown): value is RewriteRequest {
  if (!isPlainRecord(value)) return false;
  if (validateBaseRequest(value, rewriteKeys)) return false;
  return (
    typeof value.text === "string" &&
    value.text.length > 0 &&
    (!("instruction" in value) || typeof value.instruction === "string")
  );
}

export function explainInvalidWritingRequest(
  value: unknown,
  kind: "draft" | "rewrite",
): string | undefined {
  if (!isPlainRecord(value)) return "request must be an object";
  const base = validateBaseRequest(value, kind === "draft" ? draftKeys : rewriteKeys);
  if (base) return base;
  if (kind === "draft" && (typeof value.subject !== "string" || value.subject.length === 0)) {
    return "subject is required";
  }
  if (kind === "rewrite" && (typeof value.text !== "string" || value.text.length === 0)) {
    return "text is required";
  }
  if (kind === "rewrite" && "instruction" in value && typeof value.instruction !== "string") {
    return "instruction must be a string";
  }
  return undefined;
}
