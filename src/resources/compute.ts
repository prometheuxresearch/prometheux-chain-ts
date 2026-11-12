import { APIResource, seg } from "../core/resource.ts";
import type { Envelope, JsonObject, Loose, RequestOptions } from "../core/types.ts";

export type CatalogMachine = Loose<{
  id: string;
  name: string;
  type: string;
  cores: number;
  memory_gb: number;
  category: string;
  cloud_provider?: string;
}>;

export type UserMachine = Loose<{
  /** The `userMachineId` other machine methods take. */
  id: string;
  status: string;
  url: string | null;
  machines: CatalogMachine;
}>;

export type MachinesOverview = Loose<{
  machines: CatalogMachine[];
  user_machines_enabled: UserMachine[];
  user_machines_disabled: UserMachine[];
  total_machines: number;
  total_enabled: number;
  total_disabled: number;
}>;

export interface AvailabilityParams {
  /**
   * `{ id }`: your user machine id or its catalog machine id. Available means
   * the machine is enabled for compute and turned on.
   */
  machineConfigs?: { id: string } & JsonObject;
  /** `cluster_id`, `host`, `auth_mode` and the matching credentials. */
  databricksConfigs?: JsonObject;
}

export class ComputeResource extends APIResource {
  /**
   * Checks whether a machine and/or a Databricks cluster is reachable and
   * returns the response envelope. An unreachable resource can also come back
   * as an HTTP error, which is thrown as an `APIError`.
   */
  checkAvailability(params: AvailabilityParams, options?: RequestOptions): Promise<Envelope> {
    if (!params.machineConfigs && !params.databricksConfigs) {
      throw new TypeError("Provide at least one of machineConfigs or databricksConfigs");
    }
    const compute: Record<string, unknown> = {};
    if (params.machineConfigs) compute.machine_configs = params.machineConfigs;
    if (params.databricksConfigs) compute.databricks_configs = params.databricksConfigs;
    return this.http.request(
      "POST",
      "/api/v1/compute/availability",
      { body: { compute } },
      options,
    );
  }
}

/**
 * Machine lifecycle. These endpoints return their payload directly, so each
 * method resolves to the raw response body.
 */
export class Machines extends APIResource {
  /** The machine catalog plus your enabled and disabled machines. */
  list(options?: RequestOptions): Promise<Envelope<MachinesOverview>> {
    return this.http.request("GET", "/api/v1/machines/machines-combined", {}, options);
  }

  /** Adds a catalog machine to your list. It is not billed until started. */
  use(machineId: string, machineName?: string, options?: RequestOptions): Promise<unknown> {
    const body: Record<string, unknown> = { machine_id: machineId };
    if (machineName !== undefined) body.machine_name = machineName;
    return this.http.request("POST", "/api/v1/machines/user-machines/use", { body }, options);
  }

  /** Starts (`true`) or stops (`false`) one of your machines. */
  setActive(
    userMachineId: string,
    isActive: boolean,
    params: { autoterminationMinutes?: number } = {},
    options?: RequestOptions,
  ): Promise<unknown> {
    const body: Record<string, unknown> = { user_machine_id: userMachineId, is_active: isActive };
    if (params.autoterminationMinutes !== undefined) {
      body.autotermination_minutes = params.autoterminationMinutes;
    }
    return this.http.request(
      "PATCH",
      "/api/v1/machines/user-machines/toggle-active",
      { body },
      options,
    );
  }

  /** Real-time pod status of one of your machines. */
  status(userMachineId: string, options?: RequestOptions): Promise<unknown> {
    return this.http.request(
      "GET",
      `/api/v1/machines/user-machines/${seg(userMachineId)}/status`,
      {},
      options,
    );
  }

  /** Disables a machine, keeping its usage history. */
  delete(userMachineId: string, options?: RequestOptions): Promise<unknown> {
    return this.http.request(
      "DELETE",
      `/api/v1/machines/user-machines/${seg(userMachineId)}`,
      {},
      options,
    );
  }
}
