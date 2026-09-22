export type {
  DiscoveryRequest,
  EventBus,
  ServiceContract,
  ServiceDescriptor,
  ServiceHost,
  ServiceRegistration,
} from "./contracts.js";
export { DISCOVERY_PROTOCOL, discoveryChannel } from "./contracts.js";
export type { ServiceError, ServiceErrorCode } from "./errors.js";
export { SERVICE_ERROR_CODES, createServiceError, isServiceError } from "./errors.js";
export {
  assertApiMajor,
  assertContract,
  assertDescriptorShape,
  assertServiceId,
  discoverService,
  validateServiceApi,
} from "./discovery.js";
export { provideService } from "./provider.js";
