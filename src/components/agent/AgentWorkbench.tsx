"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Alert,
  App,
  Badge,
  Button,
  Card,
  Checkbox,
  Col,
  Empty,
  Flex,
  Form,
  Input,
  List,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import {
  CloseCircleOutlined,
  LinkOutlined,
  ReloadOutlined,
  RobotOutlined,
  SendOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { get, post } from "@/lib/api-client";

interface AgentStatus {
  enabled: boolean;
  operational: boolean;
  maintenanceMessage: string | null;
  disabledToolCount: number;
}

interface RunListItem {
  id: string;
  sessionId: string;
  status: string;
  currentNode: string | null;
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  question: string;
}

interface Evidence {
  evidenceId: string;
  entityType: string;
  label: string;
  uri?: string;
  excerpt?: string;
  version: { type: string; value: string };
}

interface ToolResult {
  tool: string;
  ok: boolean;
  asOf: string | null;
  evidence: Evidence[];
  warnings: Array<{ code: string; message: string }>;
  scope: { projectIds: string[]; permissionsApplied: string[]; redactions: string[] } | null;
  error: { code: string; message: string; retryable: boolean } | null;
}

interface RunDetail extends RunListItem {
  messages: Array<{ id: string; sequence: number; role: string; content: string | null; createdAt: string }>;
  events: Array<{ sequence: number; eventType: string; createdAt: string }>;
  toolResults: ToolResult[];
  actionProposals: ActionProposal[];
  clarification: string | null;
  canCancel: boolean;
  canResume: boolean;
  canRetry: boolean;
}

interface ActionProposal {
  id: string;
  runId: string;
  status: string;
  actionType: string;
  riskLevel: string;
  target: { taskId: string; projectId: string; title: string };
  before: Record<string, string | number | null>;
  after: Record<string, string | number | null>;
  reason: string | null;
  expectedVersion: string;
  expiresAt: string;
  createdAt: string;
  decidedAt: string | null;
  executedAt: string | null;
  canExecute: boolean;
  approvalToken: string | null;
  confirmationText: "确认执行";
  readback: unknown;
  failure: { code: string; message: string } | null;
}

interface ProjectOption {
  id: string;
  name: string;
  code: string;
}

const STATUS: Record<string, { label: string; color: string; badge: "default" | "processing" | "success" | "error" | "warning" }> = {
  QUEUED: { label: "排队中", color: "blue", badge: "processing" },
  RUNNING: { label: "运行中", color: "processing", badge: "processing" },
  WAITING_FOR_USER: { label: "等待补充", color: "gold", badge: "warning" },
  SUCCEEDED: { label: "已完成", color: "green", badge: "success" },
  FAILED: { label: "失败", color: "red", badge: "error" },
  CANCELLED: { label: "已取消", color: "default", badge: "default" },
  EXPIRED: { label: "已超时", color: "orange", badge: "warning" },
};

function statusInfo(status: string) {
  return STATUS[status] ?? { label: status, color: "default", badge: "default" as const };
}

function latestAssistant(detail: RunDetail | null): string | null {
  if (!detail) return null;
  return [...detail.messages].reverse().find((item) => item.role === "assistant")?.content ?? null;
}

function RunEvidence({ results }: { results: ToolResult[] }) {
  const evidence = results.flatMap((result) => result.evidence.map((item) => ({ ...item, tool: result.tool, asOf: result.asOf })));
  const warnings = results.flatMap((result) => result.warnings);
  const redactions = Array.from(new Set(results.flatMap((result) => result.scope?.redactions ?? [])));
  if (results.length === 0) return null;
  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Typography.Title level={5} style={{ margin: 0 }}>依据与数据范围</Typography.Title>
      {warnings.map((warning, index) => (
        <Alert key={`${warning.code}-${index}`} type="warning" showIcon message={warning.message} />
      ))}
      {redactions.length > 0 && (
        <Alert type="info" showIcon message={`已按权限裁剪：${redactions.join("；")}`} />
      )}
      <List
        size="small"
        locale={{ emptyText: "本次回答没有可引用实体" }}
        dataSource={evidence}
        renderItem={(item) => (
          <List.Item>
            <List.Item.Meta
              title={
                item.uri ? (
                  <Link href={item.uri}><LinkOutlined /> {item.label}</Link>
                ) : (
                  item.label
                )
              }
              description={
                <Space direction="vertical" size={0}>
                  <Typography.Text type="secondary">
                    {item.entityType} · {item.tool} · 截止 {item.asOf ? dayjs(item.asOf).format("YYYY-MM-DD HH:mm:ss") : "未知"}
                  </Typography.Text>
                  {item.excerpt && <Typography.Text>{item.excerpt}</Typography.Text>}
                </Space>
              }
            />
          </List.Item>
        )}
      />
    </Space>
  );
}

