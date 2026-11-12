export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/**
 * A response object whose exact shape the backend does not pin down. Known
 * fields are typed; anything else is still reachable.
 */
export type Loose<T> = T & { [key: string]: unknown };

/** The `{ status, message, data }` envelope every JarvisPy endpoint returns. */
export interface Envelope<T = unknown> {
  status: "success" | "error" | (string & {});
  message?: string;
  data?: T;
  [key: string]: unknown;
}

/**
 * Compute target forwarded to the engine, e.g. a machine or Databricks config.
 * Passed through verbatim.
 */
export type Compute = JsonObject;

/** Per-call overrides accepted by every SDK method as its last argument. */
export interface RequestOptions {
  /** Cancels the request (or ends a stream) when aborted. */
  signal?: AbortSignal;
  /** Overrides the client's timeout for this call, in milliseconds. */
  timeout?: number;
  /** Extra headers merged over the defaults. */
  headers?: Record<string, string>;
}
