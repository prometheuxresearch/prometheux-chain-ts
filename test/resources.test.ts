/**
 * Wire-format contract for every SDK method: HTTP method, path, query string,
 * body, and what the method resolves to. Expectations mirror the Python
 * `prometheux_chain` client, which is the reference implementation.
 */
import { describe, expect, it } from "vitest";
import { type Database, OperationFailedError, type Prometheux } from "../src/index.ts";
import { json, mockClient } from "./helpers.ts";

/** How a method turns the `{ status, message, data }` envelope into its result. */
type Returns =
  | "data" // `data`, throws when status !== "success"
  | "void" // nothing, throws when status !== "success"
  | "message" // `message`, throws when status !== "success"
  | "raw"; // the whole body, never inspects `status`

interface Case {
  /** `resource.method`, used by the completeness check below. */
  name: string;
  call: (px: Prometheux) => Promise<unknown>;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** Path after the base URL. */
  path: string;
  query?: Record<string, string>;
  /** Expected JSON body; omit for "no body". */
  body?: unknown;
  returns?: Returns;
}

const db: Database = { databaseType: "postgresql", host: "db.local", port: 5432, tables: ["t"] };
const dbWire = {
  databaseType: "postgresql",
  username: null,
  password: null,
  host: "db.local",
  port: 5432,
  databaseName: null,
  options: null,
  schema: null,
  catalog: null,
  query: null,
  selectedColumns: null,
  ignoreColumns: null,
  ignoreTables: null,
  tables: ["t"],
  url: null,
};
const compute = { machine_id: "m1" };
const roles = { source: 0, target: 1 };

