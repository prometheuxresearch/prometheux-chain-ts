import { vi } from "vitest";
import type { ClientOptions } from "../src/index.ts";
import { Prometheux } from "../src/index.ts";

export interface Recorded {
  method: string;
  url: URL;
  headers: Headers;
  body: unknown;
  signal: AbortSignal | undefined;
}

type Responder = (req: Recorded) => Response | Promise<Response>;

/** A client whose fetch is served by `responders`, in order (the last one repeats). */
export function mockClient(responders: Responder[], options: ClientOptions = {}) {
  const calls: Recorded[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    let body: unknown = init?.body;
    if (typeof body === "string") body = JSON.parse(body);
    const req: Recorded = {
      method: init?.method ?? "GET",
      url: new URL(String(input)),
      headers: new Headers(init?.headers),
      body,
      signal: init?.signal ?? undefined,
    };
    calls.push(req);
    const responder = responders[Math.min(calls.length - 1, responders.length - 1)];
    if (!responder) throw new Error("no responder");
    return responder(req);
  });
  const px = new Prometheux({
    token: "test-token",
    baseUrl: "https://api.example.test/jarvispy/org/user/",
    fetch: fetch as typeof globalThis.fetch,
    ...options,
  });
  return { px, calls, fetch };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export const ok = (data: unknown): Response => json({ status: "success", message: "ok", data });
