import { APIResource, seg } from "../core/resource.ts";
import type { Compute, JsonObject, JsonValue, RequestOptions } from "../core/types.ts";

/** Which columns of an edge predicate hold the source, target and (optionally) weight. */
export interface ColumnRoles {
  source: number;
  target: number;
  edge_value?: number;
}

export interface BuildGraphParams {
  /** Default 1. */
  page?: number;
  /** Default 0 (server decides). */
  pageSize?: number;
  orderBy?: string;
  /** Default `"records"`. */
  paginationMode?: string;
  /** Default 50. */
  maxDepth?: number;
  sourceNode?: string;
  targetNode?: string;
  recompute?: boolean;
  compute?: Compute;
}

/** Lineage views and graph analytics over concept output. */
export class Graphs extends APIResource {
  /** Concept-level lineage: nodes plus transitive dependency edges. */
  conceptLineage(ontologyId: string, options?: RequestOptions): Promise<unknown> {
    return this.http.call(
      "Concept lineage",
      "POST",
      `/api/v1/kgs/${seg(ontologyId)}/visualize-concept-lineage`,
      { body: {} },
      options,
    );
  }

  /** Builds a graph visualisation from an edge predicate's facts. */
  build(
    ontologyId: string,
    outputPredicate: string,
    columnRoles: ColumnRoles,
    params: BuildGraphParams = {},
    options?: RequestOptions,
  ): Promise<unknown> {
    const body: Record<string, unknown> = { column_roles: columnRoles };
    if (params.compute) body.compute = params.compute;
    return this.http.call(
      "Graph build",
      "POST",
      `/api/v1/kgs/${seg(ontologyId)}/build-graph/${seg(outputPredicate)}`,
      {
        body,
        query: {
          page: params.page ?? 1,
          page_size: params.pageSize ?? 0,
          pagination_mode: params.paginationMode ?? "records",
          max_depth: params.maxDepth ?? 50,
          recompute: params.recompute ?? false,
          order_by: params.orderBy || undefined,
          source_node: params.sourceNode,
          target_node: params.targetNode,
        },
      },
      options,
    );
  }

  /** The available analytics functions and their parameter schemas. */
  listFunctions(options?: RequestOptions): Promise<unknown> {
    return this.http.call("Graph functions", "GET", "/api/v1/kgs/graph-functions", {}, options);
  }

  /** Runs an analytics function (e.g. `pagerank`, `cc`, `dc`, `paths`) over an edge predicate. */
  runAnalytics(
    ontologyId: string,
    outputPredicate: string,
    columnRoles: ColumnRoles,
    fn: string,
    params: { functionParams?: JsonObject; compute?: Compute } = {},
    options?: RequestOptions,
  ): Promise<unknown> {
    const body: Record<string, unknown> = { column_roles: columnRoles, function: fn };
    if (params.functionParams !== undefined) body.function_params = params.functionParams;
    if (params.compute) body.compute = params.compute;
    return this.http.call(
      "Graph analytics",
      "POST",
      `/api/v1/kgs/${seg(ontologyId)}/graph-analytics/${seg(outputPredicate)}`,
      { body },
      options,
    );
  }
}

export type SchemaElementType = "node" | "edge";

/** The ontology schema editor: node/edge roles, lineage edits and OWL import. */
export class OntologySchema extends APIResource {
  save(ontologyId: string, schema: JsonValue, options?: RequestOptions): Promise<unknown> {
    return this.http.call(
      "Ontology schema save",
      "POST",
      `/api/v1/concepts/${seg(ontologyId)}/save-ontology-schema`,
      { body: { ontology_schema_data: schema } },
      options,
    );
  }

  /** The saved schema, or `null` when none is set. */
  load(ontologyId: string, options?: RequestOptions): Promise<JsonValue | null> {
    return this.http.call(
      "Ontology schema load",
      "GET",
      `/api/v1/concepts/${seg(ontologyId)}/load-ontology-schema`,
      {},
      options,
    );
  }

  /** Marks a concept as a schema node, an edge (with endpoints), or resets it (`type: null`). */
  setConceptType(
    ontologyId: string,
    conceptName: string,
    params: { type: SchemaElementType | null; edgeSource?: string; edgeTarget?: string },
    options?: RequestOptions,
  ): Promise<unknown> {
    const body: Record<string, unknown> = { ontology_schema_type: params.type };
    if (params.edgeSource !== undefined) body.edge_source = params.edgeSource;
    if (params.edgeTarget !== undefined) body.edge_target = params.edgeTarget;
    return this.http.call(
      "Ontology schema set concept type",
      "PATCH",
      `/api/v1/concepts/${seg(ontologyId)}/concepts/${seg(conceptName)}/ontology-schema-type`,
      { body },
      options,
    );
  }

  /** Adds one schema node or edge to the lineage. */
  addToLineage(
    ontologyId: string,
    elementType: SchemaElementType,
    elementData: JsonObject,
    allNodes: JsonValue[] = [],
    options?: RequestOptions,
  ): Promise<unknown> {
    return this.http.call(
      "Ontology schema add to lineage",
      "POST",
      `/api/v1/concepts/${seg(ontologyId)}/add-to-lineage`,
      { body: { element_type: elementType, element_data: elementData, all_nodes: allNodes } },
      options,
    );
  }

  /** Converts an OWL document into the schema editor's format. */
  importOwl(
    ontologyId: string,
    owlContent: string,
    baseNamespace?: string,
    options?: RequestOptions,
  ): Promise<unknown> {
    const body: Record<string, unknown> = { owl_content: owlContent };
    if (baseNamespace !== undefined) body.base_namespace = baseNamespace;
    return this.http.call(
      "Ontology schema import OWL",
      "POST",
      `/api/v1/concepts/${seg(ontologyId)}/import-owl`,
      { body },
      options,
    );
  }
}
