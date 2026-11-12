import type { FileDownload } from "../core/files.ts";
import { APIResource, seg } from "../core/resource.ts";
import type { Compute, JsonObject, JsonValue, Loose, RequestOptions } from "../core/types.ts";

export type ConceptType = "logic" | "sql" | "cypher" | "python" | "context" | "llm" | (string & {});
export type RefreshMode = "default" | "checkpoint" | "always";

/**
 * How much of the dependency chain a run rebuilds.
 * - `single` — reuse every populated dependency; rebuild only what is missing.
 * - `auto` — reuse provably fresh dependencies, rebuild stale ones, honour frozen checkpoints.
 * - `all` — rebuild everything reachable and override checkpoints.
 */
export type RunMode = "single" | "auto" | "all";

export interface BindEntry {
  predicate: string;
  annotation: string;
  predicate_name?: string;
  datasource_type?: string;
  path?: string;
  table_name?: string;
}

export type Concept = Loose<{
  id: string;
  predicate_name: string;
  /** The concept body as authored. */
  concept: string;
  group: string;
  position: number | null;
  description: string | null;
  concept_type: ConceptType;
  refresh_mode: RefreshMode;
  concept_config: JsonObject | null;
  timestamp: string | null;
  author: string | null;
  ontology_schema_type: string;
  /** Column name to type. */
  fields: Record<string, string>;
  column_count: number;
  is_input: boolean;
  row_count: number;
  execution_time_ms: number;
  parsed: { code: string; binds: { input: BindEntry[]; output: BindEntry[] } };
  built?: boolean;
  last_run_at?: string | null;
  params_hash?: string;
  read_only?: boolean;
}>;

export type SaveConceptResult = Loose<{
  id: string;
  description: string | null;
  concept?: string;
  injected_binds?: { predicate: string; annotation: string }[];
  unresolved_references?: string[];
}>;

export type RunResult = Loose<{
  message?: string;
  concept_name: string;
  predicates_populated: string[];
  total_records: number;
  execution_time_ms?: number;
  skipped_execution?: true;
  bind_annotations?: string;
  evaluation_results: {
    /** Predicate name to rows. */
    resultSet: Record<string, JsonValue[][]>;
    columnNames: Record<string, string[]>;
    types?: Record<string, string[]>;
    elapsedTime?: number;
  };
}>;

export interface SaveConceptParams {
  /** The concept body (Vadalog, SQL or Python). */
  definition: string;
  conceptType?: ConceptType;
  conceptName?: string;
  description?: string;
  pythonScripts?: JsonValue;
  binds?: JsonValue;
  outputPredicate?: string;
  /** Previous name, when saving under a new name. */
  existingName?: string;
  position?: number;
  group?: string;
  compute?: Compute;
  forceOverwrite?: boolean;
  conceptConfig?: JsonObject;
}

export interface RunConceptParams {
  params?: JsonObject;
  /** Default `"auto"`. */
  runMode?: RunMode;
  /**
   * Persist outputs so `fetchResults`, `searchResults` and `query` can read them.
   * Defaults to the server's setting (`true`); pass `false` for a throwaway run.
   */
  persistOutputs?: boolean;
  compute?: Compute;
}

export interface FetchResultsParams {
  /** Default 1. */
  page?: number;
  /** Default 10. */
  pageSize?: number;
  orderBy?: string;
  params?: JsonObject;
  compute?: Compute;
  /** Free-text OR across columns. */
  searchTerm?: string;
  /** Operator-based column filters. */
  columnFilters?: JsonValue;
  /** A total row count already known to the caller, to skip recounting. */
  totalCount?: number;
}

export type ConceptResults = Loose<{
  predicate: string;
  results: { facts: JsonValue[][]; columnNames: string[] };
  pagination: {
    page: number;
    page_size: number;
    total_count: number;
    total_pages: number;
    has_next: boolean;
    has_prev: boolean;
    order_by: JsonValue[];
  };
  elapsedTime: number | null;
  message: string;
  search?: {
    search_term: string | null;
    column_filters: JsonValue[] | null;
    or_column_filters: JsonValue[] | null;
  };
  filters?: JsonObject | null;
}>;

export interface LlmAnalysisParams {
  predicateNames?: string[];
  predicateData?: JsonValue;
  params?: JsonObject;
  promptTuning?: string;
  promptTuningName?: string;
  defaultResponse?: string;
  compute?: Compute;
}

export interface DownloadConceptParams {
  /** Project file path to download. */
  path?: string;
  /** Export `conceptName` to CSV and download that instead. */
  exportCsv?: boolean;
  conceptName?: string;
}

export type ConceptStatus =
  | { type: "execution_plan"; order: string[]; total: number }
  | { concept: string; status: "running"; reason?: string }
  | {
      concept: string;
      status: "success";
      row_count?: number | null;
      execution_time_ms?: number | null;
    }
  | { concept: string; status: "error"; error: string }
  | { concept: string; status: "skipped"; reason: string };

