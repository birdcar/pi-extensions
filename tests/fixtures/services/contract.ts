import { type ServiceContract } from "../../../packages/services/src/index.ts";

export interface EchoRequest {
  text: string;
  signal?: AbortSignal;
}

export interface EchoResult {
  text: string;
  consumer: string;
}

export interface EchoApi {
  echo(request: EchoRequest): Promise<EchoResult>;
}

export const echoContract: ServiceContract<EchoApi> = {
  id: "birdcar.test.echo",
  apiMajor: 1,
  isApi(value): value is EchoApi {
    return !!value && typeof value === "object" && typeof (value as EchoApi).echo === "function";
  },
};

export function assertEchoRequest(value: EchoRequest): void {
  if (!value || typeof value.text !== "string" || value.text.length === 0) {
    throw new TypeError("text is required");
  }
}
