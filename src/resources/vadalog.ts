import { APIResource, seg } from "../core/resource.ts";
import type { Compute, JsonObject, RequestOptions } from "../core/types.ts";
import type { ConceptType } from "./concepts.ts";

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

  /** Evaluates a program directly, without saving it as a concept. */
  evaluate(
    program: string,
    params: { params?: JsonObject; compute?: Compute } = {},
    options?: RequestOptions,
  ): Promise<unknown> {
    const body: Record<string, unknown> = { program, params: params.params ?? {} };
    if (params.compute) body.compute = params.compute;
    return this.http.call(
      "Vadalog evaluate",
      "POST",
      "/api/v1/vadalog/evaluate",
      { body },
      options,
    );
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
