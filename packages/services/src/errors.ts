export const SERVICE_ERROR_CODES = [
  "SERVICE_CONTRACT",
  "SERVICE_INCOMPATIBLE",
  "SERVICE_AMBIGUOUS",
  "SERVICE_DISPOSED",
] as const;

export type ServiceErrorCode = (typeof SERVICE_ERROR_CODES)[number];

export interface ServiceError extends Error {
  name: "ServiceError";
  code: ServiceErrorCode;
  serviceId?: string;
  requestedMajor?: number;
}

export function createServiceError(
  code: ServiceErrorCode,
  message: string,
  context: { serviceId?: string; requestedMajor?: number } = {},
): ServiceError {
  const error = new Error(message) as ServiceError;
  error.name = "ServiceError";
  error.code = code;
  if (context.serviceId !== undefined) error.serviceId = context.serviceId;
  if (context.requestedMajor !== undefined) error.requestedMajor = context.requestedMajor;
  return error;
}

export function isServiceError(value: unknown): value is ServiceError {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.name === "ServiceError" &&
    typeof record.message === "string" &&
    SERVICE_ERROR_CODES.includes(record.code as ServiceErrorCode)
  );
}
