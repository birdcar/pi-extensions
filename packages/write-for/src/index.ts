import { CONFIG_DIR_NAME, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerWriteForCommands } from "./commands.js";
import { registerWriteForEvents } from "./events.js";
import { registerWriteForService } from "./service.js";
import { createTrainingManager, type TrainingManager } from "./training.js";
import { registerTrainingTools } from "./training-tools.js";
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
  training: TrainingManager;
}

export default function writeForExtension(pi: ExtensionAPI): WriteForExtensionState {
  const service = registerWriteForService(pi);
  const training = createTrainingManager(pi);
  registerTrainingTools(pi, training);
  registerWriteForCommands(pi, { training });
  const unsubscribeEvents = registerWriteForEvents(pi);
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unsubscribeEvents();
    void training.dispose();
    void service.dispose();
  };
  pi.on("session_shutdown", dispose);
  return { configDirectoryName: CONFIG_DIR_NAME, dispose, training };
}
