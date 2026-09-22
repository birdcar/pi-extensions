import type { WriteForError, WriteForErrorCode } from "./contract.js";
import { isWriteForError } from "./contract.js";

export function createWriteForError(code: WriteForErrorCode, message: string): WriteForError {
  const error = new Error(message) as WriteForError;
  error.name = "WriteForError";
  error.code = code;
  return error;
}

export { isWriteForError };
export type { WriteForError, WriteForErrorCode };
