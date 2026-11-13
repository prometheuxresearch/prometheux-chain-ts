import { VERSION } from "../version.ts";
import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  OperationFailedError,
  PrometheuxError,
} from "./errors.ts";
import { FileDownload, safeFilename } from "./files.ts";
import type { Envelope, RequestOptions } from "./types.ts";

export interface ClientOptions {
  /** API token. Defaults to the `PMTX_TOKEN` environment variable. */
  token?: string;
  /**
   * Your Prometheux backend, e.g.
   * `https://api.prometheux.ai/jarvispy/<organization>/<username>`.
   * Defaults to the `JARVISPY_URL` environment variable.
   */
  baseUrl?: string;
  /**
   * Optional Supabase token, sent as `X-Supabase-Token`. Needed by
   * recipient-side sharing flows. Defaults to `SUPABASE_TOKEN`.
   */
  supabaseToken?: string;
  /** Request timeout in milliseconds. For streams it is the idle timeout. Default 300000. */
  timeout?: number;
  /** WebSocket idle timeout in milliseconds (the server pings every ~20s). Default 60000. */
  wsTimeout?: number;
  /** Retries for idempotent (GET) requests on connection errors, 429 and 502–504. Default 2. */
  maxRetries?: number;
  /** Custom `fetch` implementation (tests, proxies, instrumentation). */
  fetch?: typeof fetch;
  /** Headers sent with every request. */
  defaultHeaders?: Record<string, string>;
}

export type QueryValue = string | number | boolean | null | undefined;
export type Query = Record<string, QueryValue>;

export interface RequestSpec {
  query?: Query;
  /** JSON request body. */
  body?: unknown;
  /** Multipart request body (takes precedence over `body`). */
  form?: FormData;
}

const DEFAULT_TIMEOUT = 300_000;
const DEFAULT_WS_TIMEOUT = 60_000;
const WS_CONNECT_TIMEOUT = 10_000;
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

function env(name: string): string | undefined {
  const value = globalThis.process?.env?.[name];
  return value ? value : undefined;
}

function positive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Owns auth, timeouts, retries and the wire formats (JSON, NDJSON, files, WebSocket). */
export class HttpClient {
  readonly baseUrl: string;
  readonly timeout: number;
  readonly wsTimeout: number;
  readonly maxRetries: number;
  readonly #token: string;
  readonly #supabaseToken: string | undefined;
  readonly #fetch: typeof fetch;
  readonly #defaultHeaders: Record<string, string>;

  constructor(options: ClientOptions = {}) {
    const token = options.token ?? env("PMTX_TOKEN");
    if (!token) {
      throw new PrometheuxError(
        "No API token: pass `token` to the client or set the PMTX_TOKEN environment variable.",
      );
    }
    const baseUrl = options.baseUrl ?? env("JARVISPY_URL");
    if (!baseUrl) {
      throw new PrometheuxError(
        "No backend URL: pass `baseUrl` to the client or set the JARVISPY_URL environment variable " +
          "(e.g. https://api.prometheux.ai/jarvispy/<organization>/<username>).",
      );
    }
    if (/[<>{}]/.test(baseUrl)) {
      throw new PrometheuxError(
        `The backend URL still contains a placeholder: ${baseUrl}. ` +
          "Replace <organization> and <username> (or {organization} and {username}) with yours.",
      );
    }
    this.#token = token;
    this.#supabaseToken = options.supabaseToken ?? env("SUPABASE_TOKEN");
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.timeout = positive(options.timeout, DEFAULT_TIMEOUT);
    this.wsTimeout = positive(options.wsTimeout, DEFAULT_WS_TIMEOUT);
    this.maxRetries = Math.max(0, options.maxRetries ?? 2);
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#defaultHeaders = options.defaultHeaders ?? {};
  }

