import { unwrapMessage } from "../core/http.ts";
import { APIResource, seg } from "../core/resource.ts";
import type { JsonObject, Loose, RequestOptions } from "../core/types.ts";

export interface AgentChatParams {
  /** Continue an existing conversation. */
  sessionId?: string;
  model?: string;
  /** `disk/<name>` paths returned by `files.upload()`. */
  attachmentPaths?: string[];
}

type Usage = {
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  cached_prompt_tokens: number;
};

/** One line of the agent's NDJSON stream. Narrow on `type`. */
export type AgentEvent =
  | { type: "metadata"; data: { ontology_id: string; model: string; context_loaded: boolean } }
  | {
      type: "context_loaded";
      data: Loose<{
        count: number;
        notes: Loose<{
          id: string;
          kind: string;
          scope: string;
          pinned: boolean;
          preview: string;
        }>[];
      }>;
    }
  | { type: "paste_captured"; data: { note_id: string; char_count: number; scope: string } }
  | { type: "content"; data: { chunk: string } }
  | { type: "thinking"; data: { chunk: string } }
  | { type: "tool_start"; data: { tool: string; input: JsonObject } }
  | { type: "tool_progress"; data: Loose<{ tool: string; event: string }> }
  | {
      type: "tool_result";
      data: {
        tool: string;
        result: Loose<{
          success: boolean;
          error?: string;
          permission_denied?: boolean;
          message?: string;
        }>;
      };
    }
  | {
      type: "proposal";
      data: Loose<{
        tool: string;
        ontology_id?: string;
        concept_name?: string;
        definition?: string;
        description?: string;
      }>;
    }
  | {
      type: "authorization_request";
      data: Loose<{
        tool: string;
        call_id: string;
        call_key: string;
        persistable: boolean;
        input: JsonObject;
      }>;
    }
  | { type: "plan"; data: Loose<{ steps: Loose<{ status?: string }>[]; plan_id: string | null }> }
  | {
      type: "plan_approval";
      data: Loose<{
        steps: unknown[];
        plan_id: string | null;
        ontology_id: string | null;
        summary?: string;
      }>;
    }
  | { type: "clarification"; data: Loose<{ ontology_id: string | null }> }
  | { type: "credential_request"; data: Loose<Record<string, unknown>> }
  | {
      type: "halted";
      data: {
        reason: string;
        iterations: number;
        max_iterations: number;
        seconds: number;
        max_seconds: number;
      };
    }
  | {
      type: "done";
      data: Loose<{ ontology_id: string; usage: { agent: Usage; auxiliary: Usage } }>;
    }
  | { type: "session_meta"; data: { session_id: string; title: string } }
  /** Server-side failures carry `error`; a dropped connection carries `status` + `message`. */
  | { type: "error"; data: Loose<{ error?: string; status?: string; message?: string }> }
  /** A line that was not valid JSON. */
  | { type: "raw"; data: string };

export class Agent extends APIResource {
  /**
   * Sends a message to the Prometheux AI agent and streams its response.
   *
   * ```ts
   * for await (const event of px.agent.chat(ontologyId, "What does this ontology do?")) {
   *   if (event.type === "content") process.stdout.write(event.data.chunk);
   * }
   * ```
   */
  chat(
    ontologyId: string,
    message: string,
    params: AgentChatParams = {},
    options?: RequestOptions,
  ): AsyncGenerator<AgentEvent, void, undefined> {
    const body: Record<string, unknown> = { message };
    if (params.sessionId !== undefined) body.session_id = params.sessionId;
    if (params.model !== undefined) body.model = params.model;
    if (params.attachmentPaths !== undefined) body.attachment_paths = params.attachmentPaths;
    return this.http.stream<AgentEvent>(
      "POST",
      `/api/v1/agent/${seg(ontologyId)}/chat`,
      { body },
      { ...options, headers: { Accept: "application/x-ndjson", ...options?.headers } },
    );
  }

  /** Clears a conversation session. Returns the server's confirmation message. */
  async reset(
    ontologyId: string,
    sessionId?: string,
    options?: RequestOptions,
  ): Promise<string | undefined> {
    const body: Record<string, unknown> = {};
    if (sessionId !== undefined) body.session_id = sessionId;
    const envelope = await this.http.request(
      "POST",
      `/api/v1/agent/${seg(ontologyId)}/reset`,
      { body },
      options,
    );
    return unwrapMessage("Agent reset", envelope);
  }
}

export type ChatSession = Loose<{
  id: string;
  ontology_id: string | null;
  title: string;
  created_at: string | null;
  updated_at: string | null;
}>;

/** Persistent agent conversations. */
export class ChatSessions extends APIResource {
  /** Recent sessions, newest first. */
  list(
    params: { ontologyId?: string; limit?: number } = {},
    options?: RequestOptions,
  ): Promise<ChatSession[]> {
    return this.http.call(
      "Chat session list",
      "GET",
      "/api/v1/chat-history/sessions",
      { query: { limit: params.limit ?? 50, project_id: params.ontologyId } },
      options,
    );
  }

  /** A full session including its messages. */
  get(
    sessionId: string,
    options?: RequestOptions,
  ): Promise<Loose<ChatSession & { messages?: unknown[] }>> {
    return this.http.call(
      "Chat session get",
      "GET",
      `/api/v1/chat-history/sessions/${seg(sessionId)}`,
      {},
      options,
    );
  }

  async rename(
    sessionId: string,
    title: string,
    options?: RequestOptions,
  ): Promise<string | undefined> {
    const envelope = await this.http.request(
      "PATCH",
      `/api/v1/chat-history/sessions/${seg(sessionId)}`,
      { body: { title } },
      options,
    );
    return unwrapMessage("Chat session rename", envelope);
  }

  async delete(sessionId: string, options?: RequestOptions): Promise<void> {
    const envelope = await this.http.request(
      "DELETE",
      `/api/v1/chat-history/sessions/${seg(sessionId)}`,
      {},
      options,
    );
    unwrapMessage("Chat session delete", envelope);
  }
}