const ACTION_FIELD_LABELS: Record<string, string> = {
  description: "任务描述",
  priority: "优先级",
  dueDate: "截止日期",
  estimatedHours: "预估工时",
};

function actionValue(value: string | number | null): string {
  if (value === null || value === "") return "（空）";
  return String(value);
}

function ActionProposalCard({
  proposal,
  busy,
  onExecute,
  onCancel,
}: {
  proposal: ActionProposal;
  busy: boolean;
  onExecute: (proposal: ActionProposal) => Promise<void>;
  onCancel: (proposal: ActionProposal) => Promise<void>;
}) {
  const [reviewed, setReviewed] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const pending = proposal.status === "PENDING";
  const fields = Object.keys(proposal.after);
  const statusColor = proposal.status === "EXECUTED" ? "green" : pending ? "gold" : proposal.status === "CANCELLED" ? "default" : "red";
  return (
    <Card
      size="small"
      title={<Space wrap><span>待确认动作</span><Tag color={statusColor}>{proposal.status}</Tag><Tag color="blue">风险：{proposal.riskLevel}</Tag></Space>}
      aria-label={`任务更新动作 ${proposal.status}`}
    >
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Alert
          type={proposal.status === "EXECUTED" ? "success" : pending ? "warning" : "info"}
          showIcon
          message={proposal.status === "EXECUTED" ? "动作已执行并完成回读" : pending ? "尚未写入 PLM，请逐字段复核" : `动作未执行：${proposal.status}`}
          description={proposal.failure?.message ?? `提议在 ${dayjs(proposal.expiresAt).format("YYYY-MM-DD HH:mm:ss")} 过期`}
        />
        <div>
          <Typography.Text type="secondary">目标任务</Typography.Text><br />
          <Link href={`/projects/${proposal.target.projectId}/tasks`}><LinkOutlined /> {proposal.target.title}</Link>
        </div>
        {proposal.reason && <Typography.Paragraph style={{ marginBottom: 0 }}>提议原因：{proposal.reason}</Typography.Paragraph>}
        <div role="table" aria-label="动作字段差异">
          <Row gutter={[8, 8]} style={{ fontWeight: 600, marginBottom: 4 }}>
            <Col xs={6}>字段</Col><Col xs={9}>当前值</Col><Col xs={9}>拟更新值</Col>
          </Row>
          {fields.map((field) => (
            <Row gutter={[8, 8]} key={field} style={{ padding: "6px 0", borderTop: "1px solid #f0f0f0" }}>
              <Col xs={6}><Typography.Text>{ACTION_FIELD_LABELS[field] ?? field}</Typography.Text></Col>
              <Col xs={9}><Typography.Text type="secondary" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{actionValue(proposal.before[field])}</Typography.Text></Col>
              <Col xs={9}><Typography.Text strong style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{actionValue(proposal.after[field])}</Typography.Text></Col>
            </Row>
          ))}
        </div>
        <Typography.Text type="secondary">预期版本：{proposal.expectedVersion}</Typography.Text>
        {pending && (
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <Checkbox checked={reviewed} onChange={(event) => setReviewed(event.target.checked)}>
              我已核对目标任务、字段差异和风险等级
            </Checkbox>
            <Input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={`输入“${proposal.confirmationText}”`}
              maxLength={20}
              aria-label="动作确认短语"
            />
            {!proposal.canExecute && <Alert type="error" showIcon message="当前无法签发一次性确认授权，请联系管理员检查 Action Agent 密钥。" />}
            <Flex gap={8} justify="end" wrap="wrap">
              <Button onClick={() => void onCancel(proposal)} disabled={busy}>取消提议</Button>
              <Button
                type="primary"
                danger
                loading={busy}
                disabled={!proposal.canExecute || !reviewed || confirmation !== proposal.confirmationText}
                onClick={() => void onExecute(proposal)}
              >
                确认并执行一次
              </Button>
            </Flex>
          </Space>
        )}
      </Space>
    </Card>
  );
}

