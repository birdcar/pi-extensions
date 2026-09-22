import { CONFIG_DIR_NAME, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
export type {
  DraftRequest,
  RewriteEventRequest,
  RewriteRequest,
  WriteForApi,
  WritingOptions,
  WritingResult,
} from "./contract.js";
export {
  WRITE_FOR_API_MAJOR,
  WRITE_FOR_REWRITE_EVENT,
  WRITE_FOR_SERVICE_ID,
  writeForContract,
} from "./contract.js";

export interface WriteForExtensionState {
  configDirectoryName: string;
}

export default function writeForExtension(_pi: ExtensionAPI): WriteForExtensionState {
  return { configDirectoryName: CONFIG_DIR_NAME };
}
