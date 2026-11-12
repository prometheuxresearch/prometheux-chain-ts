import { unwrapMessage } from "../core/http.ts";
import { APIResource, seg } from "../core/resource.ts";
import type { JsonObject, Loose, RequestOptions } from "../core/types.ts";

export type ShareRole = "viewer" | "editor";

/** Identify the recipient by `sub`, by `email`, or by `username` + `organization`. */
export type ShareRecipient =
  | { sub: string }
  | { email: string }
  | { username: string; organization: string };

export type Share = Loose<{
  share_id: string;
  share_type: "user" | "team";
  ontology_id: string;
  recipient_sub: string | null;
  recipient_username: string | null;
  recipient_organization: string | null;
  share_role: ShareRole;
  jti: string | null;
  status: "pending" | "accepted" | "active" | "revoked" | "superseded" | "expired" | (string & {});
  expires_at: string | null;
  created_at: string | null;
  accepted_at?: string | null;
  updated_at: string | null;
  ontology_name?: string | null;
  team_id?: string;
  team_name?: string | null;
}>;

/** Revoke by `shareId`, or by `ontologyId` + `recipientSub`. */
export type RevokeShareParams = { shareId: string } | { ontologyId: string; recipientSub: string };

/** Sharing ontologies with other users (sharer and recipient sides). */
export class Shares extends APIResource {
  create(
    ontologyId: string,
    recipient: ShareRecipient,
    role: ShareRole,
    params: { expiresInMinutes?: number } = {},
    options?: RequestOptions,
  ): Promise<unknown> {
    const body: Record<string, unknown> = { project_id: ontologyId, recipient, share_role: role };
    if (params.expiresInMinutes !== undefined) body.expires_in_minutes = params.expiresInMinutes;
    return this.http.call("Share create", "POST", "/api/v1/ontologies/share", { body }, options);
  }

  revoke(params: RevokeShareParams, options?: RequestOptions): Promise<unknown> {
    const body =
      "shareId" in params
        ? { share_id: params.shareId }
        : { project_id: params.ontologyId, recipient_sub: params.recipientSub };
    return this.http.call(
      "Share revoke",
      "POST",
      "/api/v1/ontologies/share/revoke",
      { body },
      options,
    );
  }

  updateRole(shareId: string, role: ShareRole, options?: RequestOptions): Promise<unknown> {
    return this.http.call(
      "Share update role",
      "POST",
      "/api/v1/ontologies/share/update-role",
      { body: { share_id: shareId, share_role: role } },
      options,
    );
  }

  /** Shares you created, optionally for one ontology. */
  list(ontologyId?: string, options?: RequestOptions): Promise<Share[]> {
    return this.http.call(
      "Share list",
      "GET",
      "/api/v1/ontologies/share/list",
      { query: { project_id: ontologyId } },
      options,
    );
  }

  /** Shares visible to you as a recipient (pending and accepted). */
  inbox(options?: RequestOptions): Promise<Share[]> {
    return this.http.call("Share inbox", "GET", "/api/v1/ontologies/share/inbox", {}, options);
  }

  accept(shareId: string, options?: RequestOptions): Promise<unknown> {
    return this.http.call(
      "Share accept",
      "POST",
      "/api/v1/ontologies/share/accept",
      { body: { share_id: shareId } },
      options,
    );
  }

  leave(shareId: string, options?: RequestOptions): Promise<unknown> {
    return this.http.call(
      "Share leave",
      "POST",
      "/api/v1/ontologies/share/leave",
      { body: { share_id: shareId } },
      options,
    );
  }

  /** Reconciles your local share vault against the source of truth. */
  syncInbox(options?: RequestOptions): Promise<unknown> {
    return this.http.call("Share sync", "POST", "/api/v1/ontologies/share/sync", {}, options);
  }
}

export type AppMeta = Loose<{
  id: string;
  name: string;
  created_at: string | null;
  updated_at: string | null;
  author: string | null;
  logo_url: string | null;
  status: "published" | "draft";
}>;

/** An app definition. See the app-builder docs for the full schema. */
export type AppDefinition = JsonObject;

/** Apps built on top of an ontology. */
export class Apps extends APIResource {
  /** Apps across every ontology. */
  listAll(options?: RequestOptions): Promise<AppMeta[]> {
    return this.http.call("App list all", "GET", "/api/v1/apps/list", {}, options);
  }

  list(ontologyId: string, options?: RequestOptions): Promise<AppMeta[]> {
    return this.http.call("App list", "GET", `/api/v1/apps/${seg(ontologyId)}/list`, {}, options);
  }

  get(ontologyId: string, appId: string, options?: RequestOptions): Promise<AppDefinition> {
    return this.http.call(
      "App get",
      "GET",
      `/api/v1/apps/${seg(ontologyId)}/${seg(appId)}`,
      {},
      options,
    );
  }

  /** Creates or updates an app and returns its id. */
  save(ontologyId: string, app: AppDefinition, options?: RequestOptions): Promise<{ id: string }> {
    return this.http.call(
      "App save",
      "POST",
      `/api/v1/apps/${seg(ontologyId)}/save`,
      { body: { app } },
      options,
    );
  }

  async delete(ontologyId: string, appId: string, options?: RequestOptions): Promise<void> {
    const envelope = await this.http.request(
      "DELETE",
      `/api/v1/apps/${seg(ontologyId)}/${seg(appId)}`,
      {},
      options,
    );
    unwrapMessage("App delete", envelope);
  }

  /** Publishes a frozen, shareable snapshot of the current draft. */
  publish(ontologyId: string, appId: string, options?: RequestOptions): Promise<unknown> {
    return this.http.call(
      "App publish",
      "POST",
      `/api/v1/apps/${seg(ontologyId)}/${seg(appId)}/publish`,
      {},
      options,
    );
  }

  /** Removes the published snapshot (back to draft only). */
  async unpublish(ontologyId: string, appId: string, options?: RequestOptions): Promise<void> {
    const envelope = await this.http.request(
      "POST",
      `/api/v1/apps/${seg(ontologyId)}/${seg(appId)}/unpublish`,
      {},
      options,
    );
    unwrapMessage("App unpublish", envelope);
  }
}
