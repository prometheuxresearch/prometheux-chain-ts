import { type ClientOptions, HttpClient } from "./core/http.ts";
import { Assistant, Tokens, Users } from "./resources/account.ts";
import { Agent, ChatSessions } from "./resources/agent.ts";
import { ComputeResource, Machines } from "./resources/compute.ts";
import { Concepts } from "./resources/concepts.ts";
import { Context } from "./resources/context.ts";
import { DataSources, Files } from "./resources/data.ts";
import { Graphs, OntologySchema } from "./resources/graphs.ts";
import { Ontologies, Templates, Workspace } from "./resources/ontologies.ts";
import { Alerts, Policies } from "./resources/schedules.ts";
import { Apps, Shares } from "./resources/sharing.ts";
import { Vadalingo, Vadalog } from "./resources/vadalog.ts";

/**
 * Client for the Prometheux platform.
 *
 * ```ts
 * import { Prometheux } from "prometheux-chain";
 *
 * // Reads PMTX_TOKEN and JARVISPY_URL from the environment by default.
 * const px = new Prometheux();
 * const ontologyId = await px.ontologies.save({ name: "demo" });
 * ```
 */
export class Prometheux {
  /** Low-level transport, for endpoints the SDK does not wrap yet. */
  readonly http: HttpClient;

  readonly ontologies: Ontologies;
  readonly templates: Templates;
  readonly workspace: Workspace;
  readonly concepts: Concepts;
  readonly datasources: DataSources;
  readonly files: Files;
  readonly ontologySchema: OntologySchema;
  readonly graphs: Graphs;
  readonly context: Context;
  readonly agent: Agent;
  readonly chatSessions: ChatSessions;
  readonly assistant: Assistant;
  readonly shares: Shares;
  readonly apps: Apps;
  readonly policies: Policies;
  readonly alerts: Alerts;
  readonly compute: ComputeResource;
  readonly machines: Machines;
  readonly users: Users;
  readonly tokens: Tokens;
  readonly vadalog: Vadalog;
  readonly vadalingo: Vadalingo;

  constructor(options: ClientOptions = {}) {
    const http = new HttpClient(options);
    this.http = http;
    this.ontologies = new Ontologies(http);
    this.templates = new Templates(http);
    this.workspace = new Workspace(http);
    this.concepts = new Concepts(http);
    this.datasources = new DataSources(http);
    this.files = new Files(http);
    this.ontologySchema = new OntologySchema(http);
    this.graphs = new Graphs(http);
    this.context = new Context(http);
    this.agent = new Agent(http);
    this.chatSessions = new ChatSessions(http);
    this.assistant = new Assistant(http);
    this.shares = new Shares(http);
    this.apps = new Apps(http);
    this.policies = new Policies(http);
    this.alerts = new Alerts(http);
    this.compute = new ComputeResource(http);
    this.machines = new Machines(http);
    this.users = new Users(http);
    this.tokens = new Tokens(http);
    this.vadalog = new Vadalog(http);
    this.vadalingo = new Vadalingo(http);
  }
}
