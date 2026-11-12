import { APIResource, seg } from "../core/resource.ts";
import type { Envelope, JsonObject, Loose, RequestOptions } from "../core/types.ts";

export type QuotaStatus = Loose<{
  is_freemium: boolean;
  used: number;
  limit: number;
  remaining: number | null;
  resets_at: string;
  unlimited: boolean;
}>;

export class Users extends APIResource {
  /** Saves user configuration and returns the server's confirmation message. */
  async saveConfig(config: JsonObject, options?: RequestOptions): Promise<string> {
    const envelope = await this.http.request<Envelope>(
      "POST",
      "/api/v1/users/save-config",
      { body: { config_data: config } },
      options,
    );
    return envelope.message ?? "Configuration saved successfully";
  }

  async loadConfig(options?: RequestOptions): Promise<JsonObject> {
    const envelope = await this.http.request<Envelope<JsonObject>>(
      "GET",
      "/api/v1/users/load-config",
      {},
      options,
    );
    return envelope.data ?? {};
  }

  getRole(options?: RequestOptions): Promise<{ role: string | null }> {
    return this.http.call("User get role", "GET", "/api/v1/users/get-role", {}, options);
  }

  /** Distinct IPs / sessions that have accessed this user's workspace. */
  loginActivity(options?: RequestOptions): Promise<unknown> {
    return this.http.call(
      "User login activity",
      "GET",
      "/api/v1/users/login-activity",
      {},
      options,
    );
  }

  /** Model names available from an LLM provider. Pass provider credentials if needed. */
  listLlmModels(
    provider: string,
    credentials: Record<string, string> = {},
    options?: RequestOptions,
  ): Promise<unknown> {
    return this.http.call(
      "User list LLM models",
      "POST",
      "/api/v1/users/llm-models",
      { body: { provider, ...credentials } },
      options,
    );
  }

  /** Current LLM / embedding usage against your plan's limits. */
  usageStatus(
    options?: RequestOptions,
  ): Promise<{ embedding_usage: QuotaStatus; llm_concept_usage: QuotaStatus }> {
    return this.http.call("User usage status", "GET", "/api/v1/users/usage-status", {}, options);
  }
}

export type IssuedToken = Loose<{
  /** The raw token. Shown only once. */
  token: string;
  jti: string;
  name: string | null;
  expires_at: string | null;
  expires_in_minutes: number | null;
}>;

export type ApiToken = Loose<{
  jti: string;
  name: string | null;
  issued_at: string | null;
  expires_at: string | null;
}>;

/** API tokens for the current user. */
export class Tokens extends APIResource {
  /**
   * Issues a new token. The raw token is returned exactly once. Omit
   * `expiresInMinutes` (or pass `<= 0`) for a non-expiring token.
   */
  issue(
    params: { name?: string; expiresInMinutes?: number } = {},
    options?: RequestOptions,
  ): Promise<IssuedToken> {
    const body: Record<string, unknown> = {};
    if (params.name !== undefined) body.name = params.name;
    if (params.expiresInMinutes !== undefined) body.expires_in_minutes = params.expiresInMinutes;
    return this.http.call("Token issue", "POST", "/api/v1/auth/issue-token", { body }, options);
  }

  /** Active tokens (metadata only, never the raw token). */
  list(options?: RequestOptions): Promise<{ tokens: ApiToken[] }> {
    return this.http.call("Token list", "GET", "/api/v1/auth/tokens", {}, options);
  }

  /** Revokes one token by its `jti`. */
  revoke(jti: string, options?: RequestOptions): Promise<unknown> {
    return this.http.call("Token revoke", "POST", `/api/v1/auth/revoke/${seg(jti)}`, {}, options);
  }

  /** Revokes the token this client is using (logout). */
  revokeCurrent(options?: RequestOptions): Promise<unknown> {
    return this.http.call("Token revoke", "POST", "/api/v1/auth/revoke", {}, options);
  }

  /** Revokes every token you own (logout everywhere), including this client's. */
  revokeAll(options?: RequestOptions): Promise<unknown> {
    return this.http.call("Token revoke all", "POST", "/api/v1/auth/revoke-all", {}, options);
  }
}

export type SkillMeta = Loose<{ id: string; name: string; description: string }>;

/** Skill playbooks and the Prometheux knowledge base used by the assistant. */
export class Assistant extends APIResource {
  /** Skill metadata (no bodies). */
  listSkills(options?: RequestOptions): Promise<{ count: number; skills: SkillMeta[] }> {
    return this.http.call("Skill list", "GET", "/api/v1/assistant/skills", {}, options);
  }

  getSkill(skillId: string, options?: RequestOptions): Promise<unknown> {
    return this.http.call(
      "Skill get",
      "GET",
      `/api/v1/assistant/skills/${seg(skillId)}`,
      {},
      options,
    );
  }

  /** Searches the Prometheux company knowledge base. */
  companyInfo(query: string, options?: RequestOptions): Promise<unknown> {
    return this.http.call(
      "Company info",
      "GET",
      "/api/v1/assistant/company-info",
      { query: { query } },
      options,
    );
  }
}