const cases: Case[] = [
  // ── Ontologies ──────────────────────────────────────────────────────────
  {
    name: "ontologies.list",
    call: (px) => px.ontologies.list(),
    method: "GET",
    path: "/api/v1/ontologies/list",
  },
  {
    name: "ontologies.get",
    call: (px) => px.ontologies.get("o1"),
    method: "GET",
    path: "/api/v1/ontologies/load",
    query: { project_id: "o1" },
  },
  {
    name: "ontologies.delete",
    call: (px) => px.ontologies.delete("o1"),
    method: "POST",
    path: "/api/v1/ontologies/cleanup",
    body: { project: { id: "o1" } },
    returns: "void",
  },
  {
    name: "ontologies.copy",
    call: (px) => px.ontologies.copy("o1", { newName: "Copy", compute }),
    method: "POST",
    path: "/api/v1/ontologies/copy",
    body: { project_id: "o1", new_project_name: "Copy", compute },
  },
  {
    name: "ontologies.copy (defaults)",
    call: (px) => px.ontologies.copy("o1"),
    method: "POST",
    path: "/api/v1/ontologies/copy",
    body: { project_id: "o1", new_project_name: null },
  },
  {
    name: "ontologies.export",
    call: (px) => px.ontologies.export("o1"),
    method: "POST",
    path: "/api/v1/ontologies/export-ontology",
    body: { project_id: "o1" },
  },
  {
    name: "ontologies.import",
    call: (px) => px.ontologies.import({ project: "x" }, { forceNewId: true, compute }),
    method: "POST",
    path: "/api/v1/ontologies/import-ontology",
    body: { export_data: { project: "x" }, force_new_id: true, compute },
  },
  {
    name: "ontologies.snapshots.create",
    call: (px) => px.ontologies.snapshots.create("o1", "before refactor"),
    method: "POST",
    path: "/api/v1/ontologies/snapshots/create",
    body: { project_id: "o1", description: "before refactor" },
  },
  {
    name: "ontologies.snapshots.list",
    call: (px) => px.ontologies.snapshots.list("o1"),
    method: "GET",
    path: "/api/v1/ontologies/snapshots/list",
    query: { project_id: "o1" },
  },
  {
    name: "ontologies.snapshots.restore",
    call: (px) => px.ontologies.snapshots.restore("o1", "s1"),
    method: "POST",
    path: "/api/v1/ontologies/snapshots/restore",
    body: { snapshot_id: "s1", project_id: "o1", create_safety_snapshot: true },
  },
  {
    name: "ontologies.snapshots.restore (no safety snapshot)",
    call: (px) => px.ontologies.snapshots.restore("o1", "s1", { createSafetySnapshot: false }),
    method: "POST",
    path: "/api/v1/ontologies/snapshots/restore",
    body: { snapshot_id: "s1", project_id: "o1", create_safety_snapshot: false },
  },
  {
    name: "ontologies.snapshots.delete",
    call: (px) => px.ontologies.snapshots.delete("o1", "s1"),
    method: "POST",
    path: "/api/v1/ontologies/snapshots/delete",
    body: { snapshot_id: "s1", project_id: "o1" },
    returns: "void",
  },
  {
    name: "templates.list",
    call: (px) => px.templates.list(),
    method: "GET",
    path: "/api/v1/ontologies/list-templates",
  },
  {
    name: "templates.import",
    call: (px) => px.templates.import("t1", { newName: "From template", compute }),
    method: "POST",
    path: "/api/v1/ontologies/import-template",
    body: { template_id: "t1", new_project_name: "From template", compute },
  },
  {
    name: "workspace.export",
    call: (px) => px.workspace.export(),
    method: "POST",
    path: "/api/v1/ontologies/export-workspace",
    body: {},
  },
  {
    name: "workspace.import",
    call: (px) => px.workspace.import({ projects: [] }),
    method: "POST",
    path: "/api/v1/ontologies/import-workspace",
    body: { export_data: { projects: [] } },
  },

  // ── Data sources ────────────────────────────────────────────────────────
  {
    name: "datasources.connect",
    call: (px) => px.datasources.connect(db, { computeRowCount: true }),
    method: "POST",
    path: "/api/v1/data/connect",
    body: { database: dbWire, computeRowCount: true },
  },
  {
    name: "datasources.list",
    call: (px) => px.datasources.list(),
    method: "GET",
    path: "/api/v1/data/list",
  },
  {
    name: "datasources.delete",
    call: (px) => px.datasources.delete(["d1", "d2"]),
    method: "POST",
    path: "/api/v1/data/cleanup",
    body: { source_ids: ["d1", "d2"] },
    returns: "void",
  },
  {
    name: "datasources.deleteAll",
    call: (px) => px.datasources.deleteAll(),
    method: "POST",
    path: "/api/v1/data/cleanup",
    body: { source_ids: null },
    returns: "void",
  },
  {
    name: "datasources.inferSchema",
    call: (px) => px.datasources.inferSchema(db),
    method: "POST",
    path: "/api/v1/data/infer-schema",
    body: { database: dbWire, addBind: true, addModel: false },
  },
  {
    name: "datasources.listSheets",
    call: (px) => px.datasources.listSheets(db),
    method: "POST",
    path: "/api/v1/data/list-sheets",
    body: { database: dbWire },
  },
  {
    name: "datasources.listDemo",
    call: (px) => px.datasources.listDemo(),
    method: "GET",
    path: "/api/v1/data/demo-sources",
  },
  {
    name: "datasources.refresh",
    call: (px) => px.datasources.refresh(),
    method: "POST",
    path: "/api/v1/data/refresh",
    body: { group_filter: null },
  },
  {
    name: "datasources.preview",
    call: (px) => px.datasources.preview("@bind(...)."),
    method: "POST",
    path: "/api/v1/data/preview",
    body: { bind_annotation: "@bind(...).", limit: 10, page: 1, page_size: 0 },
  },
  {
    name: "datasources.preview (all options)",
    call: (px) =>
      px.datasources.preview("@bind(...).", {
        limit: 5,
        page: 2,
        pageSize: 20,
        orderBy: "name",
        searchTerm: "x",
        columnFilters: [{ column: "a", op: "eq", value: 1 }],
        compute,
      }),
    method: "POST",
    path: "/api/v1/data/preview",
    body: {
      bind_annotation: "@bind(...).",
      limit: 5,
      page: 2,
      page_size: 20,
      order_by: "name",
      search_term: "x",
      column_filters: [{ column: "a", op: "eq", value: 1 }],
      compute,
    },
  },
  {
    name: "datasources.allPairsJoin",
    call: (px) => px.datasources.allPairsJoin([db]),
    method: "POST",
    path: "/api/v1/data/all-pairs-join",
    body: { database_payloads: [dbWire], to_evaluate: false, parallel: true },
  },

  // ── Files ───────────────────────────────────────────────────────────────
  {
    name: "files.list",
    call: (px) => px.files.list(),
    method: "GET",
    path: "/api/v1/data/files/list",
    query: { path: "" },
  },
  {
    name: "files.mkdir",
    call: (px) => px.files.mkdir("inputs"),
    method: "POST",
    path: "/api/v1/data/files/mkdir",
    body: { path: "inputs" },
  },
  {
    name: "files.delete",
    call: (px) => px.files.delete(["inputs"], { recursive: true }),
    method: "POST",
    path: "/api/v1/data/files/delete",
    body: { paths: ["inputs"], recursive: true },
  },
  {
    name: "files.move",
    call: (px) => px.files.move("a.csv", "b.csv"),
    method: "POST",
    path: "/api/v1/data/files/move",
    body: { source: "a.csv", destination: "b.csv" },
  },

  // ── Concepts ────────────────────────────────────────────────────────────
  {
    name: "concepts.save",
    call: (px) => px.concepts.save("o1", { definition: "a(1)." }),
    method: "POST",
    path: "/api/v1/concepts/o1/save",
    body: { definition: "a(1).", concept_type: "logic" },
  },
  {
    name: "concepts.save (all options)",
    call: (px) =>
      px.concepts.save("o1", {
        definition: "SELECT 1",
        conceptType: "sql",
        conceptName: "one",
        description: "d",
        pythonScripts: ["s"],
        binds: ["b"],
        outputPredicate: "one",
        existingName: "old",
        position: 0,
        group: "g",
        compute,
        forceOverwrite: true,
        conceptConfig: { k: "v" },
      }),
    method: "POST",
    path: "/api/v1/concepts/o1/save",
    body: {
      definition: "SELECT 1",
      concept_type: "sql",
      concept_name: "one",
      description: "d",
      python_scripts: ["s"],
      binds: ["b"],
      output_predicate: "one",
      existing_name: "old",
      position: 0,
      group: "g",
      compute,
      force_overwrite: true,
      concept_config: { k: "v" },
    },
  },
  {
    name: "concepts.rename",
    call: (px) => px.concepts.rename("o1", "a", "b"),
    method: "POST",
    path: "/api/v1/concepts/o1/rename",
    body: { old_name: "a", new_name: "b" },
  },
  {
    name: "concepts.list",
    call: (px) => px.concepts.list("o1"),
    method: "GET",
    path: "/api/v1/concepts/o1/list",
  },
  {
    name: "concepts.run",
    call: (px) =>
      px.concepts.run("o1", "c", {
        params: { year: 2026 },
        runMode: "single",
        persistOutputs: false,
        compute,
      }),
    method: "POST",
    path: "/api/v1/concepts/o1/run/c",
    body: { params: { year: 2026 }, run_mode: "single", persist_outputs: false, compute },
  },
  {
    name: "concepts.delete",
    call: (px) => px.concepts.delete("o1", ["a"]),
    method: "POST",
    path: "/api/v1/concepts/o1/cleanup",
    body: { concept_names: ["a"] },
  },
  {
    name: "concepts.deleteAll",
    call: (px) => px.concepts.deleteAll("o1"),
    method: "POST",
    path: "/api/v1/concepts/o1/cleanup",
    body: {},
  },
  {
    name: "concepts.reorder",
    call: (px) => px.concepts.reorder("o1", ["b", "a"], "g"),
    method: "POST",
    path: "/api/v1/concepts/o1/reorder",
    body: { concept_names: ["b", "a"], group: "g" },
  },
  {
    name: "concepts.fetchResults (all options)",
    call: (px) =>
      px.concepts.fetchResults("o1", "p", {
        page: 2,
        pageSize: 25,
        orderBy: "a",
        params: { x: 1 },
        compute,
        searchTerm: "",
        columnFilters: [],
        totalCount: 100,
      }),
    method: "POST",
    path: "/api/v1/concepts/o1/fetch",
    query: { output_predicate: "p" },
    body: {
      page: 2,
      page_size: 25,
      order_by: "a",
      params: { x: 1 },
      compute,
      search_term: "",
      column_filters: [],
      total_count: 100,
    },
  },
  {
    name: "concepts.searchResults",
    call: (px) => px.concepts.searchResults("o1", "p", { searchTerm: "WA" }),
    method: "POST",
    path: "/api/v1/concepts/o1/fetch",
    query: { output_predicate: "p" },
    body: { page: 1, page_size: 0, search_term: "WA" },
  },
  {
    name: "concepts.query",
    call: (px) => px.concepts.query("o1", "c", "SELECT * FROM c", { compute }),
    method: "POST",
    path: "/api/v1/concepts/o1/query",
    body: { concept_name: "c", sql: "SELECT * FROM c", compute },
  },
  {
    name: "concepts.searchSimilar",
    call: (px) => px.concepts.searchSimilar("revenue", { topK: 3, excludeOntologyId: "o1" }),
    method: "GET",
    path: "/api/v1/concepts/search-similar",
    query: { query: "revenue", top_k: "3", exclude_project_id: "o1" },
  },
  {
    name: "concepts.llmAnalysis",
    call: (px) =>
      px.concepts.llmAnalysis("o1", "Why?", {
        predicateNames: ["p"],
        predicateData: [[1]],
        params: { x: 1 },
        promptTuning: "be brief",
        promptTuningName: "brief",
        defaultResponse: "n/a",
        compute,
      }),
    method: "POST",
    path: "/api/v1/concepts/o1/llm",
    body: {
      question: "Why?",
      predicate_names: ["p"],
      predicate_data: [[1]],
      params: { x: 1 },
      prompt_tuning: "be brief",
      prompt_tuning_name: "brief",
      default_response: "n/a",
      compute,
    },
  },
  {
    name: "concepts.generateDescription",
    call: (px) => px.concepts.generateDescription("o1", "c"),
    method: "POST",
    path: "/api/v1/concepts/o1/generate-description",
    body: { concept_name: "c" },
  },
  {
    name: "concepts.getDescription",
    call: (px) => px.concepts.getDescription("o1", "c"),
    method: "GET",
    path: "/api/v1/concepts/o1/description",
    query: { concept_name: "c" },
  },
  {
    name: "concepts.executionStatus",
    call: (px) => px.concepts.executionStatus("o1"),
    method: "GET",
    path: "/api/v1/concepts/o1/execution-status",
  },
  {
    name: "concepts.executionStatuses",
    call: (px) => px.concepts.executionStatuses(),
    method: "GET",
    path: "/api/v1/concepts/execution-statuses",
  },

  // ── Ontology schema & graphs ────────────────────────────────────────────
  {
    name: "ontologySchema.save",
    call: (px) => px.ontologySchema.save("o1", { nodes: [] }),
    method: "POST",
    path: "/api/v1/concepts/o1/save-ontology-schema",
    body: { ontology_schema_data: { nodes: [] } },
  },
  {
    name: "ontologySchema.load",
    call: (px) => px.ontologySchema.load("o1"),
    method: "GET",
    path: "/api/v1/concepts/o1/load-ontology-schema",
  },
  {
    name: "ontologySchema.setConceptType",
    call: (px) =>
      px.ontologySchema.setConceptType("o1", "works at", {
        type: "edge",
        edgeSource: "person",
        edgeTarget: "company",
      }),
    method: "PATCH",
    path: "/api/v1/concepts/o1/concepts/works%20at/ontology-schema-type",
    body: { ontology_schema_type: "edge", edge_source: "person", edge_target: "company" },
  },
  {
    name: "ontologySchema.setConceptType (reset)",
    call: (px) => px.ontologySchema.setConceptType("o1", "c", { type: null }),
    method: "PATCH",
    path: "/api/v1/concepts/o1/concepts/c/ontology-schema-type",
    body: { ontology_schema_type: null },
  },
  {
    name: "ontologySchema.addToLineage",
    call: (px) => px.ontologySchema.addToLineage("o1", "node", { id: "n" }),
    method: "POST",
    path: "/api/v1/concepts/o1/add-to-lineage",
    body: { element_type: "node", element_data: { id: "n" }, all_nodes: [] },
  },
  {
    name: "ontologySchema.importOwl",
    call: (px) => px.ontologySchema.importOwl("o1", "<owl/>", "http://ex.org#"),
    method: "POST",
    path: "/api/v1/concepts/o1/import-owl",
    body: { owl_content: "<owl/>", base_namespace: "http://ex.org#" },
  },
  {
    name: "graphs.conceptLineage",
    call: (px) => px.graphs.conceptLineage("o1"),
    method: "POST",
    path: "/api/v1/kgs/o1/visualize-concept-lineage",
    body: {},
  },
  {
    name: "graphs.build",
    call: (px) => px.graphs.build("o1", "knows", roles),
    method: "POST",
    path: "/api/v1/kgs/o1/build-graph/knows",
    query: {
      page: "1",
      page_size: "0",
      pagination_mode: "records",
      max_depth: "50",
      recompute: "false",
    },
    body: { column_roles: roles },
  },
  {
    name: "graphs.build (all options)",
    call: (px) =>
      px.graphs.build("o1", "knows", roles, {
        page: 2,
        pageSize: 10,
        orderBy: "a",
        paginationMode: "nodes",
        maxDepth: 3,
        sourceNode: "alice",
        targetNode: "bob",
        recompute: true,
        compute,
      }),
    method: "POST",
    path: "/api/v1/kgs/o1/build-graph/knows",
    query: {
      page: "2",
      page_size: "10",
      pagination_mode: "nodes",
      max_depth: "3",
      recompute: "true",
      order_by: "a",
      source_node: "alice",
      target_node: "bob",
    },
    body: { column_roles: roles, compute },
  },
  {
    name: "graphs.listFunctions",
    call: (px) => px.graphs.listFunctions(),
    method: "GET",
    path: "/api/v1/kgs/graph-functions",
  },
  {
    name: "graphs.runAnalytics",
    call: (px) =>
      px.graphs.runAnalytics("o1", "knows", roles, "pagerank", {
        functionParams: { damping: 0.85 },
        compute,
      }),
    method: "POST",
    path: "/api/v1/kgs/o1/graph-analytics/knows",
    body: {
      column_roles: roles,
      function: "pagerank",
      function_params: { damping: 0.85 },
      compute,
    },
  },

  // ── Context layer ───────────────────────────────────────────────────────
  {
    name: "context.list",
    call: (px) => px.context.list("ontology", { scopeId: "o1" }),
    method: "GET",
    path: "/api/v1/knowledge/context",
    query: { scope: "ontology", scope_id: "o1" },
  },
  {
    name: "context.create",
    call: (px) => px.context.create({ scope: "global", kind: "preference", text: "Use EUR" }),
    method: "POST",
    path: "/api/v1/knowledge/context",
    body: {
      scope: "global",
      scope_id: null,
      kind: "preference",
      text: "Use EUR",
      source: "user",
      pinned: false,
      activation: "retrieved",
    },
  },
  {
    name: "context.create (rule)",
    call: (px) =>
      px.context.create({
        scope: "ontology",
        scopeId: "o1",
        kind: "preference",
        text: "Always round to 2 decimals",
        activation: "always",
        pinned: true,
        supersedes: "n0",
        title: "Rounding",
        folderPath: "rules",
      }),
    method: "POST",
    path: "/api/v1/knowledge/context",
    body: {
      scope: "ontology",
      scope_id: "o1",
      kind: "preference",
      text: "Always round to 2 decimals",
      source: "user",
      pinned: true,
      activation: "always",
      supersedes: "n0",
      title: "Rounding",
      folder_path: "rules",
    },
  },
  {
    name: "context.createFromFile",
    call: (px) => px.context.createFromFile("disk/spec.pdf", { scope: "ontology", scopeId: "o1" }),
    method: "POST",
    path: "/api/v1/knowledge/context/from-file",
    body: { scope: "ontology", file_path: "disk/spec.pdf", scope_id: "o1" },
  },
  {
    name: "context.get",
    call: (px) => px.context.get("n1"),
    method: "GET",
    path: "/api/v1/knowledge/context/n1",
  },
  {
    name: "context.update",
    call: (px) => px.context.update("n1", { text: "t", kind: "fact", activation: "on_demand" }),
    method: "PATCH",
    path: "/api/v1/knowledge/context/n1",
    body: { text: "t", kind: "fact", pinned: null, activation: "on_demand" },
  },
  {
    name: "context.delete",
    call: (px) => px.context.delete("n1"),
    method: "DELETE",
    path: "/api/v1/knowledge/context/n1",
    returns: "void",
  },
  {
    name: "context.createEdge",
    call: (px) =>
      px.context.createEdge({ srcType: "note", srcId: "n1", dstType: "concept", dstId: "c" }),
    method: "POST",
    path: "/api/v1/knowledge/context/edges",
    body: {
      src_type: "note",
      src_id: "n1",
      dst_type: "concept",
      dst_id: "c",
      relation: "relates_to",
      created_by: "user",
    },
  },
  {
    name: "context.search",
    call: (px) => px.context.search("currency", { scope: "global" }),
    method: "POST",
    path: "/api/v1/knowledge/context/search",
    query: { scope: "global", top_k: "10" },
    body: { query: "currency" },
  },
  {
    name: "context.interviewTemplate",
    call: (px) => px.context.interviewTemplate(),
    method: "GET",
    path: "/api/v1/knowledge/interview/template",
    query: { scope: "global" },
  },
  {
    name: "context.submitInterview",
    call: (px) => px.context.submitInterview("ontology", { q1: "a" }, "o1"),
    method: "POST",
    path: "/api/v1/knowledge/interview",
    body: { scope: "ontology", answers: { q1: "a" }, scope_id: "o1" },
  },
  {
    name: "context.onboardingStatus",
    call: (px) => px.context.onboardingStatus(),
    method: "GET",
    path: "/api/v1/knowledge/onboarding-status",
  },
  {
    name: "context.ontologyText",
    call: (px) => px.context.ontologyText("o1", { refresh: true }),
    method: "GET",
    path: "/api/v1/knowledge/ontology/o1/text",
    query: { refresh: "true" },
  },

  // ── Agent & chat sessions ───────────────────────────────────────────────
  {
    name: "agent.reset",
    call: (px) => px.agent.reset("o1", "s1"),
    method: "POST",
    path: "/api/v1/agent/o1/reset",
    body: { session_id: "s1" },
    returns: "message",
  },
  {
    name: "chatSessions.list",
    call: (px) => px.chatSessions.list(),
    method: "GET",
    path: "/api/v1/chat-history/sessions",
    query: { limit: "50" },
  },
  {
    name: "chatSessions.list (by ontology)",
    call: (px) => px.chatSessions.list({ ontologyId: "o1", limit: 5 }),
    method: "GET",
    path: "/api/v1/chat-history/sessions",
    query: { limit: "5", project_id: "o1" },
  },
  {
    name: "chatSessions.get",
    call: (px) => px.chatSessions.get("s1"),
    method: "GET",
    path: "/api/v1/chat-history/sessions/s1",
  },
  {
    name: "chatSessions.rename",
    call: (px) => px.chatSessions.rename("s1", "Better title"),
    method: "PATCH",
    path: "/api/v1/chat-history/sessions/s1",
    body: { title: "Better title" },
    returns: "message",
  },
  {
    name: "chatSessions.delete",
    call: (px) => px.chatSessions.delete("s1"),
    method: "DELETE",
    path: "/api/v1/chat-history/sessions/s1",
    returns: "void",
  },
  {
    name: "assistant.listSkills",
    call: (px) => px.assistant.listSkills(),
    method: "GET",
    path: "/api/v1/assistant/skills",
  },
  {
    name: "assistant.getSkill",
    call: (px) => px.assistant.getSkill("answer-data-questions"),
    method: "GET",
    path: "/api/v1/assistant/skills/answer-data-questions",
  },
  {
    name: "assistant.companyInfo",
    call: (px) => px.assistant.companyInfo("pricing"),
    method: "GET",
    path: "/api/v1/assistant/company-info",
    query: { query: "pricing" },
  },

  // ── Sharing & apps ──────────────────────────────────────────────────────
  {
    name: "shares.create",
    call: (px) =>
      px.shares.create("o1", { email: "ana@example.com" }, "viewer", { expiresInMinutes: 60 }),
    method: "POST",
    path: "/api/v1/ontologies/share",
    body: {
      project_id: "o1",
      recipient: { email: "ana@example.com" },
      share_role: "viewer",
      expires_in_minutes: 60,
    },
  },
  {
    name: "shares.revoke",
    call: (px) => px.shares.revoke({ shareId: "sh1" }),
    method: "POST",
    path: "/api/v1/ontologies/share/revoke",
    body: { share_id: "sh1" },
  },
  {
    name: "shares.revoke (by recipient)",
    call: (px) => px.shares.revoke({ ontologyId: "o1", recipientSub: "u1" }),
    method: "POST",
    path: "/api/v1/ontologies/share/revoke",
    body: { project_id: "o1", recipient_sub: "u1" },
  },
  {
    name: "shares.updateRole",
    call: (px) => px.shares.updateRole("sh1", "editor"),
    method: "POST",
    path: "/api/v1/ontologies/share/update-role",
    body: { share_id: "sh1", share_role: "editor" },
  },
  {
    name: "shares.list",
    call: (px) => px.shares.list("o1"),
    method: "GET",
    path: "/api/v1/ontologies/share/list",
    query: { project_id: "o1" },
  },
  {
    name: "shares.inbox",
    call: (px) => px.shares.inbox(),
    method: "GET",
    path: "/api/v1/ontologies/share/inbox",
  },
  {
    name: "shares.accept",
    call: (px) => px.shares.accept("sh1"),
    method: "POST",
    path: "/api/v1/ontologies/share/accept",
    body: { share_id: "sh1" },
  },
  {
    name: "shares.leave",
    call: (px) => px.shares.leave("sh1"),
    method: "POST",
    path: "/api/v1/ontologies/share/leave",
    body: { share_id: "sh1" },
  },
  {
    name: "shares.syncInbox",
    call: (px) => px.shares.syncInbox(),
    method: "POST",
    path: "/api/v1/ontologies/share/sync",
  },
  {
    name: "apps.listAll",
    call: (px) => px.apps.listAll(),
    method: "GET",
    path: "/api/v1/apps/list",
  },
  {
    name: "apps.list",
    call: (px) => px.apps.list("o1"),
    method: "GET",
    path: "/api/v1/apps/o1/list",
  },
  {
    name: "apps.get",
    call: (px) => px.apps.get("o1", "a1"),
    method: "GET",
    path: "/api/v1/apps/o1/a1",
  },
  {
    name: "apps.save",
    call: (px) => px.apps.save("o1", { name: "Dashboard", tabs: [] }),
    method: "POST",
    path: "/api/v1/apps/o1/save",
    body: { app: { name: "Dashboard", tabs: [] } },
  },
  {
    name: "apps.delete",
    call: (px) => px.apps.delete("o1", "a1"),
    method: "DELETE",
    path: "/api/v1/apps/o1/a1",
    returns: "void",
  },
  {
    name: "apps.publish",
    call: (px) => px.apps.publish("o1", "a1"),
    method: "POST",
    path: "/api/v1/apps/o1/a1/publish",
  },
  {
    name: "apps.unpublish",
    call: (px) => px.apps.unpublish("o1", "a1"),
    method: "POST",
    path: "/api/v1/apps/o1/a1/unpublish",
    returns: "void",
  },

  // ── Schedules & alerts ──────────────────────────────────────────────────
  {
    name: "policies.create",
    call: (px) =>
      px.policies.create("o1", "c", { triggerConfig: { cron_expression: "0 3 * * *" } }),
    method: "POST",
    path: "/api/v1/schedules/o1/policies",
    body: {
      concept_name: "c",
      trigger_type: "cron",
      trigger_config: { cron_expression: "0 3 * * *" },
      enabled: true,
    },
  },
  {
    name: "policies.create (data change)",
    call: (px) =>
      px.policies.create("o1", "c", {
        triggerType: "data_change",
        triggerConfig: { check_interval_minutes: 15 },
        enabled: false,
      }),
    method: "POST",
    path: "/api/v1/schedules/o1/policies",
    body: {
      concept_name: "c",
      trigger_type: "data_change",
      trigger_config: { check_interval_minutes: 15 },
      enabled: false,
    },
  },
  {
    name: "policies.list",
    call: (px) => px.policies.list("o1", "c"),
    method: "GET",
    path: "/api/v1/schedules/o1/policies",
    query: { concept_name: "c" },
  },
  {
    name: "policies.get",
    call: (px) => px.policies.get("o1", "p1"),
    method: "GET",
    path: "/api/v1/schedules/o1/policies/p1",
  },
  {
    name: "policies.update",
    call: (px) => px.policies.update("o1", "p1", { enabled: false }),
    method: "PATCH",
    path: "/api/v1/schedules/o1/policies/p1",
    body: { enabled: false },
  },
  {
    name: "policies.delete",
    call: (px) => px.policies.delete("o1", "p1"),
    method: "DELETE",
    path: "/api/v1/schedules/o1/policies/p1",
    returns: "void",
  },
  {
    name: "policies.trigger",
    call: (px) => px.policies.trigger("o1", "p1"),
    method: "POST",
    path: "/api/v1/schedules/o1/policies/p1/trigger",
  },
  {
    name: "policies.runs",
    call: (px) => px.policies.runs("o1", "p1", { limit: 10, offset: 20 }),
    method: "GET",
    path: "/api/v1/schedules/o1/policies/p1/runs",
    query: { limit: "10", offset: "20" },
  },
  {
    name: "alerts.history",
    call: (px) => px.alerts.history(),
    method: "GET",
    path: "/api/v1/alerts/history",
    query: { limit: "100", offset: "0" },
  },
  {
    name: "alerts.reprocess",
    call: (px) => px.alerts.reprocess("al1", { compute }),
    method: "POST",
    path: "/api/v1/alerts/al1/reprocess",
    body: { compute },
  },

  // ── Compute & machines (raw responses) ──────────────────────────────────
  {
    name: "compute.checkAvailability",
    call: (px) => px.compute.checkAvailability({ machineConfigs: [{ id: "m1" }] }),
    method: "POST",
    path: "/api/v1/compute/availability",
    body: { compute: { machine_configs: [{ id: "m1" }] } },
    returns: "raw",
  },
  {
    name: "machines.list",
    call: (px) => px.machines.list(),
    method: "GET",
    path: "/api/v1/machines/machines-combined",
    returns: "raw",
  },
  {
    name: "machines.use",
    call: (px) => px.machines.use("m1", "Mine"),
    method: "POST",
    path: "/api/v1/machines/user-machines/use",
    body: { machine_id: "m1", machine_name: "Mine" },
    returns: "raw",
  },
  {
    name: "machines.setActive",
    call: (px) => px.machines.setActive("um1", true, { autoterminationMinutes: 30 }),
    method: "PATCH",
    path: "/api/v1/machines/user-machines/toggle-active",
    body: { user_machine_id: "um1", is_active: true, autotermination_minutes: 30 },
    returns: "raw",
  },
  {
    name: "machines.status",
    call: (px) => px.machines.status("um1"),
    method: "GET",
    path: "/api/v1/machines/user-machines/um1/status",
    returns: "raw",
  },
  {
    name: "machines.delete",
    call: (px) => px.machines.delete("um1"),
    method: "DELETE",
    path: "/api/v1/machines/user-machines/um1",
    returns: "raw",
  },

  // ── Users & tokens ──────────────────────────────────────────────────────
  {
    name: "users.getRole",
    call: (px) => px.users.getRole(),
    method: "GET",
    path: "/api/v1/users/get-role",
  },
  {
    name: "users.loginActivity",
    call: (px) => px.users.loginActivity(),
    method: "GET",
    path: "/api/v1/users/login-activity",
  },
  {
    name: "users.listLlmModels",
    call: (px) => px.users.listLlmModels("openai", { api_key: "sk-test" }),
    method: "POST",
    path: "/api/v1/users/llm-models",
    body: { provider: "openai", api_key: "sk-test" },
  },
  {
    name: "users.usageStatus",
    call: (px) => px.users.usageStatus(),
    method: "GET",
    path: "/api/v1/users/usage-status",
  },
  {
    name: "tokens.issue",
    call: (px) => px.tokens.issue({ name: "ci", expiresInMinutes: 60 }),
    method: "POST",
    path: "/api/v1/auth/issue-token",
    body: { name: "ci", expires_in_minutes: 60 },
  },
  {
    name: "tokens.list",
    call: (px) => px.tokens.list(),
    method: "GET",
    path: "/api/v1/auth/tokens",
  },
  {
    name: "tokens.revoke",
    call: (px) => px.tokens.revoke("jti/1"),
    method: "POST",
    path: "/api/v1/auth/revoke/jti%2F1",
  },
  {
    name: "tokens.revokeCurrent",
    call: (px) => px.tokens.revokeCurrent(),
    method: "POST",
    path: "/api/v1/auth/revoke",
  },
  {
    name: "tokens.revokeAll",
    call: (px) => px.tokens.revokeAll(),
    method: "POST",
    path: "/api/v1/auth/revoke-all",
  },

  // ── Vadalog & Vadalingo ─────────────────────────────────────────────────
  {
    name: "vadalog.analyze",
    call: (px) => px.vadalog.analyze("a(X) :- b(X)."),
    method: "POST",
    path: "/api/v1/vadalog/analyze",
    body: { program: "a(X) :- b(X).", conceptType: "logic", conceptName: "" },
  },
  {
    name: "vadalog.buildBind",
    call: (px) => px.vadalog.buildBind('@bind("x", ...).', "y", { isOutput: true }),
    method: "POST",
    path: "/api/v1/vadalog/build-bind",
    body: { bindAnnotation: '@bind("x", ...).', predicateName: "y", isOutput: true },
  },
  {
    name: "vadalog.parseBinds",
    call: (px) => px.vadalog.parseBinds("a(1).", "a"),
    method: "POST",
    path: "/api/v1/vadalog/parse-binds",
    body: { program: "a(1).", outputPredicate: "a" },
  },
  {
    name: "vadalog.evaluate",
    call: (px) => px.vadalog.evaluate("a(1).", { params: { x: 1 }, compute }),
    method: "POST",
    path: "/api/v1/vadalog/evaluate",
    body: { program: "a(1).", params: { x: 1 }, compute },
  },
  {
    name: "vadalog.validate",
    call: (px) =>
      px.vadalog.validate("a(1).", {
        conceptType: "logic",
        conceptName: "a",
        ontologyId: "o1",
        conceptConfig: { k: 1 },
      }),
    method: "POST",
    path: "/api/v1/vadalog/validate",
    body: {
      definition: "a(1).",
      concept_type: "logic",
      concept_name: "a",
      project_id: "o1",
      concept_config: { k: 1 },
    },
  },
  {
    name: "vadalingo.sqlToVadalog",
    call: (px) => px.vadalingo.sqlToVadalog("o1", "SELECT 1"),
    method: "POST",
    path: "/api/v1/vadalingo/o1/translate/sql-to-vadalog",
    body: { sql_data: "SELECT 1" },
  },
  {
    name: "vadalingo.rdfToVadalog",
    call: (px) => px.vadalingo.rdfToVadalog("o1", "<rdf/>"),
    method: "POST",
    path: "/api/v1/vadalingo/o1/translate/rdf-to-vadalog",
    body: { rdf_data: "<rdf/>" },
  },
  {
    name: "vadalingo.owlToVadalog",
    call: (px) =>
      px.vadalingo.owlToVadalog("o1", "<owl/>", "http://ex.org#", {
        dataBasePath: "disk/data",
        options: { strict: true },
        addConcepts: true,
      }),
    method: "POST",
    path: "/api/v1/vadalingo/o1/translate/owl-to-vadalog",
    body: {
      owl_content: "<owl/>",
      base_namespace: "http://ex.org#",
      add_concepts: true,
      data_base_path: "disk/data",
      options: { strict: true },
    },
  },
];

