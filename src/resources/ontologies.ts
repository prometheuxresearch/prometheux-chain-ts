import { toBlob, type Uploadable } from "../core/files.ts";
import { unwrapMessage } from "../core/http.ts";
import { APIResource } from "../core/resource.ts";
import type { Compute, JsonObject, Loose, RequestOptions } from "../core/types.ts";

export type Ontology = Loose<{
  id: string;
  name: string;
  description: string;
  author: string;
  to_persist: boolean;
  created_at: string | null;
  updated_at: string | null;
}>;

export interface SaveOntologyParams {
  /** Omit to create a new ontology; pass an existing id to update it. */
  id?: string;
  name?: string;
  description?: string;
}

export interface CopyOntologyParams {
  newName?: string;
  compute?: Compute;
}

export interface ImportOntologyParams {
  /** Give the imported ontology a fresh id instead of reusing the exported one. */
  forceNewId?: boolean;
  compute?: Compute;
}

export interface CreateFromContextParams {
  /** Free-text description of the domain. */
  context: string;
  conceptNames?: string[];
  /** Attachments, e.g. `await fileFromPath("spec.pdf")`. */
  files?: Uploadable[];
}

export class Ontologies extends APIResource {
  readonly snapshots: Snapshots = new Snapshots(this.http);

  /** Creates (no `id`) or updates an ontology and returns its id. */
  async save(params: SaveOntologyParams, options?: RequestOptions): Promise<string> {
    const project: Record<string, unknown> = { id: params.id ?? null, name: params.name ?? null };
    if (params.description !== undefined) project.description = params.description;
    const data = await this.http.call<{ ontology_id?: string; project_id?: string } | string>(
      "Ontology save",
      "POST",
      "/api/v1/ontologies/save",
      { body: { project } },
      options,
    );
    // Older servers return the id under `project_id`.
    if (data && typeof data === "object") return (data.ontology_id ?? data.project_id) as string;
    return data;
  }

  list(options?: RequestOptions): Promise<Ontology[]> {
    return this.http.call("Ontology list", "GET", "/api/v1/ontologies/list", {}, options);
  }

  /** Loads one ontology; `null` when it does not exist. */
  get(id: string, options?: RequestOptions): Promise<Ontology | null> {
    return this.http.call(
      "Ontology load",
      "GET",
      "/api/v1/ontologies/load",
      { query: { project_id: id } },
      options,
    );
  }

  /** Permanently deletes an ontology and all of its resources. */
  async delete(id: string, options?: RequestOptions): Promise<void> {
    const envelope = await this.http.request(
      "POST",
      "/api/v1/ontologies/cleanup",
      {
        body: { project: { id } },
      },
      options,
    );
    unwrapMessage("Ontology delete", envelope);
  }

  copy(id: string, params: CopyOntologyParams = {}, options?: RequestOptions): Promise<unknown> {
    const body: Record<string, unknown> = {
      project_id: id,
      new_project_name: params.newName ?? null,
    };
    if (params.compute) body.compute = params.compute;
    return this.http.call("Ontology copy", "POST", "/api/v1/ontologies/copy", { body }, options);
  }

  /** Exports one ontology as a JSON document that `import()` accepts. */
  export(id: string, options?: RequestOptions): Promise<JsonObject> {
    return this.http.call(
      "Ontology export",
      "POST",
      "/api/v1/ontologies/export-ontology",
      { body: { project_id: id } },
      options,
    );
  }

  import(
    exportData: JsonObject,
    params: ImportOntologyParams = {},
    options?: RequestOptions,
  ): Promise<unknown> {
    assertExport(exportData);
    const body: Record<string, unknown> = {
      export_data: exportData,
      force_new_id: params.forceNewId ?? false,
    };
    if (params.compute) body.compute = params.compute;
    return this.http.call(
      "Ontology import",
      "POST",
      "/api/v1/ontologies/import-ontology",
      { body },
      options,
    );
  }

