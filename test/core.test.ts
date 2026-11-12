import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APIError,
  BadRequestError,
  ConflictError,
  fileFromPath,
  InternalServerError,
  PermissionDeniedError,
  RateLimitError,
  UnprocessableEntityError,
} from "../src/index.ts";
import { json, mockClient, ok } from "./helpers.ts";

describe("error mapping", () => {
  it.each([
    [400, BadRequestError],
    [403, PermissionDeniedError],
    [409, ConflictError],
    [422, UnprocessableEntityError],
    [429, RateLimitError],
    [500, InternalServerError],
    [503, InternalServerError],
  ])("HTTP %i → %o", async (status, ctor) => {
    const { px } = mockClient([() => json({ status: "error", message: "boom" }, status)], {
      maxRetries: 0,
    });
    const error = await px.ontologies.save({ name: "x" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ctor);
    expect(error).toBeInstanceOf(APIError);
    expect((error as APIError).status).toBe(status);
    expect((error as APIError).body).toEqual({ status: "error", message: "boom" });
    expect((error as Error).message).toMatch(/boom/);
  });

  it("uses the base APIError for unmapped 4xx codes", async () => {
    const { px } = mockClient([() => json({ detail: "teapot" }, 418)]);
    const error = await px.ontologies.list().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(APIError);
    expect(error).not.toBeInstanceOf(BadRequestError);
    expect((error as Error).message).toBe("HTTP Error 418: teapot");
  });

  it("stringifies structured FastAPI validation details", async () => {
    const detail = [{ loc: ["body", "name"], msg: "field required" }];
    const { px } = mockClient([() => json({ detail }, 422)]);
    const error = await px.ontologies.save({}).catch((e: unknown) => e);
    expect((error as Error).message).toContain("field required");
  });

  it("keeps a non-JSON error body as text", async () => {
    const { px } = mockClient([() => new Response("Bad Gateway", { status: 502 })], {
      maxRetries: 0,
    });
    const error = await px.ontologies.list().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InternalServerError);
    expect((error as APIError).body).toBe("Bad Gateway");
  });

  it("rejects a success status with an unparseable body", async () => {
    const { px } = mockClient([() => new Response("<html>login</html>", { status: 200 })]);
    await expect(px.ontologies.list()).rejects.toThrow(/Invalid JSON response from server/);
  });

  it("names errors after their class", async () => {
    const { px } = mockClient([() => json({}, 409)]);
    const error = (await px.ontologies.save({ name: "x" }).catch((e: unknown) => e)) as Error;
    expect(error.name).toBe("ConflictError");
    expect(error.message).toBe("HTTP Error 409");
  });
});

describe("retries", () => {
  it("honours Retry-After on 429 and retries up to maxRetries", async () => {
    const { px, calls } = mockClient(
      [() => json({}, 429, { "retry-after": "0" }), () => json({}, 429, { "retry-after": "0" })],
      { maxRetries: 1 },
    );
    await expect(px.ontologies.list()).rejects.toBeInstanceOf(RateLimitError);
    expect(calls).toHaveLength(2);
  });

  it("does not retry 4xx errors other than 429", async () => {
    const { px, calls } = mockClient([() => json({}, 404), () => ok([])]);
    await expect(px.ontologies.list()).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it("stops waiting between retries when the caller aborts", async () => {
    const { px, calls } = mockClient([() => json({}, 503, { "retry-after": "10" })]);
    const controller = new AbortController();
    const pending = px.ontologies.list({ signal: controller.signal });
    setTimeout(() => controller.abort(new Error("gave up")), 20);
    await expect(pending).rejects.toThrow("gave up");
    expect(calls).toHaveLength(1);
  });
});

describe("headers", () => {
  it("merges default headers, then per-call headers, keeping auth", async () => {
    const { px, calls } = mockClient([() => ok([])], {
      defaultHeaders: { "X-Team": "data", Authorization: "ignored" },
    });
    await px.ontologies.list({ headers: { "X-Request-Id": "r1" } });
    const headers = calls[0]?.headers;
    expect(headers?.get("x-team")).toBe("data");
    expect(headers?.get("x-request-id")).toBe("r1");
    expect(headers?.get("authorization")).toBe("Bearer test-token");
    expect(headers?.get("content-type")).toBeNull();
  });
});

describe("files", () => {
  it("fileFromPath reads a local file lazily with its basename", async () => {
    const dir = await mkdtemp(join(tmpdir(), "px-"));
    const path = join(dir, "cities.csv");
    await writeFile(path, "city\nSeattle\n");
    const file = await fileFromPath(path);
    expect(file.name).toBe("cities.csv");
    expect(await file.text()).toBe("city\nSeattle\n");
    expect((await fileFromPath(path, "renamed.csv")).name).toBe("renamed.csv");
  });

  it("uploads ArrayBuffer input", async () => {
    const { px, calls } = mockClient([() => ok({ filePath: "disk/b.bin" })]);
    await px.files.upload(new Uint8Array([7, 8]).buffer, { filename: "b.bin" });
    const form = calls[0]?.body as FormData;
    const file = form.get("file") as File;
    expect(file.name).toBe("b.bin");
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([7, 8]);
  });

  it("exposes the download body as a blob, bytes, or stream", async () => {
    const { px } = mockClient([
      () => new Response("abc", { headers: { "content-type": "text/plain" } }),
      () => new Response("def"),
      () => new Response("ghi"),
    ]);
    const first = await px.files.download("disk/a.txt");
    expect(first.contentType).toBe("text/plain");
    expect(await (await first.blob()).text()).toBe("abc");
    const second = await px.files.download("disk/b.txt");
    expect(new TextDecoder().decode(await second.arrayBuffer())).toBe("def");
    const third = await px.files.download("disk/c.txt");
    expect(await new Response(third.body).text()).toBe("ghi");
  });

  it("decodes RFC 5987 filenames from Content-Disposition", async () => {
    const { px } = mockClient([
      () =>
        new Response("x", {
          headers: { "content-disposition": "attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.csv" },
        }),
    ]);
    expect((await px.files.download("disk/x")).filename).toBe("résumé.csv");
  });

  it("falls back to a safe name when the server sends '..'", async () => {
    const { px } = mockClient([
      () => new Response("x", { headers: { "content-disposition": 'attachment; filename=".."' } }),
    ]);
    expect((await px.files.download("")).filename).toBe("download");
  });

  it("throws typed errors for a failed download", async () => {
    const { px } = mockClient([() => json({ status: "error", message: "missing" }, 404)]);
    await expect(px.files.download("disk/nope")).rejects.toThrow(/missing/);
  });
});
