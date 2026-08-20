import type { PermissionCode } from "@/lib/constants";
import type { SessionUser } from "@/lib/rbac";
import type {
  BomGetRisksInput,
  ChangeGetImpactInput,
  DocumentSearchInput,
  EvidenceRef,
  MilestoneListInput,
  MemberGetWorkloadInput,
  OrgGetTreeInput,
  OrgListMembersInput,
  ProjectResolveInput,
  ReportGenerateWeeklyInput,
  TaskGetDependenciesInput,
  TaskListInput,
  TaskUpdateProposalInput,
  ToolErrorCode,
  ToolExecutionContext,
  ToolName,
  ToolWarning,
} from "@/lib/agent/tools/contracts";

export type ToolStatus = "enabled" | "disabled" | "data_not_ready";

export interface ProjectCandidateRecord {
  id: string;
  code: string;
  name: string;
  status: "active" | "completed" | "archived";
  lifecycleStage: string;
  updatedAt: Date;
  matchedBy: "context" | "code" | "exact_name" | "partial_name";
}

export interface ProjectSummaryRecord {
  project: {
    id: string;
    code: string;
    name: string;
    status: string;
    lifecycleStage: string;
    owner: { id: string; name: string } | null;
    startDate: Date | null;
    endDate: Date | null;
    updatedAt: Date;
  };
  completedTasks: number;
  totalTasks: number;
  blockedTaskCount: number;
  overdueTaskCount: number;
  delayedBomCount: number;
  openTasks: number;
  milestonesPending: number;
  submittedEcr: number;
  pendingEco: number;
  upcomingMilestones: Array<{ id: string; name: string; date: Date; status: string }>;
}

export interface TaskRecord {
  id: string;
  projectId: string;
  title: string;
  status: "To Do" | "In Progress" | "Blocked" | "Testing" | "Done";
  priority: "P0" | "P1" | "P2" | "P3";
  assignee: { id: string; name: string } | null;
  phase: { id: string; name: string } | null;
  startDate: Date | null;
  dueDate: Date | null;
  estimatedHours: number | null;
  updatedAt: Date;
}

export interface TaskDependencyRecord {
  rootTaskId: string;
  projectId: string;
  nodes: Array<{
    id: string;
    title: string;
    status: string;
    startDate: Date | null;
    dueDate: Date | null;
    updatedAt: Date;
  }>;
  edges: Array<{
    id: string;
    predecessorId: string;
    successorId: string;
    type: string;
    lagDays: number;
    dateConflict: boolean;
  }>;
  truncated: boolean;
}

export interface MilestoneRecord {
  id: string;
  projectId: string;
  phaseId: string | null;
  name: string;
  date: Date;
  status: "pending" | "done" | "missed";
}

export interface BomRiskRecord {
  id: string;
  projectId: string;
  mpn: string;
  name: string;
  status: string;
  quantity: number;
  isCritical: boolean;
  eta: Date | null;
  phaseId: string | null;
  updatedAt: Date;
  reasonCodes: Array<"delayed" | "critical_not_arrived" | "eta_overdue" | "eta_within_window">;
}

export interface BomRiskPage {
  kitRate: {
    totalItemRows: number;
    arrivedItemRows: number;
    percent: number;
    assemblyReady: boolean;
    byStatus: Record<string, number>;
  };
  risks: BomRiskRecord[];
  hasMore: boolean;
  nextCursorId?: string;
}

export interface ChangeImpactRecord {
  change: {
    id: string;
    type: "ECR" | "ECO";
    number: string;
    projectId: string;
    title: string | null;
    status: string;
    changeCategory: string;
    reason: string | null;
    versionFrom: string | null;
    versionTo: string | null;
    sourceEcr?: { id: string; number: string } | null;
    convertedEco?: { id: string; number: string } | null;
  };
  impacts: Array<{
    impactId: string;
    entityType: "BOM_ITEM" | "TASK" | "TECH_SPEC" | "PRODUCT";
    entityId: string;
    label: string | null;
    note: string | null;
  }>;
  approvals: Array<{ action: string; approverName: string; comment: string | null; createdAt: Date }>;
}