  /** Creates an ontology from free-text context and optional file attachments. */
  createFromContext(params: CreateFromContextParams, options?: RequestOptions): Promise<unknown> {
    const form = new FormData();
    form.set("context", params.context ?? "");
    form.set("concept_names", JSON.stringify(params.conceptNames ?? []));
    for (const file of params.files ?? []) {
      const { blob, filename } = toBlob(file);
      form.append("files", blob, filename);
    }
    return this.http.call(
      "Ontology create from context",
      "POST",
      "/api/v1/ontologies/create-from-context",
      { form },
      options,
    );
  }
}

export type Snapshot = Loose<{
  id: string;
  ontology_id: string;
  description: string | null;
  created_at: string;
}>;

export interface RestoreSnapshotParams {
  /** Snapshot the current state before restoring. Default `true`. */
  createSafetySnapshot?: boolean;
}

export class Snapshots extends APIResource {
  create(ontologyId: string, description?: string, options?: RequestOptions): Promise<unknown> {
    const body: Record<string, unknown> = { project_id: ontologyId };
    if (description !== undefined) body.description = description;
    return this.http.call(
      "Snapshot create",
      "POST",
      "/api/v1/ontologies/snapshots/create",
      { body },
      options,
    );
  }

  list(ontologyId: string, options?: RequestOptions): Promise<Snapshot[]> {
    return this.http.call(
      "Snapshot list",
      "GET",
      "/api/v1/ontologies/snapshots/list",
      { query: { project_id: ontologyId } },
      options,
    );
  }

  restore(
    ontologyId: string,
    snapshotId: string,
    params: RestoreSnapshotParams = {},
    options?: RequestOptions,
  ): Promise<unknown> {
    return this.http.call(
      "Snapshot restore",
      "POST",
      "/api/v1/ontologies/snapshots/restore",
      {
        body: {
          snapshot_id: snapshotId,
          project_id: ontologyId,
          create_safety_snapshot: params.createSafetySnapshot ?? true,
        },
      },
      options,
    );
  }

  async delete(ontologyId: string, snapshotId: string, options?: RequestOptions): Promise<void> {
    const envelope = await this.http.request(
      "POST",
      "/api/v1/ontologies/snapshots/delete",
      { body: { snapshot_id: snapshotId, project_id: ontologyId } },
      options,
    );
    unwrapMessage("Snapshot delete", envelope);
  }
}

export interface ImportTemplateParams {
  newName?: string;
  compute?: Compute;
}

export class Templates extends APIResource {
  /** Lists the marketplace templates. */
  list(options?: RequestOptions): Promise<unknown> {
    return this.http.call("Template list", "GET", "/api/v1/ontologies/list-templates", {}, options);
  }

  /** Creates a new ontology from a marketplace template. */
  import(
    templateId: string,
    params: ImportTemplateParams = {},
    options?: RequestOptions,
  ): Promise<unknown> {
    const body: Record<string, unknown> = { template_id: templateId };
    if (params.newName !== undefined) body.new_project_name = params.newName;
    if (params.compute) body.compute = params.compute;
    return this.http.call(
      "Template import",
      "POST",
      "/api/v1/ontologies/import-template",
      { body },
      options,
    );
  }
}

export class Workspace extends APIResource {
  /** Exports every ontology in the workspace. */
  export(options?: RequestOptions): Promise<JsonObject> {
    return this.http.call(
      "Workspace export",
      "POST",
      "/api/v1/ontologies/export-workspace",
      { body: {} },
      options,
    );
  }

  import(exportData: JsonObject, options?: RequestOptions): Promise<unknown> {
    assertExport(exportData);
    return this.http.call(
      "Workspace import",
      "POST",
      "/api/v1/ontologies/import-workspace",
      { body: { export_data: exportData } },
      options,
    );
  }
}

function assertExport(exportData: unknown): void {
  if (!exportData || typeof exportData !== "object" || Array.isArray(exportData)) {
    throw new TypeError("exportData must be a non-empty object");
  }
  if (Object.keys(exportData).length === 0) {
    throw new TypeError("exportData must be a non-empty object");
  }
}