/** Events sent over the run-stream WebSocket. Iteration ends after `complete` or `error`. */
export type RunStreamEvent =
  | { event: "concept_status"; data: ConceptStatus }
  | {
      event: "complete";
      /** The same envelope `run()` returns; `status` is `"error"` when the run failed. */
      data: Loose<{
        status: string;
        message?: string;
        data?: RunResult | Loose<{ errorMessage: string }>;
      }>;
    }
  | {
      event: "error";
      data: Loose<{ status: string; message: string; errorCode?: string }>;
    };

export class Concepts extends APIResource {
  /** Creates or updates a concept. Only `definition` is required. */
  save(
    ontologyId: string,
    params: SaveConceptParams,
    options?: RequestOptions,
  ): Promise<SaveConceptResult> {
    const body: Record<string, unknown> = {
      definition: params.definition,
      concept_type: params.conceptType ?? "logic",
    };
    if (params.pythonScripts) body.python_scripts = params.pythonScripts;
    if (params.description) body.description = params.description;
    if (params.conceptName) body.concept_name = params.conceptName;
    if (params.binds) body.binds = params.binds;
    if (params.outputPredicate) body.output_predicate = params.outputPredicate;
    if (params.existingName) body.existing_name = params.existingName;
    if (params.position !== undefined) body.position = params.position;
    if (params.group) body.group = params.group;
    if (params.compute) body.compute = params.compute;
    if (params.forceOverwrite) body.force_overwrite = true;
    if (params.conceptConfig !== undefined) body.concept_config = params.conceptConfig;
    return this.http.call(
      "Concept save",
      "POST",
      `/api/v1/concepts/${seg(ontologyId)}/save`,
      { body },
      options,
    );
  }

  /** Renames a concept and propagates the change to its dependents. */
  rename(
    ontologyId: string,
    oldName: string,
    newName: string,
    options?: RequestOptions,
  ): Promise<unknown> {
    return this.http.call(
      "Concept rename",
      "POST",
      `/api/v1/concepts/${seg(ontologyId)}/rename`,
      { body: { old_name: oldName, new_name: newName } },
      options,
    );
  }

  list(ontologyId: string, options?: RequestOptions): Promise<Concept[]> {
    return this.http.call(
      "Concept list",
      "GET",
      `/api/v1/concepts/${seg(ontologyId)}/list`,
      {},
      options,
    );
  }

  /** Runs a concept and waits for it to finish. */
  run(
    ontologyId: string,
    conceptName: string,
    params: RunConceptParams = {},
    options?: RequestOptions,
  ): Promise<RunResult> {
    return this.http.call(
      "Concept run",
      "POST",
      `/api/v1/concepts/${seg(ontologyId)}/run/${seg(conceptName)}`,
      { body: runBody(params) },
      options,
    );
  }

  /**
   * Runs a concept and streams live status events over a WebSocket.
   *
   * ```ts
   * for await (const event of px.concepts.runStream(id, "location")) {
   *   console.log(event.event, event.data);
   * }
   * ```
   */
  runStream(
    ontologyId: string,
    conceptName: string,
    params: RunConceptParams = {},
    options?: RequestOptions,
  ): AsyncGenerator<RunStreamEvent, void, undefined> {
    return this.http.websocket<RunStreamEvent>(
      `/api/v1/concepts/${seg(ontologyId)}/run-stream/${seg(conceptName)}`,
      runBody(params),
      options,
    );
  }

  /** Deletes the named concepts. Use `deleteAll()` to empty the ontology. */
  delete(ontologyId: string, conceptNames: string[], options?: RequestOptions): Promise<unknown> {
    if (conceptNames.length === 0) {
      throw new TypeError("conceptNames must not be empty; use deleteAll() instead");
    }
    return this.http.call(
      "Concept delete",
      "POST",
      `/api/v1/concepts/${seg(ontologyId)}/cleanup`,
      { body: { concept_names: conceptNames } },
      options,
    );
  }

  /** Deletes every concept in the ontology. */
  deleteAll(ontologyId: string, options?: RequestOptions): Promise<unknown> {
    return this.http.call(
      "Concept delete",
      "POST",
      `/api/v1/concepts/${seg(ontologyId)}/cleanup`,
      { body: {} },
      options,
    );
  }

  reorder(
    ontologyId: string,
    conceptNames: string[],
    group?: string,
    options?: RequestOptions,
  ): Promise<unknown> {
    const body: Record<string, unknown> = { concept_names: conceptNames };
    if (group !== undefined) body.group = group;
    return this.http.call(
      "Concept reorder",
      "POST",
      `/api/v1/concepts/${seg(ontologyId)}/reorder`,
      { body },
      options,
    );
  }

  /** Fetches a page of results for a populated predicate. */
  fetchResults(
    ontologyId: string,
    outputPredicate: string,
    params: FetchResultsParams = {},
    options?: RequestOptions,
  ): Promise<ConceptResults> {
    const body: Record<string, unknown> = {
      page: params.page ?? 1,
      page_size: params.pageSize ?? 10,
    };
    if (params.orderBy) body.order_by = params.orderBy;
    if (params.params) body.params = params.params;
    if (params.compute) body.compute = params.compute;
    if (params.searchTerm !== undefined) body.search_term = params.searchTerm;
    if (params.columnFilters !== undefined) body.column_filters = params.columnFilters;
    if (params.totalCount !== undefined) body.total_count = params.totalCount;
    return this.http.call(
      "Concept fetch",
      "POST",
      `/api/v1/concepts/${seg(ontologyId)}/fetch`,
      { body, query: { output_predicate: outputPredicate } },
      options,
    );
  }