/** Methods whose request shape is covered by dedicated tests elsewhere. */
const COVERED_ELSEWHERE: Record<string, string> = {
  "ontologies.save": "client.test.ts — returns the id, legacy key",
  "ontologies.createFromContext": "this file — multipart",
  "files.upload": "client.test.ts — multipart",
  "files.download": "streaming.test.ts — downloads",
  "concepts.download": "this file — download query",
  "concepts.runStream": "streaming.test.ts — WebSocket",
  "agent.chat": "streaming.test.ts — NDJSON",
  "context.autoSeed": "this file — NDJSON request",
  "users.loadConfig": "this file — no status check",
  "users.saveConfig": "this file — no status check",
};

const BASE_PATH = "/jarvispy/org/user";
const SUCCESS = { status: "success", message: "done", data: { marker: 1 } };

describe.each(cases)("$name", (c) => {
  it(`sends ${c.method} ${c.path}`, async () => {
    const { px, calls } = mockClient([() => json(SUCCESS)]);
    const result = await c.call(px);

    expect(calls).toHaveLength(1);
    const req = calls[0];
    expect(req?.method).toBe(c.method);
    expect(req?.url.pathname).toBe(`${BASE_PATH}${c.path}`);
    expect(Object.fromEntries(req?.url.searchParams ?? [])).toEqual(c.query ?? {});
    expect(req?.body).toEqual(c.body);
    expect(req?.headers.get("authorization")).toBe("Bearer test-token");
    if (c.body !== undefined) expect(req?.headers.get("content-type")).toBe("application/json");

    const expected = { data: SUCCESS.data, void: undefined, message: "done", raw: SUCCESS }[
      c.returns ?? "data"
    ];
    expect(result).toEqual(expected);
  });

  if (c.returns === "raw") {
    it("returns a failed envelope instead of throwing", async () => {
      const failed = { status: "error", message: "unavailable" };
      const { px } = mockClient([() => json(failed)]);
      await expect(c.call(px)).resolves.toEqual(failed);
    });
  } else {
    it("throws OperationFailedError when the envelope reports a failure", async () => {
      const { px } = mockClient([() => json({ status: "error", message: "nope", data: null })]);
      const error = await c.call(px).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(OperationFailedError);
      expect((error as OperationFailedError).message).toMatch(/failed: nope$/);
    });
  }
});