export default function AgentWorkbench() {
  const { message } = App.useApp();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialProjectId = searchParams.get("projectId") ?? undefined;
  const initialQuestion = searchParams.get("question") ?? "";
  const requestedRunId = searchParams.get("runId") ?? undefined;
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState<string | undefined>(initialProjectId);
  const [question, setQuestion] = useState(initialQuestion);
  const [clarification, setClarification] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [streamRevision, setStreamRevision] = useState(0);
  const eventSourceRef = useRef<EventSource | null>(null);

  const loadRuns = useCallback(async (preferRunId?: string) => {
    const items = await get<RunListItem[]>("/api/agent/runs?take=50");
    setRuns(items);
    setSelectedRunId((current) => {
      const candidate = preferRunId ?? current;
      return candidate && items.some((item) => item.id === candidate) ? candidate : items[0]?.id ?? null;
    });
  }, []);

  const loadDetail = useCallback(async (runId: string) => {
    const value = await get<RunDetail>(`/api/agent/runs/${runId}`);
    setDetail(value);
    return value;
  }, []);

  useEffect(() => {
    const loadStatus = () => get<AgentStatus>("/api/agent/status").then(setStatus);
    Promise.all([
      loadStatus(),
      get<ProjectOption[]>("/api/projects").then(setProjects).catch(() => undefined),
      loadRuns(requestedRunId),
    ])
      .catch((error: Error) => message.error(error.message))
      .finally(() => setLoading(false));
    const timer = window.setInterval(() => {
      loadStatus().catch(() => undefined);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [loadRuns, message, requestedRunId]);

  useEffect(() => {
    eventSourceRef.current?.close();
    if (!selectedRunId) {
      setDetail(null);
      return;
    }
    let disposed = false;
    loadDetail(selectedRunId).catch((error: Error) => message.error(error.message));
    const stream = new EventSource(`/api/agent/runs/${selectedRunId}/events`);
    eventSourceRef.current = stream;
    const refresh = () => {
      if (disposed) return;
      Promise.all([loadDetail(selectedRunId), loadRuns(selectedRunId)]).catch(() => undefined);
    };
    stream.addEventListener("run-event", refresh);
    stream.addEventListener("run-status", (event) => {
      refresh();
      try {
        const update = JSON.parse((event as MessageEvent<string>).data) as { status?: string };
        if (update.status && ["WAITING_FOR_USER", "SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"].includes(update.status)) {
          stream.close();
        }
      } catch {
        // 状态事件解析失败时保持连接，详情 API 仍会执行契约校验。
      }
    });
    stream.addEventListener("stream-error", () => stream.close());
    return () => {
      disposed = true;
      stream.close();
    };
  }, [loadDetail, loadRuns, message, selectedRunId, streamRevision]);

  const submitQuestion = async () => {
    if (!question.trim()) return;
    setSubmitting(true);
    try {
      const created = await post<RunListItem>("/api/agent/runs", {
        question: question.trim(),
        projectId,
        idempotencyKey: crypto.randomUUID(),
      });
      setQuestion("");
      await loadRuns(created.id);
      router.replace(`/agent?runId=${encodeURIComponent(created.id)}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ""}`);
      message.success("问题已进入安全执行队列");
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async () => {
    if (!detail) return;
    await post(`/api/agent/runs/${detail.id}/cancel`);
    await Promise.all([loadDetail(detail.id), loadRuns(detail.id)]);
    message.success(detail.status === "RUNNING" ? "已请求取消" : "已取消");
  };

  const resume = async () => {
    if (!detail || !clarification.trim()) return;
    setSubmitting(true);
    try {
      await post(`/api/agent/runs/${detail.id}/resume`, { message: clarification.trim() });
      setClarification("");
      await Promise.all([loadDetail(detail.id), loadRuns(detail.id)]);
      setStreamRevision((value) => value + 1);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const retry = async () => {
    if (!detail) return;
    setSubmitting(true);
    try {
      const created = await post<RunListItem>(`/api/agent/runs/${detail.id}/retry`);
      await loadRuns(created.id);
      message.success("已创建新的重试 Run，原记录保持不变");
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const executeAction = async (proposal: ActionProposal) => {
    if (!detail || !proposal.approvalToken) return;
    setSubmitting(true);
    try {
      await post(`/api/agent/actions/${proposal.id}/execute`, {
        approvalToken: proposal.approvalToken,
        confirmationText: proposal.confirmationText,
        expectedVersion: proposal.expectedVersion,
      });
      await Promise.all([loadDetail(detail.id), loadRuns(detail.id)]);
      message.success("动作已执行，回读与审计已写入");
    } catch (error) {
      await loadDetail(detail.id).catch(() => undefined);
      message.error((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const cancelAction = async (proposal: ActionProposal) => {
    if (!detail) return;
    setSubmitting(true);
    try {
      await post(`/api/agent/actions/${proposal.id}/cancel`);
      await loadDetail(detail.id);
      message.success("动作提议已取消，业务数据未改写");
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const active = detail && ["QUEUED", "RUNNING"].includes(detail.status);
  const answer = latestAssistant(detail);
  const selectedProject = useMemo(() => projects.find((project) => project.id === projectId), [projectId, projects]);

  if (loading) return <Flex justify="center" style={{ padding: 80 }}><Spin size="large" /></Flex>;

  return (
    <main aria-labelledby="agent-title">
      <Flex justify="space-between" align="center" wrap="wrap" gap={12} style={{ marginBottom: 16 }}>
        <div>
          <Typography.Title id="agent-title" level={3} style={{ margin: 0 }}><RobotOutlined /> PLM 企业研发智能体</Typography.Title>
          <Typography.Text type="secondary">只读查询 · 受控动作提议 · 人工确认 · 全链路审计</Typography.Text>
        </div>
        <Badge
          status={status?.operational ? "success" : "error"}
          text={status?.operational ? "服务可用" : "服务暂停"}
        />
      </Flex>

      {!status?.operational && (
        <Alert
          type="warning"
          showIcon
          message="企业智能体当前不可用"
          description={status?.maintenanceMessage ?? "系统管理员尚未启用，或运行配置未就绪。PLM 其他功能不受影响。"}
          style={{ marginBottom: 16 }}
        />
      )}

      <Card size="small" title="提出研发问题" style={{ marginBottom: 16 }}>
        <Form layout="vertical" onFinish={submitQuestion}>
          <Row gutter={12}>
            <Col xs={24} md={7}>
              <Form.Item label="项目上下文（可选）" style={{ marginBottom: 8 }}>
                <Select
                  showSearch
                  allowClear
                  value={projectId}
                  onChange={setProjectId}
                  optionFilterProp="label"
                  placeholder="跨可见项目或选择一个项目"
                  options={projects.map((project) => ({ value: project.id, label: `${project.code} ${project.name}` }))}
                  aria-label="项目上下文"
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={17}>
              <Form.Item label="问题" style={{ marginBottom: 8 }}>
                <Input.TextArea
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  autoSize={{ minRows: 2, maxRows: 6 }}
                  maxLength={2_000}
                  showCount
                  placeholder={selectedProject ? `询问 ${selectedProject.code} 的进度、风险、BOM 或变更…` : "例如：我可见项目中有哪些阻塞任务？"}
                  aria-label="研发问题"
                  onPressEnter={(event) => {
                    if (!event.shiftKey) {
                      event.preventDefault();
                      void submitQuestion();
                    }
                  }}
                />
              </Form.Item>
            </Col>
          </Row>
          <Flex justify="space-between" align="center" wrap="wrap" gap={8}>
            <Typography.Text type="secondary">请勿输入密码、令牌或不必要的个人敏感信息。Enter 发送，Shift+Enter 换行。</Typography.Text>
            <Button type="primary" htmlType="submit" icon={<SendOutlined />} loading={submitting} disabled={!status?.operational || !question.trim()}>
              安全运行
            </Button>
          </Flex>
        </Form>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={8} xl={7}>
          <Card size="small" title="我的会话" styles={{ body: { padding: 0 } }}>
            <List
              className="agent-run-list"
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有运行记录" /> }}
              dataSource={runs}
              renderItem={(run) => {
                const info = statusInfo(run.status);
                return (
                  <List.Item
                    className={selectedRunId === run.id ? "agent-run-selected" : ""}
                    onClick={() => setSelectedRunId(run.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") setSelectedRunId(run.id);
                    }}
                    tabIndex={0}
                    role="button"
                    aria-current={selectedRunId === run.id ? "true" : undefined}
                  >
                    <List.Item.Meta
                      title={<Typography.Text ellipsis>{run.question || "未命名问题"}</Typography.Text>}
                      description={<Space><Badge status={info.badge} />{info.label}<span>{dayjs(run.createdAt).format("MM-DD HH:mm")}</span></Space>}
                    />
                  </List.Item>
                );
              }}
            />
          </Card>
        </Col>
        <Col xs={24} lg={16} xl={17}>
          <Card
            size="small"
            title={detail ? <Space><span>运行详情</span><Tag color={statusInfo(detail.status).color}>{statusInfo(detail.status).label}</Tag></Space> : "运行详情"}
            extra={
              detail && (
                <Space wrap>
                  {detail.canCancel && <Button danger icon={<CloseCircleOutlined />} onClick={() => void cancel()}>取消</Button>}
                  {detail.canRetry && <Button icon={<ReloadOutlined />} loading={submitting} disabled={!status?.operational} onClick={() => void retry()}>安全重试</Button>}
                </Space>
              )
            }
            aria-live="polite"
          >
            {!detail ? (
              <Empty description="选择一个运行查看回答和依据" />
            ) : (
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <div>
                  <Typography.Text type="secondary">问题</Typography.Text>
                  <Typography.Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>
                    {detail.messages.find((item) => item.role === "user")?.content}
                  </Typography.Paragraph>
                </div>
                {active && <Alert type="info" showIcon message="智能体正在处理" description={`当前节点：${detail.currentNode ?? "准备中"}。页面会通过事件流自动更新。`} />}
                {detail.status === "FAILED" && <Alert type="error" showIcon message="运行失败" description={detail.failureCode ?? "请联系管理员并提供 Run ID"} />}
                {detail.canResume && (
                  <Card size="small" title="需要你补充信息">
                    <Typography.Paragraph>{detail.clarification ?? answer ?? "请补充更明确的项目或对象。"}</Typography.Paragraph>
                    <Flex gap={8} align="start" wrap="wrap">
                      <Input.TextArea
                        value={clarification}
                        onChange={(event) => setClarification(event.target.value)}
                        maxLength={2_000}
                        autoSize={{ minRows: 2, maxRows: 5 }}
                        aria-label="补充信息"
                        style={{ flex: "1 1 320px" }}
                      />
                      <Button type="primary" onClick={() => void resume()} disabled={!status?.operational || !clarification.trim()} loading={submitting}>继续运行</Button>
                    </Flex>
                  </Card>
                )}
                {answer && detail.status === "SUCCEEDED" && (
                  <div className="markdown-body agent-answer">
                    <Typography.Text type="secondary">回答</Typography.Text>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
                  </div>
                )}
                {detail.actionProposals.map((proposal) => (
                  <ActionProposalCard
                    key={proposal.id}
                    proposal={proposal}
                    busy={submitting}
                    onExecute={executeAction}
                    onCancel={cancelAction}
                  />
                ))}
                <RunEvidence results={detail.toolResults} />
                <Typography.Text type="secondary" copyable={{ text: detail.id }}>Run ID：{detail.id}</Typography.Text>
              </Space>
            )}
          </Card>
        </Col>
      </Row>
    </main>
  );
}