export interface DocumentSearchRecord {
  documentId: string;
  projectId: string | null;
  title: string;
  category: string | null;
  documentVersion: number;
  chunkId: string;
  sectionPath: string[];
  contentText: string;
  score: number;
  indexVersion: string;
  promptInjectionDetected: boolean;
  updatedAt: Date;
}

export interface PageResult<T> {
  items: T[];
  hasMore: boolean;
  nextCursorId?: string;
}

export interface DocumentSearchPage extends PageResult<DocumentSearchRecord> {
  indexLagCount: number;
  oldestPendingAt: Date | null;
}

export interface WeeklyReportRecord {
  project: { id: string; code: string; name: string; updatedAt: Date };
  progress: { completedTasks: number; totalTasks: number };
  completedTasks: Array<{
    eventId: string;
    taskId: string;
    title: string;
    assigneeName: string | null;
    completedAt: Date;
  }>;
  openRisks: Array<{
    code: "blocked_task" | "overdue_task" | "delayed_bom" | "missed_milestone";
    severity: "warning" | "critical";
    entityType: "TASK" | "BOM_ITEM" | "MILESTONE";
    entityId: string;
    summary: string;
    updatedAt: Date;
  }>;
  upcomingMilestones: Array<{ id: string; name: string; date: Date; status: string }>;
  bom: { kitRatePercent: number; riskCount: number };
  changes: Array<{
    eventId: string;
    id: string;
    type: "ECR" | "ECO";
    number: string;
    action: string;
    occurredAt: Date;
  }>;
  activityEventCount: number;
  malformedActivityCount: number;
  activityTruncated: boolean;
}

export interface OrgUnitNodeRecord {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  manager: { id: string; name: string } | null;
  activeMemberCount: number;
  status: "active" | "inactive";
  updatedAt: Date;
}

export interface OrgMemberRecord {
  userId: string;
  name: string;
  orgUnitId: string;
  orgUnitName: string;
  positionName: string | null;
  managerId: string | null;
  status: "active" | "inactive";
  createdAt: Date;
}

export interface MemberWorkloadRecord {
  userId: string;
  name: string;
  openTaskCount: number;
  openEstimatedHours: number;
  loggedHoursInWindow: number;
  capacityHoursInWindow: number | null;
  plannedHoursInWindow: number | null;
  utilizationPercent: number | null;
  dataQuality: "complete" | "partial" | "insufficient";
  missingFields: Array<"weekly_capacity_hours" | "published_plan_window" | "ambiguous_plan_window" | "zero_capacity">;
  taskDetails?: Array<{
    taskId: string;
    title: string;
    projectId: string;
    status: string;
    estimatedHours: number | null;
    plannedHoursInWindow: number;
  }>;
  snapshotAt: Date;
}

export interface AuthorizedWorkloadScope {
  userIds: string[];
  projectId?: string;
  orgUnitIds: string[];
  permissionsApplied: string[];
}

export interface ToolReadDataSource {
  resolveProjects(
    input: ProjectResolveInput & { visibleProjectIds: string[] | null },
  ): Promise<ProjectCandidateRecord[]>;
  getProjectSummary(projectId: string, asOf: Date): Promise<ProjectSummaryRecord | null>;
  listTasks(
    input: TaskListInput & { asOf: Date; dueFromDate?: Date; dueToDate?: Date; cursorId?: string },
  ): Promise<PageResult<TaskRecord>>;
  getTaskProjectId(taskId: string): Promise<string | null>;
  getTaskDependencies(input: TaskGetDependenciesInput, maxNodes: number): Promise<TaskDependencyRecord | null>;
  listMilestones(
    input: MilestoneListInput & { asOf: Date; dateFromDate?: Date; dateToDate?: Date; cursorId?: string },
  ): Promise<PageResult<MilestoneRecord>>;
  getBomRisks(
    input: BomGetRisksInput & { asOf: Date; cursorId?: string },
  ): Promise<BomRiskPage>;
  getChangeImpact(
    input: ChangeGetImpactInput & { visibleProjectIds: string[] | null },
  ): Promise<ChangeImpactRecord | null>;
  searchDocuments(
    input: DocumentSearchInput & { visibleProjectIds: string[] | null; cursorId?: string },
  ): Promise<DocumentSearchPage>;
  getWeeklyReport(
    input: ReportGenerateWeeklyInput & { periodStart: Date; periodEndExclusive: Date; asOf: Date },
  ): Promise<WeeklyReportRecord | null>;
  getOrgTree(input: OrgGetTreeInput & { visibleOrgUnitIds: string[] | null }): Promise<OrgUnitNodeRecord[]>;
  listOrgMembers(
    input: OrgListMembersInput & { visibleOrgUnitIds: string[] | null; cursorId?: string },
  ): Promise<PageResult<OrgMemberRecord>>;
  getMemberWorkloads(input: {
    userIds: string[];
    projectId?: string;
    dateFrom: Date;
    dateTo: Date;
    loggedFrom: Date;
    loggedToExclusive: Date;
    workingDays: number;
    includeTaskDetails: boolean;
    asOf: Date;
  }): Promise<MemberWorkloadRecord[]>;
}