  /** Sends a request and returns the parsed JSON body. */
  async request<T = Envelope>(
    method: string,
    path: string,
    spec: RequestSpec = {},
    options: RequestOptions = {},
  ): Promise<T> {
    const retries = method === "GET" ? this.maxRetries : 0;
    for (let attempt = 0; ; attempt++) {
      try {
        const { response, deadline } = await this.#send(method, path, spec, options);
        try {
          return (await this.#parseJson(response)) as T;
        } catch (error) {
          throw deadline.translate(error);
        } finally {
          deadline.stop();
        }
      } catch (error) {
        if (attempt >= retries || !isRetryable(error)) throw error;
        await sleep(retryDelay(attempt, error), options.signal);
      }
    }
  }

  /** Sends a request and returns `data` from the envelope, throwing if it is not a success. */
  async call<T>(
    operation: string,
    method: string,
    path: string,
    spec?: RequestSpec,
    options?: RequestOptions,
  ): Promise<T> {
    return unwrap<T>(operation, await this.request<Envelope<T>>(method, path, spec, options));
  }

  /**
   * Streams an NDJSON endpoint. Each line is yielded as parsed JSON; a line that
   * is not JSON becomes `{ type: "raw", data: line }`. A stream that stalls or
   * drops ends with a terminal `{ type: "error" }` event rather than throwing.
   */
  async *stream<T>(
    method: string,
    path: string,
    spec: RequestSpec = {},
    options: RequestOptions = {},
  ): AsyncGenerator<T, void, undefined> {
    const { response, deadline } = await this.#send(method, path, spec, options);
    if (!response.ok) {
      deadline.stop();
      throw await this.#apiError(response);
    }
    try {
      for await (const line of readLines(response, deadline)) {
        if (!line.trim()) continue;
        try {
          yield JSON.parse(line) as T;
        } catch {
          yield { type: "raw", data: line } as T;
        }
      }
    } catch (error) {
      if (options.signal?.aborted && !deadline.timedOut) throw error;
      yield {
        type: "error",
        data: { status: "error", message: deadline.translate(error).message },
      } as T;
    } finally {
      deadline.stop();
    }
  }

  /** Requests a binary response and returns a handle to read or save it. */
  async download(
    path: string,
    spec: RequestSpec = {},
    options: RequestOptions = {},
  ): Promise<FileDownload> {
    const { response, deadline } = await this.#send("GET", path, spec, options);
    // The timeout only guards time-to-headers (a large body may take longer);
    // the caller's signal still cancels the body.
    deadline.stop();
    if (!response.ok) throw await this.#apiError(response);
    const disposition = response.headers.get("content-disposition") ?? "";
    const fromHeader = parseDispositionFilename(disposition);
    const requested = typeof spec.query?.path === "string" ? spec.query.path : undefined;
    return new FileDownload(response, safeFilename(fromHeader ?? requested));
  }

  /**
   * Opens a WebSocket, sends `init` once, and yields every message except
   * heartbeats. Ends after a terminal `complete` or `error` event; a dead or
   * closed connection yields a synthetic `error` event.
   */
  async *websocket<T extends { event?: string }>(
    path: string,
    init: unknown,
    options: RequestOptions = {},
  ): AsyncGenerator<T, void, undefined> {
    const url = new URL(this.#url(path, {}));
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("token", this.#token);
    if (this.#supabaseToken) url.searchParams.set("x_supabase_token", this.#supabaseToken);

    // Fail before connecting: sending `init` is what starts the run server-side.
    options.signal?.throwIfAborted();
    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    const inbox = new SocketInbox(socket);
    const onAbort = () => socket.close();
    options.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      try {
        await inbox.opened(WS_CONNECT_TIMEOUT, this.baseUrl);
      } catch (error) {
        options.signal?.throwIfAborted();
        throw error;
      }
      options.signal?.throwIfAborted();
      socket.send(JSON.stringify(init ?? {}));
      const idle = positive(options.timeout, this.wsTimeout);
      while (true) {
        const next = await inbox.next(idle);
        if (options.signal?.aborted) throw options.signal.reason;
        if (next.kind === "timeout") {
          yield wsError<T>(
            `WebSocket timed out after ${idle / 1000}s with no message from the server ` +
              "(a heartbeat is expected every ~20s); the connection appears dead.",
          );
          return;
        }
        if (next.kind === "closed") {
          yield wsError<T>(`WebSocket closed before the run finished (${next.detail}).`);
          return;
        }
        let message: T;
        try {
          message = JSON.parse(next.data) as T;
        } catch {
          continue;
        }
        if (message.event === "ping") continue;
        yield message;
        if (message.event === "complete" || message.event === "error") return;
      }
    } finally {
      options.signal?.removeEventListener("abort", onAbort);
      if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    }
  }

  #url(path: string, query: Query = {}): string {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  #headers(spec: RequestSpec, options: RequestOptions): Headers {
    const headers = new Headers({
      Accept: "application/json",
      "User-Agent": `prometheux-chain-ts/${VERSION} node/${globalThis.process?.version ?? "unknown"}`,
      ...this.#defaultHeaders,
      Authorization: `Bearer ${this.#token}`,
    });
    if (spec.body !== undefined && !spec.form) headers.set("Content-Type", "application/json");
    if (this.#supabaseToken) headers.set("X-Supabase-Token", this.#supabaseToken);
    for (const [key, value] of Object.entries(options.headers ?? {})) headers.set(key, value);
    return headers;
  }

  async #send(
    method: string,
    path: string,
    spec: RequestSpec,
    options: RequestOptions,
  ): Promise<{ response: Response; deadline: Deadline }> {
    const deadline = new Deadline(positive(options.timeout, this.timeout), options.signal);
    const init: RequestInit = {
      method,
      headers: this.#headers(spec, options),
      signal: deadline.signal,
    };
    if (spec.form) init.body = spec.form;
    else if (spec.body !== undefined) init.body = JSON.stringify(spec.body);
    try {
      return { response: await this.#fetch(this.#url(path, spec.query), init), deadline };
    } catch (error) {
      deadline.stop();
      if (options.signal?.aborted && !deadline.timedOut) throw error;
      if (deadline.timedOut) throw deadline.translate(error);
      throw new APIConnectionError(
        `Could not connect to the Prometheux backend at ${this.baseUrl}. ` +
          "Check that it is reachable and that baseUrl / JARVISPY_URL is correct.",
        { cause: error },
      );
    }
  }

  async #parseJson(response: Response): Promise<unknown> {
    if (!response.ok) throw await this.#apiError(response);
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new APIError(
        response.status,
        text,
        response.headers,
        `Invalid JSON response from server: ${text.slice(0, 500)}`,
      );
    }
  }

  async #apiError(response: Response): Promise<APIError> {
    const text = await response.text().catch(() => "");
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // keep the raw text
    }
    return APIError.from(response.status, body, response.headers);
  }
}

