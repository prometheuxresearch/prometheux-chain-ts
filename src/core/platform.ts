/**
 * File-system access, the only part of the SDK that needs Node.js. The browser
 * build replaces this module with `platform.browser.ts` (see tsdown.config.ts),
 * so bundlers never meet a `node:` import.
 */
import { createWriteStream, openAsBlob } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

/** Opens a local file as a lazily-read `Blob`. */
export function readLocalFile(path: string): Promise<Blob> {
  return openAsBlob(path);
}

/** Streams a response body to a local file. */
export async function writeLocalFile(
  body: ReadableStream<Uint8Array> | null,
  path: string,
): Promise<void> {
  const source = body ? Readable.fromWeb(body as NodeReadableStream) : Readable.from([]);
  await pipeline(source, createWriteStream(path));
}
