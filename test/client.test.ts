import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APIConnectionError,
  APITimeoutError,
  AuthenticationError,
  NotFoundError,
  OperationFailedError,
  Prometheux,
  PrometheuxError,
  QuotaExceededError,
  VERSION,
} from "../src/index.ts";
import { json, mockClient, ok } from "./helpers.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("configuration", () => {
  it("reads the token and URL from the environment", async () => {
    vi.stubEnv("PMTX_TOKEN", "env-token");
    vi.stubEnv("JARVISPY_URL", "https://env.example.test/x");
    const fetch = vi.fn(async () => ok([]));
    const px = new Prometheux({ fetch });
    await px.ontologies.list();
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://env.example.test/x/api/v1/ontologies/list");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer env-token");
  });

  it("fails fast without a token or URL", () => {
    vi.stubEnv("PMTX_TOKEN", "");
    vi.stubEnv("JARVISPY_URL", "");
    expect(() => new Prometheux({ baseUrl: "https://x.test" })).toThrow(/PMTX_TOKEN/);
    expect(() => new Prometheux({ token: "t" })).toThrow(/JARVISPY_URL/);
    expect(() => new Prometheux({ token: "t" })).toThrow(PrometheuxError);
  });

  it("sends the SDK user agent and optional Supabase token", async () => {
    const { px, calls } = mockClient([() => ok({ role: "admin" })], { supabaseToken: "sb" });
    await px.users.getRole();
    expect(calls[0]?.headers.get("user-agent")).toMatch(/^prometheux-chain-ts\/\d+\.\d+\.\d+/);
    expect(calls[0]?.headers.get("x-supabase-token")).toBe("sb");
  });

  it("keeps VERSION in step with package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(VERSION).toBe(pkg.version);
  });
});

describe("request mapping", () => {
  it("returns the id from ontologies.save, accepting the legacy key", async () => {
    const { px, calls } = mockClient([
      () => ok({ ontology_id: "abc" }),
      () => ok({ project_id: "legacy" }),
    ]);
    expect(await px.ontologies.save({ name: "demo" })).toBe("abc");
    expect(calls[0]?.body).toEqual({ project: { id: null, name: "demo" } });
    expect(await px.ontologies.save({ id: "legacy", name: "x", description: "d" })).toBe("legacy");
    expect(calls[1]?.body).toEqual({ project: { id: "legacy", name: "x", description: "d" } });
  });

  it("encodes concept names and defaults run_mode to auto", async () => {
    const { px, calls } = mockClient([() => ok({ concept_name: "a/b" })]);
    await px.concepts.run("ont1", "a/b c");
    expect(calls[0]?.url.pathname).toBe("/jarvispy/org/user/api/v1/concepts/ont1/run/a%2Fb%20c");
    expect(calls[0]?.body).toEqual({ params: {}, run_mode: "auto" });
  });

  it("splits fetchResults between query string and body", async () => {
    const { px, calls } = mockClient([() => ok({ predicate: "p" })]);
    await px.concepts.fetchResults("ont1", "location", { pageSize: 5, searchTerm: "CA" });
    expect(calls[0]?.url.searchParams.get("output_predicate")).toBe("location");
    expect(calls[0]?.body).toEqual({ page: 1, page_size: 5, search_term: "CA" });
  });

  it("only sends provided context-note fields, with null meaning clear", async () => {
    const { px, calls } = mockClient([() => ok({ id: "n1" })]);
    await px.context.update("n1", { title: "t", scopeId: null });
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.body).toEqual({
      text: null,
      kind: null,
      pinned: null,
      scope_id: null,
      title: "t",
    });
  });

  it("drops undefined query params and joins kinds", async () => {
    const { px, calls } = mockClient([() => ok([])]);
    await px.context.list("global", { kinds: ["fact", "preference"] });
    expect([...(calls[0]?.url.searchParams ?? [])]).toEqual([
      ["scope", "global"],
      ["kinds", "fact,preference"],
    ]);
  });

  it("refuses an empty delete instead of deleting everything", () => {
    const { px } = mockClient([() => ok(null)]);
    expect(() => px.concepts.delete("ont1", [])).toThrow(/must not be empty/);
    return expect(px.datasources.delete([])).rejects.toThrow(/must not be empty/);
  });

  it("uploads files as multipart form data", async () => {
    const { px, calls } = mockClient([() => ok({ filePath: "disk/a.csv" })]);
    const result = await px.files.upload(new TextEncoder().encode("a,b\n1,2"), {
      filename: "a.csv",
      path: "in",
    });
    expect(result.filePath).toBe("disk/a.csv");
    const form = calls[0]?.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect((form.get("file") as File).name).toBe("a.csv");
    expect(await (form.get("file") as File).text()).toBe("a,b\n1,2");
    expect(form.get("path")).toBe("in");
    expect(calls[0]?.headers.get("content-type")).toBeNull();
  });
});

describe("errors", () => {
  it("throws OperationFailedError for a non-success envelope", async () => {
    const { px } = mockClient([
      () => json({ status: "error", message: "", data: { errorMessage: "VL0023 boom" } }),
    ]);
    const error = await px.concepts.run("o", "c").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OperationFailedError);
    expect((error as OperationFailedError).message).toBe("Concept run failed: VL0023 boom");
  });

  it("maps HTTP statuses to typed errors", async () => {
    const { px } = mockClient([
      () => json({ detail: "Token is invalid" }, 401),
      () => json({ code: "PROJECT_LIMIT_REACHED", error: "limit" }, 402),
      () => json({ status: "error", message: "nope" }, 404),
    ]);
    const unauthorized = await px.ontologies.list().catch((e: unknown) => e);
    expect(unauthorized).toBeInstanceOf(AuthenticationError);
    expect((unauthorized as Error).message).toMatch(/Token is invalid/);
    const quota = await px.ontologies.save({ name: "x" }).catch((e: unknown) => e);
    expect(quota).toBeInstanceOf(QuotaExceededError);
    expect((quota as QuotaExceededError).code).toBe("PROJECT_LIMIT_REACHED");
    await expect(px.ontologies.save({ name: "y" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("retries GETs on 503 but never retries POSTs", async () => {
    const get = mockClient([() => json({}, 503, { "retry-after": "0" }), () => ok([])]);
    await expect(get.px.ontologies.list()).resolves.toEqual([]);
    expect(get.calls).toHaveLength(2);

    const post = mockClient([() => json({}, 503), () => ok({ ontology_id: "x" })]);
    await expect(post.px.ontologies.save({ name: "x" })).rejects.toThrow(/503/);
    expect(post.calls).toHaveLength(1);
  });

  it("wraps network failures in APIConnectionError", async () => {
    const { px } = mockClient(
      [
        () => {
          throw new TypeError("fetch failed");
        },
      ],
      { maxRetries: 0 },
    );
    await expect(px.ontologies.list()).rejects.toBeInstanceOf(APIConnectionError);
  });

  it("raises APITimeoutError when the deadline passes", async () => {
    const fetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const timed = new Prometheux({ token: "t", baseUrl: "https://x.test", fetch, timeout: 20 });
    await expect(timed.ontologies.save({ name: "x" })).rejects.toBeInstanceOf(APITimeoutError);
  });

  it("lets the caller abort a request", async () => {
    const fetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const px = new Prometheux({ token: "t", baseUrl: "https://x.test", fetch });
    const controller = new AbortController();
    const pending = px.ontologies.save({ name: "x" }, { signal: controller.signal });
    controller.abort(new Error("stop"));
    await expect(pending).rejects.toThrow("stop");
  });
});
