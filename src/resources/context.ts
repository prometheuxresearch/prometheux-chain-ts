import { unwrapMessage } from "../core/http.ts";
import { APIResource, seg } from "../core/resource.ts";
import type { JsonValue, Loose, RequestOptions } from "../core/types.ts";

/** `"project"` is accepted as a legacy alias for `"ontology"`. */
export type ContextScope = "global" | "ontology" | "project";
export type ContextKind = "preference" | "fact" | "document_chunk" | "observation";
/** `always` and `on_demand` make a note a standing rule; `retrieved` notes surface by relevance. */
export type ContextActivation = "retrieved" | "always" | "on_demand";
export type ContextSource = "user" | "agent_writer" | "import";

export type ContextNote = Loose<{
  id: string;
  scope: "global" | "ontology";
  scope_id: string | null;
  kind: ContextKind;
  text: string;
  source: ContextSource;
  pinned: boolean;
  created_at: string | null;
  last_used_at: string | null;
  use_count: number;
  superseded_by: string | null;
  source_meta: Record<string, unknown> | null;
  activation: ContextActivation;
  title: string | null;
  folder_path: string | null;
}>;

export interface ListContextParams {
  /** The ontology id, for ontology-scoped notes. */
  scopeId?: string;
  kinds?: ContextKind[];
}

export interface CreateContextNoteParams {
  scope: ContextScope;
  kind: ContextKind;
  text: string;
  scopeId?: string;
  /** Default `"user"`. */
  source?: ContextSource;
  pinned?: boolean;
  /** Id(s) of older notes this one replaces; they stop being used. */
  supersedes?: string | string[];
  /** Default `"retrieved"`. */
  activation?: ContextActivation;
  title?: string;
  folderPath?: string;
}

/**
 * Fields left `undefined` are not changed. Pass `scopeId: null` (or
 * `folderPath: null`) to clear the value.
 */
export interface UpdateContextNoteParams {
  text?: string;
  kind?: ContextKind;
  pinned?: boolean;
  scope?: ContextScope;
  scopeId?: string | null;
  activation?: ContextActivation;
  title?: string;
  folderPath?: string | null;
}

export interface CreateContextEdgeParams {
  srcType: string;
  srcId: string;
  dstType: string;
  dstId: string;
  /** Default `"relates_to"`. */
  relation?: string;
  /** Default `"user"`. */
  createdBy?: string;
}

export interface SearchContextParams extends ListContextParams {
  scope: ContextScope;
  /** Default 10. */
  topK?: number;
}

export interface AutoSeedParams {
  /** Default `"project"`. */
  scope?: ContextScope;
  scopeId?: string;
  datasourceIds?: string[];
}

/** Progress events from `autoSeed()`. */
export type AutoSeedEvent = Loose<{ type?: string; data?: unknown }>;

/** The knowledge / context layer: notes, rules, documents and onboarding. */
export class Context extends APIResource {
  list(
    scope: ContextScope,
    params: ListContextParams = {},
    options?: RequestOptions,
  ): Promise<ContextNote[]> {
    return this.http.call(
      "Context note list",
      "GET",
      "/api/v1/knowledge/context",
      { query: { scope, scope_id: params.scopeId, kinds: params.kinds?.join(",") || undefined } },
      options,
    );
  }

  create(params: CreateContextNoteParams, options?: RequestOptions): Promise<ContextNote> {
    const body: Record<string, unknown> = {
      scope: params.scope,
      scope_id: params.scopeId ?? null,
      kind: params.kind,
      text: params.text,
      source: params.source ?? "user",
      pinned: params.pinned ?? false,
      activation: params.activation ?? "retrieved",
    };
    if (params.supersedes !== undefined) body.supersedes = [params.supersedes].flat();
    if (params.title !== undefined) body.title = params.title;
    if (params.folderPath !== undefined) body.folder_path = params.folderPath;
    return this.http.call(
      "Context note create",
      "POST",
      "/api/v1/knowledge/context",
      { body },
      options,
    );
  }

  /**
   * Ingests an uploaded file as document-chunk notes. `filePath` is the
   * `disk/<name>` path returned by `files.upload()`.
   */
  createFromFile(
    filePath: string,
    params: { scope?: ContextScope; scopeId?: string } = {},
    options?: RequestOptions,
  ): Promise<unknown> {
    const body: Record<string, unknown> = { scope: params.scope ?? "global", file_path: filePath };
    if (params.scopeId !== undefined) body.scope_id = params.scopeId;
    return this.http.call(
      "Context note create from file",
      "POST",
      "/api/v1/knowledge/context/from-file",
      { body },
      options,
    );
  }