/** Returns `data` from a success envelope, otherwise throws `OperationFailedError`. */
export function unwrap<T>(operation: string, envelope: Envelope<T>): T {
  if (envelope?.status !== "success") throw new OperationFailedError(operation, envelope);
  return envelope.data as T;
}

/** Like `unwrap`, but for endpoints whose useful payload is the envelope `message`. */
export function unwrapMessage(operation: string, envelope: Envelope): string | undefined {
  if (envelope?.status !== "success") throw new OperationFailedError(operation, envelope);
  return envelope.message;
}

/**
 * A resettable timeout combined with the caller's signal. `AbortSignal.any`
 * keeps the caller's signal linked for the whole life of the request (including
 * a download body read after `stop()`), without listeners to clean up.
 */
class Deadline {
  readonly signal: AbortSignal;
  timedOut = false;
  readonly #controller = new AbortController();
  readonly #ms: number;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(ms: number, outer?: AbortSignal) {
    this.#ms = ms;
    this.signal = outer
      ? AbortSignal.any([outer, this.#controller.signal])
      : this.#controller.signal;
    this.reset();
  }

  /** Restarts the countdown (before each stream read). */
  reset(): void {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.timedOut = true;
      this.#controller.abort(new APITimeoutError(this.#message()));
    }, this.#ms);
  }

