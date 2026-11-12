import { type FileDownload, toBlob, type Uploadable } from "../core/files.ts";
import { unwrapMessage } from "../core/http.ts";
import { APIResource } from "../core/resource.ts";
import type { Compute, JsonObject, JsonValue, Loose, RequestOptions } from "../core/types.ts";

/**
 * Connection description for a data source. Field names match the wire format.
 * Only `databaseType` is required; the rest depend on the source kind
 * (e.g. `csv`, `postgresql`, `snowflake`, `databricks`).
 */
export interface Database {
  databaseType: string;
  username?: string | null;
  password?: string | null;
  host?: string | null;
  port?: number | string | null;
  databaseName?: string | null;
  tables?: string[] | null;
  schema?: string | null;
  catalog?: string | null;
  query?: string | null;
  options?: JsonObject | null;
  selectedColumns?: JsonValue | null;
  ignoreColumns?: JsonValue | null;
  ignoreTables?: string[] | null;
  url?: string | null;
}

export type DataSource = Loose<{
  id: string;
  datasource_id: string;
  datasource_type: string;
  type: string;
  table_name: string;
  bind_annotation: string;
  model_annotation: string;
  predicate_placeholder: string;
  /** Column name to type. */
  fields: Record<string, string>;
  row_count: number;
  column_count: number;
  author: string;
  timestamp: string | null;
  database_name: string;
  host: string;
  port: string;
  location: string;
  group_by: string;
}>;

export interface ConnectParams {
  /** Count rows of each table while connecting (slower). */
  computeRowCount?: boolean;
}

export interface InferSchemaParams {
  /** Default `true`. */
  addBind?: boolean;
  /** Default `false`. */
  addModel?: boolean;
}

export interface PreviewParams {
  /** Default 10. */
  limit?: number;
  /** Default 1. */
  page?: number;
  /** Default 0 (server decides). */
  pageSize?: number;
  orderBy?: string;
  searchTerm?: string;
  columnFilters?: JsonValue;
  compute?: Compute;
}

export interface AllPairsJoinParams {
  toEvaluate?: boolean;
  /** Default `true`. */
  parallel?: boolean;
}

export class DataSources extends APIResource {
  connect(
    database: Database,
    params: ConnectParams = {},
    options?: RequestOptions,
  ): Promise<unknown> {
    return this.http.call(
      "Data source connect",
      "POST",
      "/api/v1/data/connect",
      {
        body: {
          database: wireDatabase(database),
          computeRowCount: params.computeRowCount ?? false,
        },
      },
      options,
    );
  }

  list(options?: RequestOptions): Promise<DataSource[]> {
    return this.http.call("Data source list", "GET", "/api/v1/data/list", {}, options);
  }

  /** Deletes the given data sources. */
  async delete(ids: string[], options?: RequestOptions): Promise<void> {
    if (ids.length === 0) throw new TypeError("ids must not be empty");
    const envelope = await this.http.request(
      "POST",
      "/api/v1/data/cleanup",
      { body: { source_ids: ids } },
      options,
    );
    unwrapMessage("Data source delete", envelope);
  }

  inferSchema(
    database: Database,
    params: InferSchemaParams = {},
    options?: RequestOptions,
  ): Promise<unknown> {
    return this.http.call(
      "Data source infer schema",
      "POST",
      "/api/v1/data/infer-schema",
      {
        body: {
          database: wireDatabase(database),
          addBind: params.addBind ?? true,
          addModel: params.addModel ?? false,
        },
      },
      options,
    );
  }

  /** Lists the sheets of a spreadsheet-style source. */
  listSheets(database: Database, options?: RequestOptions): Promise<unknown> {
    return this.http.call(
      "Data source list sheets",
      "POST",
      "/api/v1/data/list-sheets",
      { body: { database: wireDatabase(database) } },
      options,
    );
  }

  /** Lists the Prometheux demo data sources offered during onboarding. */
  listDemo(options?: RequestOptions): Promise<unknown> {
    return this.http.call("Data source list demo", "GET", "/api/v1/data/demo-sources", {}, options);
  }

  /** Re-connects every stored data-source group and reconciles the list. */
  refresh(groupFilter?: string, options?: RequestOptions): Promise<unknown> {
    return this.http.call(
      "Data source refresh",
      "POST",
      "/api/v1/data/refresh",
      { body: { group_filter: groupFilter ?? null } },
      options,
    );
  }

