import { basename } from "node:path";

/** Anything the SDK can upload. Use `fileFromPath()` for a file on disk. */
export type Uploadable = Blob | Uint8Array | ArrayBuffer;

/** Opens a local file as a lazily-read `File`, ready to pass to any upload method. */
export async function fileFromPath(path: string, filename?: string): Promise<File> {
  const { openAsBlob } = await import("node:fs");
  const blob = await openAsBlob(path);
  return new File([blob], filename ?? basename(path), { type: blob.type });
}

/** Normalises an upload into a `Blob` and picks the filename sent to the server. */
export function toBlob(file: Uploadable, filename?: string): { blob: Blob; filename: string } {
  const name = filename ?? (file instanceof File ? file.name : undefined) ?? "upload";
  if (file instanceof Blob) return { blob: file, filename: name };
  const bytes = file instanceof Uint8Array ? file : new Uint8Array(file);
  // Copy into a fresh ArrayBuffer-backed view so SharedArrayBuffer-backed inputs are accepted.
  return { blob: new Blob([new Uint8Array(bytes)]), filename: name };
}

/**
 * Reduces a server-supplied filename to a bare basename so a malicious or buggy
 * response can never cause a write outside the intended directory.
 */
export function safeFilename(name: string | undefined): string {
  const candidate = (name ?? "").replaceAll("\\", "/").split("/").pop() ?? "";
  return !candidate || candidate === "." || candidate === ".." ? "download" : candidate;
}

/** A downloaded file. The body can be consumed once, by any one of the methods below. */
export class FileDownload {
  /** Sanitised filename suggested by the server (or derived from the request). */
  readonly filename: string;
  readonly contentType: string | null;
  readonly response: Response;

  constructor(response: Response, filename: string) {
    this.response = response;
    this.filename = filename;
    this.contentType = response.headers.get("content-type");
  }

  /** The raw byte stream. */
  get body(): ReadableStream<Uint8Array> | null {
    return this.response.body;
  }

  blob(): Promise<Blob> {
    return this.response.blob();
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    return this.response.arrayBuffer();
  }

  text(): Promise<string> {
    return this.response.text();
  }

  /**
   * Streams the file to disk and returns the path written. `destPath` is used
   * verbatim; it defaults to `filename` in the current directory.
   */
  async saveTo(destPath: string = this.filename): Promise<string> {
    const [{ createWriteStream }, { Readable }, { pipeline }] = await Promise.all([
      import("node:fs"),
      import("node:stream"),
      import("node:stream/promises"),
    ]);
    const body = this.response.body;
    const source = body
      ? Readable.fromWeb(body as import("node:stream/web").ReadableStream)
      : Readable.from([]);
    await pipeline(source, createWriteStream(destPath));
    return destPath;
  }
}
