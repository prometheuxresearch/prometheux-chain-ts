# prometheux-chain

TypeScript SDK for [Prometheux](https://www.prometheux.ai): build, evolve and deploy your
ontologies from Node.js. It is the TypeScript counterpart of the
[`prometheux-chain`](https://pypi.org/project/prometheux-chain/) Python SDK and covers the same
backend surface.

- Fully typed requests, responses, stream events and errors.
- ESM and CommonJS builds, zero runtime dependencies.
- Native `fetch` and `WebSocket`. Requires Node.js 22 or later.
- Streaming via `for await`, cancellation via `AbortSignal`, per-call timeouts.

## Install

```bash
npm install prometheux-chain
```

## Quick start

```ts
import { Prometheux } from "prometheux-chain";

const px = new Prometheux({
  token: process.env.PMTX_TOKEN,
  baseUrl: "https://api.prometheux.ai/jarvispy/<organization>/<username>",
});

const ontologyId = await px.ontologies.save({ name: "companies" });

await px.concepts.save(ontologyId, {
  definition: `
    company("Apple", "Redwood City, CA").
    company("Google", "Mountain View, CA").
    company("Microsoft", "Redmond, WA").
    location(Location) :- company(_, Location).
    @output("location").
  `,
});

await px.concepts.run(ontologyId, "location");

const page = await px.concepts.fetchResults(ontologyId, "location", { pageSize: 50 });
console.log(page.results.columnNames, page.results.facts, page.pagination.total_count);
```

`token` and `baseUrl` default to the `PMTX_TOKEN` and `JARVISPY_URL` environment variables, so
`new Prometheux()` is enough when they are set. `SUPABASE_TOKEN` (or `supabaseToken`) is sent as
`X-Supabase-Token` for recipient-side sharing flows.

## Client options

| Option           | Default            | Description                                                       |
| ---------------- | ------------------ | ----------------------------------------------------------------- |
| `token`          | `PMTX_TOKEN`       | API token.                                                        |
| `baseUrl`        | `JARVISPY_URL`     | Your backend, e.g. `https://api.prometheux.ai/jarvispy/org/user`. |
| `supabaseToken`  | `SUPABASE_TOKEN`   | Optional Supabase token.                                          |
| `timeout`        | `300000`           | Request timeout in ms. For streams it is the idle timeout.        |
| `wsTimeout`      | `60000`            | WebSocket idle timeout in ms (the server pings every ~20s).       |
| `maxRetries`     | `2`                | Retries for GET requests on connection errors, 429 and 502–504.   |
| `fetch`          | `globalThis.fetch` | Custom fetch (proxies, tests, instrumentation).                   |
| `defaultHeaders` | `{}`               | Headers sent with every request.                                  |

Every method also takes an optional last argument `{ signal, timeout, headers }`:

```ts
const controller = new AbortController();
await px.concepts.run(ontologyId, "location", {}, { signal: controller.signal, timeout: 60_000 });
```

## Streaming

**Agent chat** (NDJSON). Events are a discriminated union, so narrowing on `type` types `data`:

```ts
for await (const event of px.agent.chat(ontologyId, "What does this ontology do?")) {
  if (event.type === "content") process.stdout.write(event.data.chunk);
  if (event.type === "tool_start") console.log("\n→", event.data.tool);
}
```

**Concept runs with live status** (WebSocket). Iteration ends after `complete` or `error`:

```ts
for await (const event of px.concepts.runStream(ontologyId, "location", { runMode: "all" })) {
  if (event.event === "concept_status") console.log(event.data);
  if (event.event === "complete") console.log("done:", event.data.status);
}
```

**Context auto-seed** (NDJSON): `px.context.autoSeed({ scopeId: ontologyId })`.

A stream that stalls or drops ends with a terminal `error` event instead of throwing. Errors
returned before the stream starts (bad token, plan limits) are thrown.

## Files

```ts
import { fileFromPath } from "prometheux-chain";

const { filePath } = await px.files.upload(await fileFromPath("./cities.csv"), { path: "inputs" });

const download = await px.files.download(filePath);
await download.saveTo("./cities-copy.csv"); // or .text(), .blob(), .arrayBuffer(), .body
```

Uploads accept a `Blob`, `File`, `Uint8Array` or `ArrayBuffer`. Server-supplied download
filenames are reduced to a bare basename.

## Errors

| Error                                                                                                   | When                                                    |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `AuthenticationError`                                                                                   | 401: invalid or expired token.                          |
| `QuotaExceededError`                                                                                    | 402: a plan limit was hit. `error.code` says which one. |
| `PermissionDeniedError`                                                                                 | 403.                                                    |
| `NotFoundError`                                                                                         | 404.                                                    |
| `BadRequestError`, `ConflictError`, `UnprocessableEntityError`, `RateLimitError`, `InternalServerError` | 400, 409, 422, 429, 5xx.                                |
| `APIError`                                                                                              | Base class of the above: `status`, `body`, `headers`.   |
| `OperationFailedError`                                                                                  | HTTP 200, but the response envelope reported a failure. |
| `APIConnectionError`                                                                                    | The backend could not be reached.                       |
| `APITimeoutError`                                                                                       | The request exceeded its timeout.                       |

All extend `PrometheuxError`.

```ts
import { QuotaExceededError } from "prometheux-chain";

try {
  await px.ontologies.save({ name: "one-too-many" });
} catch (error) {
  if (error instanceof QuotaExceededError) console.log("Plan limit:", error.code);
  else throw error;
}
```

## Types

Responses keep the backend's field names (`snake_case`), so they match the REST API and the
Python SDK. Request parameters are `camelCase`. Every request, response and event type is
exported:

```ts
import type { Concept, ContextNote, RunStreamEvent, AgentEvent } from "prometheux-chain";
```

Response types list the fields the backend guarantees and still allow extra ones, so new
server fields never break your build. Endpoints whose payload the backend does not pin down
return `unknown`; narrow them yourself.

## Python → TypeScript

The Python SDK is a flat list of functions. Here they are grouped under resources on the client.

| Python (`px.*`)                                                | TypeScript (`px.*`)                                                     |
| -------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `save_ontology`                                                | `ontologies.save`                                                       |
| `list_ontologies` / `load_ontology`                            | `ontologies.list` / `ontologies.get`                                    |
| `cleanup_ontologies`                                           | `ontologies.delete`                                                     |
| `copy_ontology`                                                | `ontologies.copy`                                                       |
| `export_ontology` / `import_ontology`                          | `ontologies.export` / `ontologies.import`                               |
| `create_ontology_from_context`                                 | `ontologies.createFromContext`                                          |
| `create/list/restore/delete_snapshot`                          | `ontologies.snapshots.create/list/restore/delete`                       |
| `export_workspace` / `import_workspace`                        | `workspace.export` / `workspace.import`                                 |
| `list_templates` / `import_template`                           | `templates.list` / `templates.import`                                   |
| `connect_sources` / `list_sources`                             | `datasources.connect` / `datasources.list`                              |
| `cleanup_sources`                                              | `datasources.delete(ids)` / `datasources.deleteAll()`                   |
| `infer_schema` / `list_sheets`                                 | `datasources.inferSchema` / `datasources.listSheets`                    |
| `list_demo_sources` / `refresh_sources`                        | `datasources.listDemo` / `datasources.refresh`                          |
| `preview_datasource` / `all_pairs_join`                        | `datasources.preview` / `datasources.allPairsJoin`                      |
| `upload_file` / `list_files`                                   | `files.upload` / `files.list`                                           |
| `make_directory` / `delete_files`                              | `files.mkdir` / `files.delete`                                          |
| `move_file` / `download_file`                                  | `files.move` / `files.download`                                         |
| `save_concept` / `rename_concept`                              | `concepts.save` / `concepts.rename`                                     |
| `run_concept` / `run_concept_stream`                           | `concepts.run` / `concepts.runStream`                                   |
| `list_concepts` / `reorder_concepts`                           | `concepts.list` / `concepts.reorder`                                    |
| `cleanup_concepts`                                             | `concepts.delete(id, names)` / `concepts.deleteAll(id)`                 |
| `fetch_results` / `search_results`                             | `concepts.fetchResults` / `concepts.searchResults`                      |
| `query_concept`                                                | `concepts.query`                                                        |
| `search_similar_concepts`                                      | `concepts.searchSimilar`                                                |
| `llm_analysis` / `download_concept`                            | `concepts.llmAnalysis` / `concepts.download`                            |
| `generate_concept_description`                                 | `concepts.generateDescription`                                          |
| `get_concept_description`                                      | `concepts.getDescription`                                               |
| `get_execution_status(es)`                                     | `concepts.executionStatus` / `concepts.executionStatuses`               |
| `save/load_ontology_schema`                                    | `ontologySchema.save` / `ontologySchema.load`                           |
| `update_concept_ontology_schema_type`                          | `ontologySchema.setConceptType`                                         |
| `add_to_lineage` / `import_owl`                                | `ontologySchema.addToLineage` / `ontologySchema.importOwl`              |
| `visualize_concept_lineage`                                    | `graphs.conceptLineage`                                                 |
| `build_graph` / `list_graph_functions`                         | `graphs.build` / `graphs.listFunctions`                                 |
| `run_graph_analytics`                                          | `graphs.runAnalytics`                                                   |
| `list/create/get/update/delete_context_note`                   | `context.list/create/get/update/delete`                                 |
| `create_context_notes_from_file`                               | `context.createFromFile`                                                |
| `create_context_edge` / `search_context_notes`                 | `context.createEdge` / `context.search`                                 |
| `auto_seed` / `ontology_text`                                  | `context.autoSeed` / `context.ontologyText`                             |
| `interview_template` / `submit_interview`                      | `context.interviewTemplate` / `context.submitInterview`                 |
| `onboarding_status`                                            | `context.onboardingStatus`                                              |
| `agent_chat` / `agent_reset`                                   | `agent.chat` / `agent.reset`                                            |
| `list/get/rename/delete_session`                               | `chatSessions.list/get/rename/delete`                                   |
| `list_skills` / `get_skill` / `get_company_info`               | `assistant.listSkills` / `assistant.getSkill` / `assistant.companyInfo` |
| `create/revoke_share`, `update_share_role`                     | `shares.create` / `shares.revoke` / `shares.updateRole`                 |
| `list_shares` / `list_inbox`                                   | `shares.list` / `shares.inbox`                                          |
| `accept/leave_share` / `sync_inbox`                            | `shares.accept` / `shares.leave` / `shares.syncInbox`                   |
| `list_all_apps` / `list_apps` / `get_app`                      | `apps.listAll` / `apps.list` / `apps.get`                               |
| `save/delete/publish/unpublish_app`                            | `apps.save/delete/publish/unpublish`                                    |
| `create/list/get/update/delete_policy`                         | `policies.create/list/get/update/delete`                                |
| `trigger_policy` / `get_run_history`                           | `policies.trigger` / `policies.runs`                                    |
| `get_alert_history` / `reprocess_alert`                        | `alerts.history` / `alerts.reprocess`                                   |
| `check_compute_availability`                                   | `compute.checkAvailability`                                             |
| `list_machines_combined` / `use_machine`                       | `machines.list` / `machines.use`                                        |
| `set_machine_active` / `get_machine_status`                    | `machines.setActive` / `machines.status`                                |
| `delete_user_machine`                                          | `machines.delete`                                                       |
| `save/load_user_config` / `get_role`                           | `users.saveConfig` / `users.loadConfig` / `users.getRole`               |
| `get_login_activity` / `list_llm_models` / `get_usage_status`  | `users.loginActivity` / `users.listLlmModels` / `users.usageStatus`     |
| `issue_token` / `list_tokens`                                  | `tokens.issue` / `tokens.list`                                          |
| `revoke_token` / `revoke_specific_token` / `revoke_all_tokens` | `tokens.revokeCurrent` / `tokens.revoke` / `tokens.revokeAll`           |
| `analyze_program` / `build_bind` / `parse_binds`               | `vadalog.analyze` / `vadalog.buildBind` / `vadalog.parseBinds`          |
| `evaluate_program` / `validate_concept`                        | `vadalog.evaluate` / `vadalog.validate`                                 |
| `translate_sql/rdf/owl_to_vadalog`                             | `vadalingo.sqlToVadalog` / `rdfToVadalog` / `owlToVadalog`              |
| `Database(...)`                                                | a plain `Database` object (`{ databaseType, host, ... }`)               |

Two deliberate differences from the Python SDK:

- Deleting "everything" needs its own method (`concepts.deleteAll`, `datasources.deleteAll`).
  Passing an empty list to `delete` throws instead of wiping the ontology or workspace.
- Downloads return a `FileDownload` handle instead of writing to the working directory. Call
  `saveTo(path)` to write it.

## Development

```bash
npm install
npm run check        # lint, typecheck, unit tests, build, publint + are-the-types-wrong
npm run dev          # rebuild on change
```

The version lives in `package.json`; `src/version.ts` must match it (a unit test enforces this).

## License

BSD 3-Clause. See [LICENSE](LICENSE).
