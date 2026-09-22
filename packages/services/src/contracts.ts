export interface EventBus {
  emit(channel: string, payload: unknown): void;
  on(channel: string, handler: (payload: unknown) => void): () => void;
}

export interface ServiceHost {
  events: EventBus;
  on(event: "session_shutdown", handler: () => void | Promise<void>): void;
}

export interface ServiceContract<TApi extends object> {
  id: string;
  apiMajor: number;
  isApi(value: unknown): value is TApi;
}

export interface ServiceDescriptor<TApi extends object> {
  id: string;
  apiMajor: number;
  api: TApi;
}

export interface ServiceRegistration {
  dispose(): Promise<void>;
}

export interface DiscoveryRequest {
  offer(descriptor: unknown): void;
}

export const DISCOVERY_PROTOCOL = "plugin-services:v1";

export function discoveryChannel(serviceId: string): string {
  return `${DISCOVERY_PROTOCOL}:discover:${serviceId}`;
}
