/** Base class for every error thrown by the SDK. */
export class PrometheuxError extends Error {
  override name = "PrometheuxError";
}

/** The backend answered with an HTTP error status. */
export class APIError extends PrometheuxError {
  override name = "APIError";
  readonly status: number;
  /** Parsed JSON body when the server sent one, otherwise the raw text. */
  readonly body: unknown;
  readonly headers: Headers;

  constructor(status: number, body: unknown, headers: Headers, message?: string) {
    super(message ?? APIError.describe(status, body));
    this.status = status;
    this.body = body;
    this.headers = headers;
  }

  static from(status: number, body: unknown, headers: Headers): APIError {
    const ctor = STATUS_ERRORS[status] ?? (status >= 500 ? InternalServerError : APIError);
    return new ctor(status, body, headers);
  }

  private static describe(status: number, body: unknown): string {
    const detail = extractDetail(body);
    const prefix = STATUS_PREFIX[status] ?? `HTTP Error ${status}`;
    return detail ? `${prefix}: ${detail}` : prefix;
  }
}

export class BadRequestError extends APIError {
  override name = "BadRequestError";
}
/** Invalid or expired token — check `PMTX_TOKEN`. */
export class AuthenticationError extends APIError {
  override name = "AuthenticationError";
}
/** A plan limit was hit (`body.code`, e.g. `PROJECT_LIMIT_REACHED`). */
export class QuotaExceededError extends APIError {
  override name = "QuotaExceededError";

  get code(): string | undefined {
    const body = this.body as { code?: unknown } | null;
    return typeof body?.code === "string" ? body.code : undefined;
  }
}
export class PermissionDeniedError extends APIError {
  override name = "PermissionDeniedError";
}
export class NotFoundError extends APIError {
  override name = "NotFoundError";
}
export class ConflictError extends APIError {
  override name = "ConflictError";
}
export class UnprocessableEntityError extends APIError {
  override name = "UnprocessableEntityError";
}
export class RateLimitError extends APIError {
  override name = "RateLimitError";
}
export class InternalServerError extends APIError {
  override name = "InternalServerError";
}

/** The backend could not be reached at all. */
export class APIConnectionError extends PrometheuxError {
  override name = "APIConnectionError";
}

/** The request did not finish within the configured timeout. */
export class APITimeoutError extends APIConnectionError {
  override name = "APITimeoutError";
}

/**
 * The HTTP call succeeded but the response envelope reported a failure
 * (`status !== "success"`).
 */
export class OperationFailedError extends PrometheuxError {
  override name = "OperationFailedError";
  /** Human-readable name of the operation, e.g. `"concept run"`. */
  readonly operation: string;
  /** The full response envelope. */
  readonly response: unknown;

  constructor(operation: string, response: unknown) {
    const message = extractDetail(response) ?? "Unknown error";
    super(`${operation} failed: ${message}`);
    this.operation = operation;
    this.response = response;
  }
}

const STATUS_ERRORS: Record<number, typeof APIError> = {
  400: BadRequestError,
  401: AuthenticationError,
  402: QuotaExceededError,
  403: PermissionDeniedError,
  404: NotFoundError,
  409: ConflictError,
  422: UnprocessableEntityError,
  429: RateLimitError,
};

const STATUS_PREFIX: Record<number, string> = {
  401: "Unauthorized: invalid or expired token (check PMTX_TOKEN)",
  403: "Forbidden: you don't have permission to perform this action",
  404: "Not Found",
};

function extractDetail(body: unknown): string | undefined {
  if (typeof body === "string") return body || undefined;
  if (!body || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;
  const data = record.data as Record<string, unknown> | null | undefined;
  if (typeof data?.errorMessage === "string" && data.errorMessage) return data.errorMessage;
  for (const key of ["message", "detail", "error"]) {
    const value = record[key];
    if (typeof value === "string" && value) return value;
    if (value !== undefined && value !== null) return JSON.stringify(value);
  }
  return undefined;
}
