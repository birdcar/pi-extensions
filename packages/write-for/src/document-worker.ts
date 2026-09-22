import { parentPort, workerData } from "node:worker_threads";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

interface WorkerData {
  kind: "pdf" | "docx";
  bytes: Uint8Array;
  path?: string;
  maxCharacters: number;
}

function normalizeText(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function enforceUsable(text: string, maxCharacters: number, label: string): string {
  const normalized = normalizeText(text);
  if (!normalized) throw new Error(`${label} has no extractable text`);
  if (normalized.length > maxCharacters) {
    throw new Error(
      `${label} exceeds extracted character limit (${normalized.length} > ${maxCharacters})`,
    );
  }
  return normalized;
}

async function extractPdf(
  data: WorkerData,
): Promise<{ text: string; warnings: string[]; pages?: number }> {
  const bytes = new Uint8Array(data.bytes);
  if (
    Buffer.from(bytes.subarray(0, Math.min(bytes.byteLength, 4096))).includes(
      Buffer.from("/Encrypt"),
    )
  ) {
    throw new Error("PDF appears to be encrypted or password protected");
  }
  const pdf = await getDocumentProxy(bytes, {
    disableAutoFetch: true,
    disableFontFace: true,
    disableRange: true,
    isEvalSupported: false,
    useWorkerFetch: false,
  } as unknown as NonNullable<Parameters<typeof getDocumentProxy>[1]>);
  try {
    const result = await extractText(pdf, { mergePages: false });
    const pages = Array.isArray(result.text) ? result.text : [result.text];
    const rawText = pages.join("\n");
    enforceUsable(rawText, data.maxCharacters, "PDF");
    const text = pages.map((page, index) => `Page ${index + 1}\n${page}`).join("\n\n");
    return {
      text: enforceUsable(text, data.maxCharacters, "PDF"),
      warnings: [],
      pages: result.totalPages,
    };
  } finally {
    const destroy = (pdf as unknown as { destroy?: () => Promise<void> | void }).destroy;
    if (destroy) await destroy.call(pdf);
  }
}

async function extractDocx(data: WorkerData): Promise<{ text: string; warnings: string[] }> {
  const result = await mammoth.extractRawText({ buffer: Buffer.from(data.bytes) });
  const warnings = result.messages.map((message) => message.message).filter(Boolean);
  return { text: enforceUsable(result.value, data.maxCharacters, "DOCX"), warnings };
}

async function main(): Promise<void> {
  const data = workerData as WorkerData;
  const result = data.kind === "pdf" ? await extractPdf(data) : await extractDocx(data);
  parentPort?.postMessage({ ok: true, ...result });
}

main().catch((error: unknown) => {
  parentPort?.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
});