describe("requests that are not plain JSON", () => {
  it("ontologies.createFromContext sends multipart with JSON-encoded concept names", async () => {
    const { px, calls } = mockClient([() => json(SUCCESS)]);
    await px.ontologies.createFromContext({
      context: "Airline operations",
      conceptNames: ["flight", "delay"],
      files: [new File(["notes"], "notes.txt"), new Uint8Array([1, 2, 3])],
    });
    const req = calls[0];
    expect(req?.url.pathname).toBe(`${BASE_PATH}/api/v1/ontologies/create-from-context`);
    const form = req?.body as FormData;
    expect(form.get("context")).toBe("Airline operations");
    expect(form.get("concept_names")).toBe('["flight","delay"]');
    const files = form.getAll("files") as File[];
    expect(files.map((f) => f.name)).toEqual(["notes.txt", "upload"]);
    expect(await files[0]?.text()).toBe("notes");
  });

  it("ontologies.createFromContext sends an empty list when no names are given", async () => {
    const { px, calls } = mockClient([() => json(SUCCESS)]);
    await px.ontologies.createFromContext({ context: "x" });
    const form = calls[0]?.body as FormData;
    expect(form.get("concept_names")).toBe("[]");
    expect(form.getAll("files")).toEqual([]);
  });

  it("concepts.download exports CSV through the query string", async () => {
    const { px, calls } = mockClient([() => new Response("a\n1\n")]);
    const file = await px.concepts.download("o1", { exportCsv: true, conceptName: "c" });
    expect(calls[0]?.url.pathname).toBe(`${BASE_PATH}/api/v1/concepts/o1/download`);
    expect(Object.fromEntries(calls[0]?.url.searchParams ?? [])).toEqual({
      export_csv: "true",
      concept_name: "c",
      path: "",
    });
    expect(await file.text()).toBe("a\n1\n");
  });

  it("concepts.download fetches a project file by path", async () => {
    const { px, calls } = mockClient([() => new Response("x")]);
    const file = await px.concepts.download("o1", { path: "out/report.csv" });
    expect(Object.fromEntries(calls[0]?.url.searchParams ?? [])).toEqual({
      path: "out/report.csv",
    });
    expect(file.filename).toBe("report.csv");
  });

  it("context.autoSeed posts its scope and streams events", async () => {
    const { px, calls } = mockClient([
      () => new Response('{"type":"progress","data":1}\n{"type":"done"}\n'),
    ]);
    const events = [];
    for await (const event of px.context.autoSeed({ scopeId: "o1", datasourceIds: ["d1"] })) {
      events.push(event);
    }
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url.pathname).toBe(`${BASE_PATH}/api/v1/knowledge/auto-seed`);
    expect(calls[0]?.body).toEqual({ scope: "project", scope_id: "o1", datasource_ids: ["d1"] });
    expect(events).toEqual([{ type: "progress", data: 1 }, { type: "done" }]);
  });

  it("agent.chat asks for NDJSON", async () => {
    const { px, calls } = mockClient([() => new Response("")]);
    for await (const _ of px.agent.chat("o1", "hi", { model: "m", attachmentPaths: ["disk/a"] })) {
      // drain
    }
    expect(calls[0]?.headers.get("accept")).toBe("application/x-ndjson");
    expect(calls[0]?.body).toEqual({ message: "hi", model: "m", attachment_paths: ["disk/a"] });
  });

  it("users.loadConfig returns data without checking status, and {} when absent", async () => {
    const { px } = mockClient([
      () => json({ status: "whatever", data: { a: 1 } }),
      () => json({ status: "success" }),
    ]);
    await expect(px.users.loadConfig()).resolves.toEqual({ a: 1 });
    await expect(px.users.loadConfig()).resolves.toEqual({});
  });

  it("users.saveConfig posts config_data and returns the message without checking status", async () => {
    const { px, calls } = mockClient([
      () => json({ status: "success", message: "saved" }),
      () => json({ status: "error", message: "ignored like the Python SDK" }),
      () => json({ status: "success" }),
    ]);
    await expect(px.users.saveConfig({ theme: "dark" })).resolves.toBe("saved");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url.pathname).toBe(`${BASE_PATH}/api/v1/users/save-config`);
    expect(calls[0]?.body).toEqual({ config_data: { theme: "dark" } });
    await expect(px.users.saveConfig({})).resolves.toBe("ignored like the Python SDK");
    await expect(px.users.saveConfig({})).resolves.toBe("Configuration saved successfully");
  });
});

