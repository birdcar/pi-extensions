import { CONFIG_DIR_NAME, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerWriteForCommands } from "./commands.js";
import { registerWriteForEvents } from "./events.js";
import { registerWriteForService } from "./service.js";
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
  dispose(): void;
}

export default function writeForExtension(pi: ExtensionAPI): WriteForExtensionState {
  const service = registerWriteForService(pi);
  registerWriteForCommands(pi);
  const unsubscribeEvents = registerWriteForEvents(pi);
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unsubscribeEvents();
    void service.dispose();
  };
  pi.on("session_shutdown", dispose);
  return { configDirectoryName: CONFIG_DIR_NAME, dispose };
}