export interface ToolAuthorizer {
  resolveSubject(sessionSubject: string): Promise<SessionUser>;
  visibleProjectIds(user: SessionUser): Promise<string[] | null>;
  visibleOrgUnitIds(user: SessionUser): Promise<string[] | null>;
  authorizeWorkloadScope(user: SessionUser, input: MemberGetWorkloadInput): Promise<AuthorizedWorkloadScope>;
  assertPermissions(user: SessionUser, permissions: readonly PermissionCode[], projectId?: string): Promise<void>;
}

export interface ToolAuditEvent {
  runId: string;
  requestId: string;
  traceId: string;
  tool: ToolName;
  contractVersion: "1.0";
  status: "SUCCEEDED" | "FAILED";
  inputHash: string;
  projectIds: string[];
  evidenceIds: string[];
  errorCode?: ToolErrorCode;
  durationMs: number;
}

export interface ToolAuditSink {
  record(event: ToolAuditEvent): Promise<void>;
}

export interface TaskUpdateProposalRecord {
  proposalId: string;
  approvalRequestId: string;
  actionType: "TASK_UPDATE_LOW_RISK";
  status: "PENDING" | "APPROVED" | "EXPIRED" | "CANCELLED" | "EXECUTED" | "REJECTED" | "CONFLICT" | "FAILED";
  riskLevel: "LOW";
  target: { taskId: string; projectId: string; title: string };
  before: Record<string, string | number | null>;
  after: Record<string, string | number | null>;
  expectedVersion: string;
  expiresAt: string;
  confirmationRequired: true;
  executionToolExposedToModel: false;
}

export interface ToolActionProposalService {
  proposeTaskUpdate(
    input: TaskUpdateProposalInput,
    context: ToolExecutionContext,
    user: SessionUser,
  ): Promise<{ proposal: TaskUpdateProposalRecord; permissionsApplied: string[] }>;
}

export interface CursorPosition {
  id: string;
}

export interface ToolHandlerInvocation<TInput> {
  input: TInput;
  context: ToolExecutionContext;
  user: SessionUser;
  asOf: Date;
  cursorPosition?: CursorPosition;
}

export interface ToolPageOutcome {
  limit: number;
  hasMore: boolean;
  lastId?: string;
}

export interface ToolHandlerOutcome<TData> {
  data: TData;
  evidence: EvidenceRef[];
  projectIds: string[];
  orgUnitIds?: string[];
  permissionsApplied: string[];
  redactions: string[];
  warnings: ToolWarning[];
  page?: ToolPageOutcome;
}

export type ToolHandler<TInput, TData> = (
  invocation: ToolHandlerInvocation<TInput>,
) => Promise<ToolHandlerOutcome<TData>>;

export interface ToolDependencies {
  dataSource: ToolReadDataSource;
  authorizer: ToolAuthorizer;
  auditSink: ToolAuditSink;
  actionProposalService?: ToolActionProposalService;
  cursorSecret: string;
  clock?: () => Date;
}