  /** Previews rows from the source described by a bind annotation. */
  preview(
    bindAnnotation: string,
    params: PreviewParams = {},
    options?: RequestOptions,
  ): Promise<unknown> {
    const body: Record<string, unknown> = {
      bind_annotation: bindAnnotation,
      limit: params.limit ?? 10,
      page: params.page ?? 1,
      page_size: params.pageSize ?? 0,
    };
    if (params.orderBy !== undefined) body.order_by = params.orderBy;
    if (params.searchTerm !== undefined) body.search_term = params.searchTerm;
    if (params.columnFilters !== undefined) body.column_filters = params.columnFilters;
    if (params.compute) body.compute = params.compute;
    return this.http.call("Data source preview", "POST", "/api/v1/data/preview", { body }, options);
  }

  /** Computes joinability across every pair of the given sources. */
  allPairsJoin(
    databases: Database[],
    params: AllPairsJoinParams = {},
    options?: RequestOptions,
  ): Promise<unknown> {
    return this.http.call(
      "Data source all pairs join",
      "POST",
      "/api/v1/data/all-pairs-join",
      {
        body: {
          database_payloads: databases.map(wireDatabase),
          to_evaluate: params.toEvaluate ?? false,
          parallel: params.parallel ?? true,
        },
      },
      options,
    );
  }
}

export type DiskEntry = Loose<{
  name: string;
  type: "file" | "directory";
  size: number | null;
  modified: string | null;
  extension?: string;
  /** Present on shared entries at the top level. */
  shared?: true;
  ref?: string;
  display_name?: string;
  role?: string;
  owner?: string;
}>;

export type UploadResult = Loose<{
  /** The `disk/<name>` path to pass to other APIs. */
  filePath: string;
  fileName: string;
  fileSize: number;
  replacedExisting: boolean;
  resyncedDataSources: string[];
}>;

export interface UploadParams {
  /** Directory under disk/ to upload into. Default: the root. */
  path?: string;
  /** Filename sent to the server. Defaults to the `File`'s name. */
  filename?: string;
}

/** The workspace `disk/` file storage. */
export class Files extends APIResource {
  /**
   * Uploads a file. Pass a `Blob`/`File`/bytes, or `await fileFromPath("./data.csv")`.
   * The returned `disk/<name>` path is what other APIs (agent attachments,
   * context ingestion) expect.
   */
  upload(
    file: Uploadable,
    params: UploadParams = {},
    options?: RequestOptions,
  ): Promise<UploadResult> {
    const { blob, filename } = toBlob(file, params.filename);
    const form = new FormData();
    form.set("file", blob, filename);
    form.set("path", params.path ?? "");
    return this.http.call("File upload", "POST", "/api/v1/data/files/upload", { form }, options);
  }

  list(path = "", options?: RequestOptions): Promise<DiskEntry[]> {
    return this.http.call(
      "File list",
      "GET",
      "/api/v1/data/files/list",
      { query: { path } },
      options,
    );
  }

  mkdir(path: string, options?: RequestOptions): Promise<unknown> {
    return this.http.call(
      "File mkdir",
      "POST",
      "/api/v1/data/files/mkdir",
      { body: { path } },
      options,
    );
  }

  delete(
    paths: string[],
    params: { recursive?: boolean } = {},
    options?: RequestOptions,
  ): Promise<unknown> {
    return this.http.call(
      "File delete",
      "POST",
      "/api/v1/data/files/delete",
      { body: { paths, recursive: params.recursive ?? false } },
      options,
    );
  }

  move(source: string, destination: string, options?: RequestOptions): Promise<unknown> {
    return this.http.call(
      "File move",
      "POST",
      "/api/v1/data/files/move",
      { body: { source, destination } },
      options,
    );
  }

  /** Downloads a file. Call `.saveTo(path)`, `.text()`, `.blob()` etc. on the result. */
  download(path: string, options?: RequestOptions): Promise<FileDownload> {
    return this.http.download("/api/v1/data/files/download", { query: { path } }, options);
  }
}

function wireDatabase(database: Database): Record<string, unknown> {
  return {
    databaseType: database.databaseType,
    username: database.username ?? null,
    password: database.password ?? null,
    host: database.host ?? null,
    port: database.port ?? null,
    databaseName: database.databaseName ?? null,
    options: database.options ?? null,
    schema: database.schema ?? null,
    catalog: database.catalog ?? null,
    query: database.query ?? null,
    selectedColumns: database.selectedColumns ?? null,
    ignoreColumns: database.ignoreColumns ?? null,
    ignoreTables: database.ignoreTables ?? null,
    tables: database.tables ?? null,
    url: database.url ?? null,
  };
}