  /** Searches a populated predicate by free text and/or column filters. */
  searchResults(
    ontologyId: string,
    outputPredicate: string,
    params: Omit<FetchResultsParams, "params" | "totalCount"> = {},
    options?: RequestOptions,
  ): Promise<ConceptResults> {
    return this.fetchResults(
      ontologyId,
      outputPredicate,
      { ...params, pageSize: params.pageSize ?? 0 },
      options,
    );
  }

  /** Runs a read-only SQL `SELECT` over one populated concept. */
  query(
    ontologyId: string,
    conceptName: string,
    sql: string,
    params: { compute?: Compute } = {},
    options?: RequestOptions,
  ): Promise<unknown> {
    const body: Record<string, unknown> = { concept_name: conceptName, sql };
    if (params.compute) body.compute = params.compute;
    return this.http.call(
      "Concept query",
      "POST",
      `/api/v1/concepts/${seg(ontologyId)}/query`,
      { body },
      options,
    );
  }

  /** Finds concepts across ontologies that are semantically similar to `query`. */
  searchSimilar(
    query: string,
    params: { topK?: number; excludeOntologyId?: string } = {},
    options?: RequestOptions,
  ): Promise<unknown> {
    return this.http.call(
      "Concept search similar",
      "GET",
      "/api/v1/concepts/search-similar",
      {
        query: {
          query,
          top_k: params.topK ?? 0,
          exclude_project_id: params.excludeOntologyId || undefined,
        },
      },
      options,
    );
  }

  /** Asks an LLM a question grounded in one or more predicate tables. */
  llmAnalysis(
    ontologyId: string,
    question: string,
    params: LlmAnalysisParams = {},
    options?: RequestOptions,
  ): Promise<unknown> {
    const body: Record<string, unknown> = { question };
    if (params.predicateNames !== undefined) body.predicate_names = params.predicateNames;
    if (params.predicateData !== undefined) body.predicate_data = params.predicateData;
    if (params.params !== undefined) body.params = params.params;
    if (params.promptTuning !== undefined) body.prompt_tuning = params.promptTuning;
    if (params.promptTuningName !== undefined) body.prompt_tuning_name = params.promptTuningName;
    if (params.defaultResponse !== undefined) body.default_response = params.defaultResponse;
    if (params.compute) body.compute = params.compute;
    return this.http.call(
      "Concept LLM analysis",
      "POST",
      `/api/v1/concepts/${seg(ontologyId)}/llm`,
      { body },
      options,
    );
  }

  /** Downloads a project file, or exports a concept to CSV and downloads it. */
  download(
    ontologyId: string,
    params: DownloadConceptParams,
    options?: RequestOptions,
  ): Promise<FileDownload> {
    const query = params.exportCsv
      ? { export_csv: "true", concept_name: params.conceptName, path: params.path ?? "" }
      : { path: params.path };
    return this.http.download(`/api/v1/concepts/${seg(ontologyId)}/download`, { query }, options);
  }

  /** Generates (and caches) a natural-language description for a concept. */
  generateDescription(
    ontologyId: string,
    conceptName: string,
    options?: RequestOptions,
  ): Promise<unknown> {
    return this.http.call(
      "Concept generate description",
      "POST",
      `/api/v1/concepts/${seg(ontologyId)}/generate-description`,
      { body: { concept_name: conceptName } },
      options,
    );
  }

  /** Reads a concept's description, regenerating it if stale. */
  getDescription(
    ontologyId: string,
    conceptName: string,
    options?: RequestOptions,
  ): Promise<unknown> {
    return this.http.call(
      "Concept get description",
      "GET",
      `/api/v1/concepts/${seg(ontologyId)}/description`,
      { query: { concept_name: conceptName } },
      options,
    );
  }

  /** The latest concept-run snapshot for one ontology. */
  executionStatus(ontologyId: string, options?: RequestOptions): Promise<unknown> {
    return this.http.call(
      "Concept execution status",
      "GET",
      `/api/v1/concepts/${seg(ontologyId)}/execution-status`,
      {},
      options,
    );
  }

  /** The latest non-idle run for every ontology. */
  executionStatuses(options?: RequestOptions): Promise<unknown> {
    return this.http.call(
      "Concept execution statuses",
      "GET",
      "/api/v1/concepts/execution-statuses",
      {},
      options,
    );
  }
}

function runBody(params: RunConceptParams): Record<string, unknown> {
  const body: Record<string, unknown> = {
    params: params.params ?? {},
    run_mode: params.runMode ?? "auto",
  };
  // Omitted unless set: the server default (true) is what makes results fetchable afterwards.
  if (params.persistOutputs !== undefined) body.persist_outputs = params.persistOutputs;
  if (params.compute) body.compute = params.compute;
  return body;
}