  /** Stops the countdown. The caller's signal can still abort the request. */
  stop(): void {
    clearTimeout(this.#timer);
  }

  /** Maps an abort caused by this deadline to `APITimeoutError`. */
  translate(error: unknown): Error {
    if (this.timedOut) return new APITimeoutError(this.#message(), { cause: error });
    return error instanceof Error ? error : new PrometheuxError(String(error));
  }

  #message(): string {
    return `Request timed out after ${this.#ms / 1000}s. The backend may be slow or unresponsive.`;
  }
}

/**
 * Yields the lines of a streamed body. The idle timeout only runs while waiting
 * on the network, never while the consumer handles a line, and the body is
 * cancelled when the consumer stops early.
 */
async function* readLines(response: Response, deadline: Deadline): AsyncGenerator<string> {
  if (!response.body) return;
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  // Not every fetch implementation ties the body to the request signal, so
  // cancel the read ourselves when the deadline or the caller aborts.
  const signal = deadline.signal;
  const onAbort = () => void reader.cancel(signal.reason).catch(() => {});
  signal.addEventListener("abort", onAbort, { once: true });
  let buffer = "";
  let finished = false;
  try {
    while (true) {
      deadline.reset();
      const { value, done } = await reader.read();
      deadline.stop();
      if (signal.aborted) throw signal.reason;
      if (done) break;
      buffer += value;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      yield* lines;
    }
    finished = true;
    if (buffer) yield buffer;
  } finally {
    signal.removeEventListener("abort", onAbort);
    // A consumer that breaks out early must not leave the response open.
    if (!finished) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

type InboxItem =
  | { kind: "message"; data: string }
  | { kind: "closed"; detail: string }
  | { kind: "timeout" };

/** Turns WebSocket callbacks into an awaitable queue. */
class SocketInbox {
  readonly #queue: InboxItem[] = [];
  #waiter: ((item: InboxItem) => void) | undefined;
  #closed: InboxItem | undefined;
  readonly #socket: WebSocket;

  constructor(socket: WebSocket) {
    this.#socket = socket;
    const decoder = new TextDecoder();
    socket.addEventListener("message", (event) => {
      const data = typeof event.data === "string" ? event.data : decoder.decode(event.data);
      this.#push({ kind: "message", data });
    });
    socket.addEventListener("close", (event) => {
      this.#closed = {
        kind: "closed",
        detail: `code ${event.code}${event.reason ? `: ${event.reason}` : ""}`,
      };
      this.#push(this.#closed);
    });
  }

  opened(ms: number, baseUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (reason: string) => {
        // Settle once: on Node 22, close() on a failing socket re-dispatches
        // error/close synchronously, which would otherwise recurse.
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.#socket.readyState === WebSocket.CONNECTING) this.#socket.close();
        reject(new APIConnectionError(`WebSocket to ${baseUrl} failed: ${reason}`));
      };
      const timer = setTimeout(() => fail(`no handshake after ${ms / 1000}s`), ms);
      this.#socket.addEventListener("open", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      });
      this.#socket.addEventListener("error", () => fail("connection error"));
      this.#socket.addEventListener("close", (event) => fail(`closed with code ${event.code}`));
    });
  }

  next(ms: number): Promise<InboxItem> {
    const queued = this.#queue.shift();
    if (queued) return Promise.resolve(queued);
    if (this.#closed) return Promise.resolve(this.#closed);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#waiter = undefined;
        resolve({ kind: "timeout" });
      }, ms);
      this.#waiter = (item) => {
        clearTimeout(timer);
        resolve(item);
      };
    });
  }

  #push(item: InboxItem): void {
    const waiter = this.#waiter;
    if (waiter) {
      this.#waiter = undefined;
      waiter(item);
    } else {
      this.#queue.push(item);
    }
  }
}

function wsError<T>(message: string): T {
  return { event: "error", data: { status: "error", message } } as T;
}

function parseDispositionFilename(disposition: string): string | undefined {
  const encoded = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(disposition)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.trim());
    } catch {
      // fall through to the plain form
    }
  }
  return /filename\s*=\s*"?([^";]+)"?/.exec(disposition)?.[1];
}

function isRetryable(error: unknown): boolean {
  if (error instanceof APITimeoutError) return false;
  if (error instanceof APIConnectionError) return true;
  return error instanceof APIError && RETRYABLE_STATUS.has(error.status);
}

function retryDelay(attempt: number, error: unknown): number {
  const header = error instanceof APIError ? error.headers.get("retry-after") : null;
  const seconds = header ? Number(header) : Number.NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
  return Math.min(500 * 2 ** attempt, 8_000) * (0.75 + Math.random() * 0.5);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
