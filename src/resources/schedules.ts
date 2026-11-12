import { unwrapMessage } from "../core/http.ts";
import { APIResource, seg } from "../core/resource.ts";
import type { Compute, Loose, RequestOptions } from "../core/types.ts";

export interface CronTrigger {
  cron_expression: string;
  timezone?: string;
}

export interface DataChangeTrigger {
  check_interval_minutes: number;
}

export type CreatePolicyParams =
  | { triggerType?: "cron"; triggerConfig: CronTrigger; enabled?: boolean }
  | { triggerType: "data_change"; triggerConfig: DataChangeTrigger; enabled?: boolean };

export type Policy = Loose<{
  policy_id: string;
  ontology_id: string;
  concept_name: string;
  trigger_type: "cron" | "data_change";
  trigger_config: Partial<CronTrigger & DataChangeTrigger>;
  enabled: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
  last_run_status: "success" | "error" | "skipped" | "no_change" | null;
  last_run_error: string | null;
  last_run_tier?: "exact" | "heuristic" | "unknown" | null;
}>;

export type PolicyRun = Loose<{
  run_id: string;
  policy_id: string;
  ontology_id: string;
  concept_name: string;
  trigger_type: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "success" | "error" | "skipped";
  error_message: string | null;
  result_summary: {
    predicates_populated: string[] | null;
    total_records: number | null;
    skipped_execution: boolean;
    message: string | null;
  } | null;
}>;

export interface Pagination {
  /** Default 50 for policy runs, 100 for alerts. */
  limit?: number;
  offset?: number;
}

/** Scheduled concept runs (cron or data-change triggers). */
export class Policies extends APIResource {
  create(
    ontologyId: string,
    conceptName: string,
    params: CreatePolicyParams,
    options?: RequestOptions,
  ): Promise<Policy> {
    return this.http.call(
      "Policy create",
      "POST",
      `/api/v1/schedules/${seg(ontologyId)}/policies`,
      {
        body: {
          concept_name: conceptName,
          trigger_type: params.triggerType ?? "cron",
          trigger_config: params.triggerConfig,
          enabled: params.enabled ?? true,
        },
      },
      options,
    );
  }

  list(ontologyId: string, conceptName?: string, options?: RequestOptions): Promise<Policy[]> {
    return this.http.call(
      "Policy list",
      "GET",
      `/api/v1/schedules/${seg(ontologyId)}/policies`,
      { query: { concept_name: conceptName } },
      options,
    );
  }

  get(ontologyId: string, policyId: string, options?: RequestOptions): Promise<Policy> {
    return this.http.call(
      "Policy get",
      "GET",
      `/api/v1/schedules/${seg(ontologyId)}/policies/${seg(policyId)}`,
      {},
      options,
    );
  }

  update(
    ontologyId: string,
    policyId: string,
    params: { triggerConfig?: Partial<CronTrigger & DataChangeTrigger>; enabled?: boolean },
    options?: RequestOptions,
  ): Promise<Policy> {
    const body: Record<string, unknown> = {};
    if (params.triggerConfig !== undefined) body.trigger_config = params.triggerConfig;
    if (params.enabled !== undefined) body.enabled = params.enabled;
    return this.http.call(
      "Policy update",
      "PATCH",
      `/api/v1/schedules/${seg(ontologyId)}/policies/${seg(policyId)}`,
      { body },
      options,
    );
  }

  /** Deletes a policy and its scheduled job. */
  async delete(ontologyId: string, policyId: string, options?: RequestOptions): Promise<void> {
    const envelope = await this.http.request(
      "DELETE",
      `/api/v1/schedules/${seg(ontologyId)}/policies/${seg(policyId)}`,
      {},
      options,
    );
    unwrapMessage("Policy delete", envelope);
  }

  /** Runs the scheduled concept now. */
  trigger(ontologyId: string, policyId: string, options?: RequestOptions): Promise<unknown> {
    return this.http.call(
      "Policy trigger",
      "POST",
      `/api/v1/schedules/${seg(ontologyId)}/policies/${seg(policyId)}/trigger`,
      {},
      options,
    );
  }

  runs(
    ontologyId: string,
    policyId: string,
    params: Pagination = {},
    options?: RequestOptions,
  ): Promise<{ runs: PolicyRun[]; count: number }> {
    return this.http.call(
      "Policy run history",
      "GET",
      `/api/v1/schedules/${seg(ontologyId)}/policies/${seg(policyId)}/runs`,
      { query: { limit: params.limit ?? 50, offset: params.offset ?? 0 } },
      options,
    );
  }
}

export class Alerts extends APIResource {
  history(params: Pagination = {}, options?: RequestOptions): Promise<unknown> {
    return this.http.call(
      "Alert history",
      "GET",
      "/api/v1/alerts/history",
      { query: { limit: params.limit ?? 100, offset: params.offset ?? 0 } },
      options,
    );
  }

  /** Re-executes the alert's concept. */
  reprocess(
    alertId: string,
    params: { compute?: Compute } = {},
    options?: RequestOptions,
  ): Promise<unknown> {
    const body: Record<string, unknown> = {};
    if (params.compute) body.compute = params.compute;
    return this.http.call(
      "Alert reprocess",
      "POST",
      `/api/v1/alerts/${seg(alertId)}/reprocess`,
      { body },
      options,
    );
  }
}