describe("argument validation (no request is sent)", () => {
  it.each([
    ["ontologies.import({})", (px: Prometheux) => px.ontologies.import({})],
    ["workspace.import({})", (px: Prometheux) => px.workspace.import({})],
    ["datasources.delete([])", (px: Prometheux) => px.datasources.delete([])],
    ["concepts.delete(id, [])", (px: Prometheux) => px.concepts.delete("o1", [])],
    ["compute.checkAvailability({})", (px: Prometheux) => px.compute.checkAvailability({})],
  ])("%s", async (_, call) => {
    const { px, fetch } = mockClient([() => json(SUCCESS)]);
    await expect(Promise.resolve().then(() => call(px))).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("completeness", () => {
  it("every public SDK method has a wire-format test", () => {
    const { px } = mockClient([() => json(SUCCESS)]);
    const tested = new Set([
      ...cases.map((c) => c.name.replace(/ \(.*\)$/, "")),
      ...Object.keys(COVERED_ELSEWHERE),
    ]);
    const missing = publicMethods(px).filter((name) => !tested.has(name));
    expect(missing).toEqual([]);
  });
});

/** `resource.method` for every public method reachable from the client (one level of nesting). */
function publicMethods(px: Prometheux): string[] {
  const names: string[] = [];
  const visit = (prefix: string, resource: object) => {
    for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(resource))) {
      if (key === "constructor") continue;
      names.push(`${prefix}.${key}`);
    }
    for (const [key, value] of Object.entries(resource)) {
      if (key !== "http" && value && typeof value === "object" && "http" in value) {
        visit(`${prefix}.${key}`, value);
      }
    }
  };
  for (const [key, value] of Object.entries(px)) {
    if (key !== "http" && value && typeof value === "object") visit(key, value);
  }
  return names.sort();
}