  get(noteId: string, options?: RequestOptions): Promise<ContextNote> {
    return this.http.call(
      "Context note get",
      "GET",
      `/api/v1/knowledge/context/${seg(noteId)}`,
      {},
      options,
    );
  }

  update(
    noteId: string,
    params: UpdateContextNoteParams,
    options?: RequestOptions,
  ): Promise<ContextNote> {
    const body: Record<string, unknown> = {
      text: params.text ?? null,
      kind: params.kind ?? null,
      pinned: params.pinned ?? null,
    };
    if (params.scope !== undefined) body.scope = params.scope;
    if (params.scopeId !== undefined) body.scope_id = params.scopeId;
    if (params.activation !== undefined) body.activation = params.activation;
    if (params.title !== undefined) body.title = params.title;
    if (params.folderPath !== undefined) body.folder_path = params.folderPath;
    return this.http.call(
      "Context note update",
      "PATCH",
      `/api/v1/knowledge/context/${seg(noteId)}`,
      { body },
      options,
    );
  }

  async delete(noteId: string, options?: RequestOptions): Promise<void> {
    const envelope = await this.http.request(
      "DELETE",
      `/api/v1/knowledge/context/${seg(noteId)}`,
      {},
      options,
    );
    unwrapMessage("Context note delete", envelope);
  }

  /** Links two context-layer entities. Duplicate triples return the existing edge. */
  createEdge(params: CreateContextEdgeParams, options?: RequestOptions): Promise<unknown> {
    return this.http.call(
      "Context edge create",
      "POST",
      "/api/v1/knowledge/context/edges",
      {
        body: {
          src_type: params.srcType,
          src_id: params.srcId,
          dst_type: params.dstType,
          dst_id: params.dstId,
          relation: params.relation ?? "relates_to",
          created_by: params.createdBy ?? "user",
        },
      },
      options,
    );
  }

  /** Semantic search over context notes, most relevant first. */
  search(
    query: string,
    params: SearchContextParams,
    options?: RequestOptions,
  ): Promise<ContextNote[]> {
    return this.http.call(
      "Context note search",
      "POST",
      "/api/v1/knowledge/context/search",
      {
        body: { query },
        query: {
          scope: params.scope,
          top_k: params.topK ?? 10,
          scope_id: params.scopeId,
          kinds: params.kinds?.join(",") || undefined,
        },
      },
      options,
    );
  }

  /** Profiles connected data sources and writes observation notes, streaming progress. */
  autoSeed(
    params: AutoSeedParams = {},
    options?: RequestOptions,
  ): AsyncGenerator<AutoSeedEvent, void, undefined> {
    const body: Record<string, unknown> = { scope: params.scope ?? "project" };
    if (params.scopeId !== undefined) body.scope_id = params.scopeId;
    if (params.datasourceIds !== undefined) body.datasource_ids = params.datasourceIds;
    return this.http.stream<AutoSeedEvent>(
      "POST",
      "/api/v1/knowledge/auto-seed",
      { body },
      options,
    );
  }

  /** The onboarding interview questions for a scope. */
  interviewTemplate(scope: ContextScope = "global", options?: RequestOptions): Promise<unknown> {
    return this.http.call(
      "Interview template",
      "GET",
      "/api/v1/knowledge/interview/template",
      { query: { scope } },
      options,
    );
  }

  /** Saves completed interview answers as context notes. */
  submitInterview(
    scope: ContextScope,
    answers: JsonValue,
    scopeId?: string,
    options?: RequestOptions,
  ): Promise<unknown> {
    const body: Record<string, unknown> = { scope, answers };
    if (scopeId !== undefined) body.scope_id = scopeId;
    return this.http.call(
      "Interview submit",
      "POST",
      "/api/v1/knowledge/interview",
      { body },
      options,
    );
  }

  /** Whether the workspace looks empty enough to warrant onboarding. */
  onboardingStatus(options?: RequestOptions): Promise<unknown> {
    return this.http.call(
      "Onboarding status",
      "GET",
      "/api/v1/knowledge/onboarding-status",
      {},
      options,
    );
  }

  /** The Document view of an ontology: summary plus rendered Vadalog. */
  ontologyText(
    ontologyId: string,
    params: { refresh?: boolean } = {},
    options?: RequestOptions,
  ): Promise<unknown> {
    return this.http.call(
      "Ontology text",
      "GET",
      `/api/v1/knowledge/ontology/${seg(ontologyId)}/text`,
      { query: { refresh: params.refresh ?? false } },
      options,
    );
  }
}
