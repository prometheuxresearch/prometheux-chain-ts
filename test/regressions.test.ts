/**
 * One test per finding from the 2026-11-12 code review, so each fix stays fixed.
 */
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import { Prometheux } from "../src/index.ts";
import { mockClient, ok } from "./helpers.ts";

const BASE_PATH = "/jarvispy/org/user";

describe("removed delete-all calls (backend requires a non-empty list)", () => {
  it("has no deleteAll on concepts or datasources", () => {
    const { px } = mockClient([() => ok(null)]);
    expect("deleteAll" in px.concepts).toBe(false);
    expect("deleteAll" in px.datasources).toBe(false);
  });
});

describe("ontologies.save keeps fields left out of an update", () => {
  const current = {
    id: "o1",
    name: "Finance",
    description: "Ledger rules",
    author: "a",
    to_persist: true,
    created_at: null,
    updated_at: null,
  };

  it("fills in the current name when only the description changes", async () => {
    const { px, calls } = mockClient([() => ok(current), () => ok({ ontology_id: "o1" })]);
    await px.ontologies.save({ id: "o1", description: "New description" });
    expect(calls.map((c) => `${c.method} ${c.url.pathname.replace(BASE_PATH, "")}`)).toEqual([
      "GET /api/v1/ontologies/load",
      "POST /api/v1/ontologies/save",
    ]);
    expect(calls[1]?.body).toEqual({
      project: { id: "o1", name: "Finance", description: "New description" },
    });
  });

  it("fills in the current description when only the name changes", async () => {
    const { px, calls } = mockClient([() => ok(current), () => ok({ ontology_id: "o1" })]);
    await px.ontologies.save({ id: "o1", name: "Finance v2" });
    expect(calls[1]?.body).toEqual({
      project: { id: "o1", name: "Finance v2", description: "Ledger rules" },
    });
  });

  it("does not read first when both fields are given, or when creating", async () => {
    const { px, calls } = mockClient([() => ok({ ontology_id: "o1" })]);
    await px.ontologies.save({ id: "o1", name: "n", description: "d" });
    await px.ontologies.save({ name: "new" });
    expect(calls.every((c) => c.method === "POST")).toBe(true);
  });

  it("an explicit empty description is kept, not replaced", async () => {
    const { px, calls } = mockClient([() => ok(current), () => ok({ ontology_id: "o1" })]);
    await px.ontologies.save({ id: "o1", description: "" });
    expect(calls[1]?.body).toEqual({ project: { id: "o1", name: "Finance", description: "" } });
  });
});

describe("context.create sends supersedes as a list", () => {
  it("wraps a single id", async () => {
    const { px, calls } = mockClient([() => ok({ id: "n2" })]);
    await px.context.create({ scope: "global", kind: "fact", text: "t", supersedes: "n1" });
    expect(calls[0]?.body).toMatchObject({ supersedes: ["n1"] });
  });
});

describe("compute.checkAvailability sends single config objects", () => {
  it("sends machine_configs as an object", async () => {
    const { px, calls } = mockClient([() => ok({ available: true })]);
    await px.compute.checkAvailability({ machineConfigs: { id: "um1" } });
    expect(calls[0]?.body).toEqual({ compute: { machine_configs: { id: "um1" } } });
  });
});

function endlessNdjson(onCancel: () => void, gapMs = 0): Response {
  let n = 0;
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (gapMs) await new Promise((r) => setTimeout(r, gapMs));
      controller.enqueue(encoder.encode(`{"type":"content","data":{"chunk":"${n++}"}}\n`));
    },
    cancel: onCancel,
  });
  return new Response(body);
}

describe("NDJSON streams", () => {
  it("cancel the response body when the consumer breaks out early", async () => {
    const cancelled = vi.fn();
    const { px } = mockClient([() => endlessNdjson(cancelled)]);
    for await (const event of px.agent.chat("o1", "hi")) {
      if (event.type === "content") break;
    }
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("do not count the consumer's processing time as a server stall", async () => {
    const { px } = mockClient(
      [() => new Response('{"type":"content","data":{"chunk":"a"}}\n{"type":"done","data":{}}\n')],
      { timeout: 30 },
    );
    const types: string[] = [];
    for await (const event of px.agent.chat("o1", "hi")) {
      types.push(event.type);
      await new Promise((r) => setTimeout(r, 80)); // slower than the 30ms idle timeout
    }
    expect(types).toEqual(["content", "done"]);
  });

  it("still time out when the server itself goes quiet", async () => {
    const { px } = mockClient([() => endlessNdjson(() => {}, 200)], { timeout: 30 });
    const events = [];
    for await (const event of px.agent.chat("o1", "hi")) events.push(event);
    expect(events).toEqual([
      { type: "error", data: { status: "error", message: expect.stringMatching(/timed out/) } },
    ]);
  });
});

describe("downloads", () => {
  it("can still be cancelled by the caller after the headers arrive", async () => {
    const { px, calls } = mockClient([() => new Response("partial")]);
    const controller = new AbortController();
    await px.files.download("disk/big.bin", { signal: controller.signal, timeout: 10 });
    await new Promise((r) => setTimeout(r, 30)); // past the header timeout
    const fetchSignal = calls[0]?.signal;
    expect(fetchSignal?.aborted).toBe(false);
    controller.abort(new Error("stop"));
    expect(fetchSignal?.aborted).toBe(true);
  });
});

describe("run stream with an already-aborted signal", () => {
  let server: WebSocketServer;
  let baseUrl: string;
  let connections = 0;

  beforeAll(async () => {
    server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    server.on("connection", () => {
      connections++;
    });
  });

  afterAll(() => {
    for (const client of server.clients) client.terminate();
    server.close();
  });

  it("never connects, so no run is started", async () => {
    const px = new Prometheux({ token: "t", baseUrl });
    const signal = AbortSignal.abort(new Error("cancelled before start"));
    const iterator = px.concepts.runStream("o1", "c", {}, { signal });
    await expect(iterator.next()).rejects.toThrow("cancelled before start");
    await new Promise((r) => setTimeout(r, 50));
    expect(connections).toBe(0);
  });
});

describe("tooling", () => {
  it("biome ignores generated coverage output", () => {
    const config = JSON.parse(readFileSync(new URL("../biome.json", import.meta.url), "utf8"));
    expect(config.files.includes).toContain("!coverage");
  });
});
