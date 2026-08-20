import { AgentRuntimeError } from "./errors.js";
import type {
  PersistedCheckpoint,
  RunClaim,
  RunLease,
  RunTransition,
  RuntimeControlPlane,
  RuntimeToolClient,
  ToolDefinition,
} from "./protocol.js";

interface HttpClientOptions {
  baseUrl: string;
  serviceCredential: string;
  fetchImpl?: typeof fetch;
}

class InternalHttpClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly options: HttpClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
  }

  async request<T>(path: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${this.options.serviceCredential}`,
          "content-type": "application/json",
          ...init.headers,
        },
      });
    } catch {
      throw new AgentRuntimeError("MODEL_UNAVAILABLE", "Agent 内部控制面不可用", true);
    }
    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; data?: T; error?: { code?: string; message?: string } }
      | null;
    if (!response.ok || !payload?.ok) {
      const code = payload?.error?.code;
      if (response.status === 409 || code === "CONTROL_PLANE_CONFLICT") {
        throw new AgentRuntimeError("CONTROL_PLANE_CONFLICT", "Run 租约已失效或被其他 Worker 接管");
      }
      throw new AgentRuntimeError("INTERNAL_ERROR", payload?.error?.message ?? `内部服务返回 HTTP ${response.status}`);
    }
    return payload.data as T;
  }
}

export class HttpRuntimeControlPlane implements RuntimeControlPlane {
  private readonly http: InternalHttpClient;

  constructor(options: HttpClientOptions) {
    this.http = new InternalHttpClient(options);
  }

  private action<T>(body: Record<string, unknown>): Promise<T> {
    return this.http.request<T>("/api/internal/agent/runtime", { method: "POST", body: JSON.stringify(body) });
  }

  claimNext(workerId: string, leaseMs: number): Promise<RunClaim | null> {
    return this.action({ action: "claim", workerId, leaseMs });
  }

  loadLatestCheckpoint(lease: RunLease): Promise<PersistedCheckpoint | null> {
    return this.action({ action: "load_checkpoint", lease });
  }

  heartbeat(lease: RunLease, leaseMs: number): Promise<RunLease> {
    return this.action({ action: "heartbeat", lease, leaseMs });
  }

  isCancellationRequested(lease: RunLease): Promise<boolean> {
    return this.action({ action: "cancellation", lease });
  }

  async saveCheckpoint(
    lease: RunLease,
    checkpoint: Omit<PersistedCheckpoint, "createdAt">,
  ): Promise<void> {
    await this.action({ action: "save_checkpoint", lease, checkpoint });
  }

  async appendEvent(
    lease: RunLease,
    event: { sequence: number; eventType: string; payload: Record<string, unknown> },
  ): Promise<void> {
    await this.action({ action: "append_event", lease, event });
  }

  async transition(lease: RunLease, transition: RunTransition): Promise<void> {
    await this.action({ action: "transition", lease, transition });
  }
}

export class HttpRuntimeToolClient implements RuntimeToolClient {
  private readonly http: InternalHttpClient;

  constructor(options: HttpClientOptions) {
    this.http = new InternalHttpClient(options);
  }

  listTools(delegationToken: string, signal?: AbortSignal): Promise<ToolDefinition[]> {
    return this.http.request<ToolDefinition[]>("/api/internal/agent/tools", {
      method: "POST",
      body: JSON.stringify({ action: "list", delegationToken }),
      signal,
    });
  }

  invoke(input: {
    delegationToken: string;
    tool: string;
    toolInput: Record<string, unknown>;
    requestId: string;
    signal?: AbortSignal;
  }): Promise<unknown> {
    return this.http.request("/api/internal/agent/tools", {
      method: "POST",
      body: JSON.stringify({
        action: "invoke",
        delegationToken: input.delegationToken,
        tool: input.tool,
        toolInput: input.toolInput,
        requestId: input.requestId,
      }),
      signal: input.signal,
    });
  }
}
