import { APITimeoutError } from "../core/errors.ts";
import { APIResource, seg } from "../core/resource.ts";
import type { Compute, Envelope, JsonObject, Loose, RequestOptions } from "../core/types.ts";
import type { ConceptType } from "./concepts.ts";

/** How long `evaluate` waits for the engine to acknowledge a stop. */
const STOP_TIMEOUT = 10_000;

export interface EvaluateParams {
  /** Values for the program's `@param` declarations, pasted in as Vadalog text. */
  params?: JsonObject;
  compute?: Compute;
  /**
   * Tags the evaluation so `vadalog.stop(executionId)` stops it and nothing
   * else. Default: a random UUID. 1 to 128 characters.
   */
  executionId?: string;
}

export type EngineStatus = Loose<{
  status: "ready" | "busy" | (string & {});
  runs_in_flight?: number;
  engine_calls_in_flight?: number;
  timestamp?: string;
}>;

export interface ProgramParams {
  /** Default `"logic"`. */
  conceptType?: ConceptType;
  conceptName?: string;
}

export interface AnalyzeResult {
  inputPredicates: string[];
  headPredicates: string[];
  headPredicateTerms: Record<string, string[]>;
  unresolvedReferences?: string[];
}

export interface ValidateResult {
  valid: boolean;
  concept_type: ConceptType;
  error?: string;
}

/** Static analysis and direct evaluation of Vadalog programs. */
export class Vadalog extends APIResource {
  /** Returns a program's input and head predicates. */
  analyze(
    program: string,
    params: ProgramParams = {},
    options?: RequestOptions,
  ): Promise<AnalyzeResult> {
    return this.http.call(
      "Vadalog analyze",
      "POST",
      "/api/v1/vadalog/analyze",
      {
        body: {
          program,
          conceptType: params.conceptType ?? "logic",
          conceptName: params.conceptName ?? "",
        },
      },
      options,
    );
  }

  /** Builds a bind annotation by swapping the predicate name in an existing one. */
  buildBind(
    bindAnnotation: string,
    predicateName: string,
    params: { isOutput?: boolean } = {},
    options?: RequestOptions,
  ): Promise<unknown> {
    return this.http.call(
      "Vadalog build bind",
      "POST",
      "/api/v1/vadalog/build-bind",
      { body: { bindAnnotation, predicateName, isOutput: params.isOutput ?? false } },
      options,
    );
  }

  /** Splits a program into code plus its input / output binds. */
  parseBinds(program: string, outputPredicate = "", options?: RequestOptions): Promise<unknown> {
    return this.http.call(
      "Vadalog parse binds",
      "POST",
      "/api/v1/vadalog/parse-binds",
      { body: { program, outputPredicate } },
      options,
    );
  }

  /**
   * Evaluates a program directly, without saving it as a concept.
   *
   * The evaluation is tagged with `executionId` (a random UUID unless you pass
   * one). If the request times out or `options.signal` aborts it, the SDK stops
   * that evaluation on the engine before throwing, so it does not keep the
   * engine busy for the calls that follow.
   */
  async evaluate(
    program: string,
    params: EvaluateParams = {},
    options?: RequestOptions,
  ): Promise<unknown> {
    const executionId = params.executionId ?? globalThis.crypto.randomUUID();
    const body: Record<string, unknown> = {
      program,
      params: params.params ?? {},
      execution_id: executionId,
    };
    if (params.compute) body.compute = params.compute;
    try {
      return await this.http.call(
        "Vadalog evaluate",
        "POST",
        "/api/v1/vadalog/evaluate",
        { body },
        options,
      );
    } catch (error) {
      if (error instanceof APITimeoutError || options?.signal?.aborted) {
        await this.stop(executionId, { timeout: STOP_TIMEOUT }).catch(() => {});
      }
      throw error;
    }
  }

  /**
   * Stops a running evaluation. With `executionId`, only the evaluation sent
   * with that id is stopped; without it, every evaluation on your engine is.
   * Resolves to the server's reply as is: stopping when nothing is running is
   * not an error.
   */
  stop(executionId?: string, options?: RequestOptions): Promise<Envelope> {
    return this.http.request(
      "GET",
      "/api/v1/vadalog/stop",
      { query: { execution_id: executionId } },
      options,
    );
  }

  /** Whether your engine is idle (`"ready"`) or evaluating (`"busy"`). */
  status(options?: RequestOptions): Promise<EngineStatus> {
    return this.http.call("Vadalog status", "GET", "/api/v1/vadalog/status", {}, options);
  }

  /**
   * Validates a concept body without saving it. An invalid body resolves to
   * `{ valid: false, error }`; it does not throw.
   */
  validate(
    definition: string,
    params: ProgramParams & { ontologyId?: string; conceptConfig?: JsonObject } = {},
    options?: RequestOptions,
  ): Promise<ValidateResult> {
    const body: Record<string, unknown> = {
      definition,
      concept_type: params.conceptType ?? "logic",
      concept_name: params.conceptName ?? "",
    };
    if (params.ontologyId !== undefined) body.project_id = params.ontologyId;
    if (params.conceptConfig !== undefined) body.concept_config = params.conceptConfig;
    return this.http.call(
      "Vadalog validate",
      "POST",
      "/api/v1/vadalog/validate",
      { body },
      options,
    );
  }
}

export interface OwlToVadalogParams {
  dataBasePath?: string;
  options?: JsonObject;
  /** Also create the translated concepts in the ontology. */
  addConcepts?: boolean;
}

/** Translation of SQL, RDF and OWL into Vadalog. */
export class Vadalingo extends APIResource {
  sqlToVadalog(ontologyId: string, sql: string, options?: RequestOptions): Promise<unknown> {
    return this.http.call(
      "Vadalingo translate SQL",
      "POST",
      `/api/v1/vadalingo/${seg(ontologyId)}/translate/sql-to-vadalog`,
      { body: { sql_data: sql } },
      options,
    );
  }

  rdfToVadalog(ontologyId: string, rdf: string, options?: RequestOptions): Promise<unknown> {
    return this.http.call(
      "Vadalingo translate RDF",
      "POST",
      `/api/v1/vadalingo/${seg(ontologyId)}/translate/rdf-to-vadalog`,
      { body: { rdf_data: rdf } },
      options,
    );
  }

  owlToVadalog(
    ontologyId: string,
    owlContent: string,
    baseNamespace: string,
    params: OwlToVadalogParams = {},
    options?: RequestOptions,
  ): Promise<unknown> {
    const body: Record<string, unknown> = {
      owl_content: owlContent,
      base_namespace: baseNamespace,
      add_concepts: params.addConcepts ?? false,
    };
    if (params.dataBasePath !== undefined) body.data_base_path = params.dataBasePath;
    if (params.options !== undefined) body.options = params.options;
    return this.http.call(
      "Vadalingo translate OWL",
      "POST",
      `/api/v1/vadalingo/${seg(ontologyId)}/translate/owl-to-vadalog`,
      { body },
      options,
    );
  }
}
