/**
 * vadalog.evaluate tags each evaluation and stops it on the engine when the
 * caller gives up on it, so an abandoned run does not keep the engine busy.
 */
import { describe, expect, it } from "vitest";
import { APITimeoutError, OperationFailedError } from "../src/index.ts";
import { json, mockClient, ok, type Recorded } from "./helpers.ts";

const BASE_PATH = "/jarvispy/org/user";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Never answers; rejects when the request is aborted. */
const hang = (req: Recorded) =>
  new Promise<Response>((_, reject) => {
    req.signal?.addEventListener("abort", () => reject(req.signal?.reason));
  });

const stopped = () => json({ status: "success", data: { engine_stopped: false } });

function route(calls: Recorded[]): string[] {
  return calls.map((c) => `${c.method} ${c.url.pathname.replace(BASE_PATH, "")}${c.url.search}`);
}

describe("vadalog.evaluate", () => {
  it("tags each evaluation with a fresh UUID by default", async () => {
    const { px, calls } = mockClient([() => ok({ resultSet: {} })]);
    await px.vadalog.evaluate("a(1).");
    await px.vadalog.evaluate("a(1).");
    const ids = calls.map((c) => (c.body as { execution_id: string }).execution_id);
    expect(ids[0]).toMatch(UUID);
    expect(ids[1]).toMatch(UUID);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("stops its evaluation on the engine when the request times out", async () => {
    const { px, calls } = mockClient([hang, stopped], { timeout: 20 });
    const error = await px.vadalog.evaluate("a(1).", { executionId: "run-1" }).catch((e) => e);
    expect(error).toBeInstanceOf(APITimeoutError);
    expect(route(calls)).toEqual([
      "POST /api/v1/vadalog/evaluate",
      "GET /api/v1/vadalog/stop?execution_id=run-1",
    ]);
  });

  it("stops its evaluation on the engine when the caller aborts", async () => {
    const { px, calls } = mockClient([hang, stopped]);
    const controller = new AbortController();
    const pending = px.vadalog.evaluate(
      "a(1).",
      { executionId: "run-1" },
      {
        signal: controller.signal,
      },
    );
    controller.abort(new Error("cancelled"));
    await expect(pending).rejects.toThrow("cancelled");
    expect(route(calls)).toEqual([
      "POST /api/v1/vadalog/evaluate",
      "GET /api/v1/vadalog/stop?execution_id=run-1",
    ]);
    // The stop request must not reuse the caller's aborted signal.
    expect(calls[1]?.signal?.aborted).toBe(false);
  });

  it("still throws the original error when the stop request fails", async () => {
    const { px } = mockClient([hang, () => json({ detail: "down" }, 503)], {
      timeout: 20,
      maxRetries: 0,
    });
    await expect(px.vadalog.evaluate("a(1).")).rejects.toBeInstanceOf(APITimeoutError);
  });

  it("does not send a stop when the engine reports an error", async () => {
    const { px, calls } = mockClient([() => json({ status: "error", message: "bad rule" })]);
    await expect(px.vadalog.evaluate("a(1).")).rejects.toBeInstanceOf(OperationFailedError);
    expect(calls).toHaveLength(1);
  });
});

describe("vadalog.stop", () => {
  it("resolves to the reply when nothing was running, instead of throwing", async () => {
    const reply = { status: "error", message: "Nothing was running; the session was reset." };
    const { px } = mockClient([() => json(reply)]);
    await expect(px.vadalog.stop()).resolves.toEqual(reply);
  });
});
