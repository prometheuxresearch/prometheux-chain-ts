/** Browser stand-in for `platform.ts`: there is no local file system to use. */
import { PrometheuxError } from "./errors.ts";

export function readLocalFile(_path: string): Promise<Blob> {
  return Promise.reject(
    new PrometheuxError(
      "fileFromPath() reads from disk, which only works in Node.js. In a browser, pass a File " +
        '(for example from <input type="file">) or a Blob to the upload method instead.',
    ),
  );
}

export function writeLocalFile(
  _body: ReadableStream<Uint8Array> | null,
  _path: string,
): Promise<void> {
  return Promise.reject(
    new PrometheuxError(
      "saveTo() writes to disk, which only works in Node.js. In a browser, read the download " +
        "with .blob(), .text() or .arrayBuffer() instead.",
    ),
  );
}
