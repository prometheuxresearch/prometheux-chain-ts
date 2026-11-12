import { mkdtemp, readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import { Prometheux, type RunStreamEvent } from "../src/index.ts";
import { json, mockClient } from "./helpers.ts";

function ndjson(chunks: string[], { stallAfter = false } = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      if (!stallAfter) controller.close();
    },
  });
  return new Response(body, { headers: { "content-type": "application/x-ndjson" } });
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

describe("NDJSON streams", () => {
  it("reassembles lines split across chunks and keeps non-JSON lines", async () => {
    const { px, calls } = mockClient([
      () =>
        ndjson([
          '{"type":"content","data":{"chu',
          'nk":"Hel"}}\n{"type":"content","data":{"chunk":"lo"}}\n',
          "\nnot json\n",
          '{"type":"done","data":{"ontology_id":"o"}}',
        ]),
    ]);
    const events = await collect(px.agent.chat("o", "hi", { sessionId: "s1" }));
    expect(calls[0]?.body).toEqual({ message: "hi", session_id: "s1" });
    expect(events.map((e) => e.type)).toEqual(["content", "content", "raw", "done"]);
    const text = events.flatMap((e) => (e.type === "content" ? [e.data.chunk] : [])).join("");
    expect(text).toBe("Hello");
  });

  it("throws typed errors raised before the stream starts", async () => {
    const { px } = mockClient([() => json({ detail: "Token is invalid" }, 401)]);
    await expect(collect(px.agent.chat("o", "hi"))).rejects.toThrow(/Token is invalid/);
  });

  it("ends a stalled stream with a terminal error event", async () => {
    const { px } = mockClient(
      [() => ndjson(['{"type":"content","data":{"chunk":"a"}}\n'], { stallAfter: true })],
      {
        timeout: 30,
      },
    );
    const events = await collect(px.context.autoSeed({ scopeId: "o" }));
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ type: "error", data: { status: "error" } });
    expect(JSON.stringify(events[1])).toMatch(/timed out/);
  });
});

describe("downloads", () => {
  it("sanitises the server filename and saves to disk", async () => {
    const { px, calls } = mockClient([
      () =>
        new Response("a,b\n1,2\n", {
          headers: { "content-disposition": 'attachment; filename="../../etc/passwd"' },
        }),
    ]);
    const file = await px.files.download("disk/x.csv");
    expect(calls[0]?.url.searchParams.get("path")).toBe("disk/x.csv");
    expect(file.filename).toBe("passwd");
    const dir = await mkdtemp(join(tmpdir(), "px-"));
    const written = await file.saveTo(join(dir, file.filename));
    expect(await readFile(written, "utf8")).toBe("a,b\n1,2\n");
  });

  it("falls back to the requested path's basename", async () => {
    const { px } = mockClient([() => new Response("x")]);
    const file = await px.files.download("disk/reports/q3.csv");
    expect(file.filename).toBe("q3.csv");
    expect(await file.text()).toBe("x");
  });
});

describe("run stream (WebSocket)", () => {
  let server: WebSocketServer;
  let baseUrl: string;
  const received: { url: string; init: unknown }[] = [];

  beforeAll(async () => {
    server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/jarvispy/o/u`;
    server.on("connection", (socket, request) => {
      socket.once("message", (raw) => {
        const init = JSON.parse(String(raw));
        received.push({ url: request.url ?? "", init });
        const mode = new URL(request.url ?? "", "http://x").pathname.split("/").pop();
        if (mode === "drop") return socket.close(4001, "invalid token");
        if (mode === "silent") return;
        socket.send(JSON.stringify({ event: "ping" }));
        socket.send(
          JSON.stringify({ event: "concept_status", data: { concept: "c", status: "running" } }),
        );
        socket.send(Buffer.from("not json"));
        socket.send(
          JSON.stringify({
            event: "complete",
            data: { status: "success", data: { total_records: 3 } },
          }),
        );
        socket.send(JSON.stringify({ event: "concept_status", data: { after: true } }));
      });
    });
  });

  afterAll(() => {
    for (const client of server.clients) client.terminate();
    server.close();
  });

  const client = (wsTimeout = 2000) =>
    new Prometheux({ token: "tok en", baseUrl, wsTimeout, supabaseToken: "sb" });

  it("authenticates via query params, skips pings, and stops at complete", async () => {
    const events: RunStreamEvent[] = await collect(
      client().concepts.runStream("ont", "ok", { runMode: "all", params: { x: 1 } }),
    );
    expect(events.map((e) => e.event)).toEqual(["concept_status", "complete"]);
    const last = received.at(-1);
    const url = new URL(last?.url ?? "", "http://x");
    expect(url.pathname).toBe("/jarvispy/o/u/api/v1/concepts/ont/run-stream/ok");
    expect(url.searchParams.get("token")).toBe("tok en");
    expect(url.searchParams.get("x_supabase_token")).toBe("sb");
    expect(last?.init).toEqual({ params: { x: 1 }, run_mode: "all" });
  });

  it("turns an early close into a terminal error event", async () => {
    const events = await collect(client().concepts.runStream("ont", "drop"));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event: "error" });
    expect(JSON.stringify(events[0])).toMatch(/4001/);
  });

  it("gives up on a silent server after the idle timeout", async () => {
    const events = await collect(client(50).concepts.runStream("ont", "silent"));
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0])).toMatch(/timed out/);
  });

  it("stops when the caller aborts", async () => {
    const controller = new AbortController();
    const iterator = client().concepts.runStream(
      "ont",
      "silent",
      {},
      { signal: controller.signal },
    );
    const pending = iterator.next();
    setTimeout(() => controller.abort(new Error("cancelled")), 20);
    await expect(pending).rejects.toThrow("cancelled");
  });

  it("rejects when nothing is listening", async () => {
    const dead = new Prometheux({ token: "t", baseUrl: "http://127.0.0.1:1" });
    const spy = vi.fn();
    await expect(collect(dead.concepts.runStream("o", "c"))).rejects.toThrow(/WebSocket/);
    expect(spy).not.toHaveBeenCalled();
  });
});
