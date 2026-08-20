import { toJSONSchema, z } from "zod/v4";

export const TOOL_CONTRACT_VERSION = "1.0" as const;

export const TOOL_NAMES = [
  "plm_project_resolve",
  "plm_project_get_summary",
  "plm_task_list",
  "plm_task_get_dependencies",
  "plm_milestone_list",
  "plm_bom_get_risks",
  "plm_change_get_impact",
  "plm_document_search",
  "plm_org_get_tree",
  "plm_org_list_members",
  "plm_member_get_workload",
  "plm_report_generate_weekly",
  "plm_action_propose_task_update",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export const toolNameSchema = z.enum(TOOL_NAMES);
export const entityIdSchema = z.string().min(1).max(128);
export const cursorSchema = z.string().min(1).max(2_048);
export const dateOnlySchema = z.iso.date();
export const isoDateTimeSchema = z.iso.datetime({ offset: true });

export const toolExecutionContextSchema = z
  .object({
    runId: entityIdSchema,
    traceId: z.string().min(1).max(128),
    requestId: z.string().min(1).max(128),
    sessionSubject: z.string().min(1).max(256),
    issuedAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema,
    locale: z.string().min(2).max(35).default("zh-CN"),
    timezone: z.string().min(1).max(64).default("Asia/Shanghai"),
  })
  .strict();

export type ToolExecutionContext = z.infer<typeof toolExecutionContextSchema>;

export const toolErrorCodeSchema = z.enum([
  "validation_error",
  "auth_required",
  "auth_expired",
  "resource_not_accessible",
  "ambiguous_reference",
  "conflict",
  "tool_disabled",
  "data_not_ready",
  "rate_limited",
  "timeout",
  "dependency_unavailable",
  "internal_error",
]);

export type ToolErrorCode = z.infer<typeof toolErrorCodeSchema>;

export const toolWarningSchema = z
  .object({
    code: z.string().min(1).max(100),
    message: z.string().min(1).max(500),
    field: z.string().min(1).max(100).optional(),
  })
  .strict();

export const evidenceRefSchema = z
  .object({
    evidenceId: z.string().min(1).max(128),
    kind: z.enum(["entity", "aggregate", "document_chunk"]),
    entityType: z.enum([
      "PROJECT",
      "PHASE",
      "TASK",
      "MILESTONE",
      "BOM_ITEM",
      "TECH_SPEC",
      "ECR",
      "ECO",
      "DOCUMENT",
      "ORG_UNIT",
      "USER",
    ]),
    entityId: entityIdSchema.optional(),
    projectId: entityIdSchema.nullable().optional(),
    label: z.string().min(1).max(300),
    uri: z.string().startsWith("/").max(500).optional(),
    version: z
      .object({
        type: z.enum(["updated_at", "doc_version", "snapshot"]),
        value: z.string().min(1).max(100),
      })
      .strict(),
    excerpt: z.string().max(500).optional(),
  })
  .strict();

export const appliedScopeSchema = z
  .object({
    projectIds: z.array(entityIdSchema).max(100),
    orgUnitIds: z.array(entityIdSchema).max(100).optional(),
    permissionsApplied: z.array(z.string().min(1).max(100)).max(20),
    redactions: z.array(z.string().min(1).max(200)).max(50),
  })
  .strict();

export const pageInfoSchema = z
  .object({
    limit: z.number().int().min(1).max(100),
    hasMore: z.boolean(),
    nextCursor: cursorSchema.nullable(),
  })
  .strict();

const failureSchemaFor = (tool: ToolName) =>
  z
    .object({
      ok: z.literal(false),
      contractVersion: z.literal(TOOL_CONTRACT_VERSION),
      tool: z.literal(tool),
      requestId: z.string().min(1).max(128),
      traceId: z.string().min(1).max(128),
      error: z
        .object({
          code: toolErrorCodeSchema,
          message: z.string().min(1).max(500),
          retryable: z.boolean(),
          details: z
            .array(
              z
                .object({
                  field: z.string().min(1).max(100).optional(),
                  code: z.string().min(1).max(100),
                  message: z.string().min(1).max(300),
                })
                .strict(),
            )
            .max(50)
            .optional(),
        })
        .strict(),
      asOf: isoDateTimeSchema,
    })
    .strict();

export function toolOutputSchema<T extends z.ZodType>(tool: ToolName, data: T, pageable = false) {
  const success = z
    .object({
      ok: z.literal(true),
      contractVersion: z.literal(TOOL_CONTRACT_VERSION),
      tool: z.literal(tool),
      requestId: z.string().min(1).max(128),
      traceId: z.string().min(1).max(128),
      data,
      evidence: z.array(evidenceRefSchema).max(200),
      asOf: isoDateTimeSchema,
      scope: appliedScopeSchema,
      warnings: z.array(toolWarningSchema).max(50),
      ...(pageable ? { page: pageInfoSchema } : {}),
    })
    .strict();
  return z.union([success, failureSchemaFor(tool)]);
}

export const projectResolveInputSchema = z
  .object({
    query: z.string().trim().min(1).max(100),
    contextProjectId: entityIdSchema.optional(),
    limit: z.number().int().min(1).max(10).default(5),
  })
  .strict();

export const projectResolveDataSchema = z
  .object({
    resolution: z.enum(["exact", "single_candidate", "ambiguous", "not_found"]),
    candidates: z
      .array(
        z
          .object({
            id: entityIdSchema,
            code: z.string().min(1).max(100),
            name: z.string().min(1).max(300),
            status: z.enum(["active", "completed", "archived"]),
            lifecycleStage: z.string().min(1).max(100),
            matchedBy: z.enum(["context", "code", "exact_name", "partial_name"]),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();

export const projectGetSummaryInputSchema = z
  .object({
    projectId: entityIdSchema,
    include: z
      .array(z.enum(["progress", "health", "counts", "upcoming_milestones"]))
      .min(1)
      .max(4)
      .optional(),
  })
  .strict();

const projectSummaryProjectSchema = z
  .object({
    id: entityIdSchema,
    code: z.string(),
    name: z.string(),
    status: z.string(),
    lifecycleStage: z.string(),
    owner: z.object({ id: entityIdSchema, name: z.string() }).strict().nullable(),
    startDate: isoDateTimeSchema.nullable(),
    endDate: isoDateTimeSchema.nullable(),
  })
  .strict();

export const projectGetSummaryDataSchema = z
  .object({
    project: projectSummaryProjectSchema,
    progress: z
      .object({
        percent: z.number().int().min(0).max(100),
        completedTasks: z.number().int().nonnegative(),
        totalTasks: z.number().int().nonnegative(),
        calculationMethod: z.literal("done_task_count"),
        formula: z.literal("round(completedTasks / totalTasks * 100)"),
        emptyProjectValue: z.literal(0),
      })
      .strict()
      .optional(),
    health: z
      .object({
        level: z.enum(["green", "yellow", "red"]),
        ruleSetVersion: z.literal("project_health_v1"),
        blockedTaskCount: z.number().int().nonnegative(),
        overdueTaskCount: z.number().int().nonnegative(),
        delayedBomCount: z.number().int().nonnegative(),
        reasonCodes: z.array(z.enum(["blocked_tasks", "overdue_tasks", "delayed_bom"])),
      })
      .strict()
      .optional(),
    counts: z
      .object({
        openTasks: z.number().int().nonnegative(),
        milestonesPending: z.number().int().nonnegative(),
        submittedEcr: z.number().int().nonnegative(),
        pendingEco: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    upcomingMilestones: z
      .array(
        z
          .object({
            id: entityIdSchema,
            name: z.string(),
            date: isoDateTimeSchema,
            status: z.string(),
          })
          .strict(),
      )
      .max(20)
      .optional(),
  })
  .strict();

export const taskStatusSchema = z.enum(["To Do", "In Progress", "Blocked", "Testing", "Done"]);
export const taskPrioritySchema = z.enum(["P0", "P1", "P2", "P3"]);

export const taskListInputSchema = z
  .object({
    projectId: entityIdSchema,
    statuses: z.array(taskStatusSchema).min(1).max(5).optional(),
    priorities: z.array(taskPrioritySchema).min(1).max(4).optional(),
    phaseId: entityIdSchema.optional(),
    assigneeId: entityIdSchema.optional(),
    query: z.string().trim().min(1).max(100).optional(),
    overdueOnly: z.boolean().optional(),
    dueFrom: dateOnlySchema.optional(),
    dueTo: dateOnlySchema.optional(),
    updatedSince: isoDateTimeSchema.optional(),
    sort: z.enum(["due_date_asc", "priority_asc", "updated_at_desc"]).default("due_date_asc"),
    cursor: cursorSchema.optional(),
    limit: z.number().int().min(1).max(100).default(20),
  })
  .strict()
  .refine((value) => !value.dueFrom || !value.dueTo || value.dueFrom <= value.dueTo, {
    path: ["dueTo"],
    message: "dueTo 不能早于 dueFrom",
  });

export const taskListItemSchema = z
  .object({
    id: entityIdSchema,
    projectId: entityIdSchema,
    title: z.string(),
    status: taskStatusSchema,
    priority: taskPrioritySchema,
    assignee: z.object({ id: entityIdSchema, name: z.string() }).strict().nullable(),
    phase: z.object({ id: entityIdSchema, name: z.string() }).strict().nullable(),
    startDate: isoDateTimeSchema.nullable(),
    dueDate: isoDateTimeSchema.nullable(),
    estimatedHours: z.number().nonnegative().nullable(),
    isOverdue: z.boolean(),
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export const taskListDataSchema = z.object({ items: z.array(taskListItemSchema).max(100) }).strict();

export const taskGetDependenciesInputSchema = z
  .object({
    taskId: entityIdSchema,
    direction: z.enum(["predecessors", "successors", "both"]).default("both"),
    depth: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  })
  .strict();

export const taskDependencyDataSchema = z
  .object({
    rootTaskId: entityIdSchema,
    nodes: z
      .array(
        z
          .object({
            id: entityIdSchema,
            title: z.string(),
            status: z.string(),
            startDate: isoDateTimeSchema.nullable(),
            dueDate: isoDateTimeSchema.nullable(),
          })
          .strict(),
      )
      .max(200),
    edges: z
      .array(
        z
          .object({
            id: entityIdSchema,
            predecessorId: entityIdSchema,
            successorId: entityIdSchema,
            type: z.string().min(1).max(10),
            lagDays: z.number().int(),
            dateConflict: z.boolean(),
          })
          .strict(),
      )
      .max(400),
  })
  .strict();

export const milestoneListInputSchema = z
  .object({
    projectId: entityIdSchema,
    statuses: z.array(z.enum(["pending", "done", "missed"])).min(1).max(3).optional(),
    dateFrom: dateOnlySchema.optional(),
    dateTo: dateOnlySchema.optional(),
    cursor: cursorSchema.optional(),
    limit: z.number().int().min(1).max(100).default(20),
  })
  .strict()
  .refine((value) => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo, {
    path: ["dateTo"],
    message: "dateTo 不能早于 dateFrom",
  });

export const milestoneListDataSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: entityIdSchema,
            projectId: entityIdSchema,
            phaseId: entityIdSchema.nullable(),
            name: z.string(),
            date: isoDateTimeSchema,
            status: z.enum(["pending", "done", "missed"]),
            isOverdue: z.boolean(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

export const bomRiskTypeSchema = z.enum(["delayed", "critical_not_arrived", "eta_overdue", "eta_within_window"]);

export const bomGetRisksInputSchema = z
  .object({
    projectId: entityIdSchema,
    phaseId: entityIdSchema.optional(),
    riskTypes: z.array(bomRiskTypeSchema).min(1).max(4).optional(),
    windowDays: z.number().int().min(1).max(90).default(14),
    cursor: cursorSchema.optional(),
    limit: z.number().int().min(1).max(100).default(20),
  })
  .strict();

export const bomGetRisksDataSchema = z
  .object({
    kitRate: z
      .object({
        totalItemRows: z.number().int().nonnegative(),
        arrivedItemRows: z.number().int().nonnegative(),
        percent: z.number().min(0).max(100),
        assemblyReady: z.boolean(),
        calculationMethod: z.literal("arrived_row_count"),
        byStatus: z.record(z.string(), z.number().int().nonnegative()),
      })
      .strict(),
    risks: z
      .array(
        z
          .object({
            id: entityIdSchema,
            mpn: z.string(),
            name: z.string(),
            status: z.string(),
            quantity: z.number().int().nonnegative(),
            isCritical: z.boolean(),
            eta: isoDateTimeSchema.nullable(),
            phaseId: entityIdSchema.nullable(),
            reasonCodes: z.array(bomRiskTypeSchema).min(1).max(4),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

export const changeGetImpactInputSchema = z
  .object({
    changeRef: z.string().trim().min(1).max(100),
    changeType: z.enum(["ECR", "ECO", "AUTO"]).default("AUTO"),
    includeApprovals: z.boolean().default(true),
  })
  .strict();

export const changeGetImpactDataSchema = z
  .object({
    change: z
      .object({
        id: entityIdSchema,
        type: z.enum(["ECR", "ECO"]),
        number: z.string(),
        projectId: entityIdSchema,
        title: z.string().nullable(),
        status: z.string(),
        changeCategory: z.string(),
        reason: z.string().nullable(),
        versionFrom: z.string().nullable(),
        versionTo: z.string().nullable(),
        sourceEcr: z.object({ id: entityIdSchema, number: z.string() }).strict().nullable().optional(),
        convertedEco: z.object({ id: entityIdSchema, number: z.string() }).strict().nullable().optional(),
      })
      .strict(),
    impacts: z
      .array(
        z
          .object({
            impactId: entityIdSchema,
            entityType: z.enum(["BOM_ITEM", "TASK", "TECH_SPEC", "PRODUCT"]),
            entityId: entityIdSchema,
            label: z.string(),
            note: z.string().nullable(),
          })
          .strict(),
      )
      .max(200),
    approvals: z
      .array(
        z
          .object({
            action: z.string(),
            approverName: z.string(),
            comment: z.string().nullable(),
            createdAt: isoDateTimeSchema,
          })
          .strict(),
      )
      .max(200),
  })
  .strict();

export const documentSearchInputSchema = z
  .object({
    query: z.string().trim().min(2).max(500),
    projectId: entityIdSchema.optional(),
    includeShared: z.boolean().default(true),
    categories: z.array(z.string().trim().min(1).max(100)).min(1).max(20).optional(),
    tags: z.array(z.string().trim().min(1).max(100)).min(1).max(20).optional(),
    retrievalMode: z.enum(["auto", "lexical", "hybrid"]).default("auto"),
    cursor: cursorSchema.optional(),
    limit: z.number().int().min(1).max(30).default(10),
  })
  .strict();

export const documentSearchDataSchema = z
  .object({
    retrievalModeUsed: z.enum(["lexical", "hybrid"]),
    indexVersion: z.string().min(1).max(100),
    items: z
      .array(
        z
          .object({
            documentId: entityIdSchema,
            projectId: entityIdSchema.nullable(),
            title: z.string(),
            category: z.string().nullable(),
            documentVersion: z.number().int().positive(),
            chunkId: z.string().min(1).max(200),
            sectionPath: z.array(z.string().max(200)).max(20),
            excerpt: z.string().max(500),
            score: z.number().nullable(),
            updatedAt: isoDateTimeSchema,
          })
          .strict(),
      )
      .max(30),
  })
  .strict();

export const orgGetTreeInputSchema = z
  .object({
    rootOrgUnitId: entityIdSchema.optional(),
    depth: z.number().int().min(1).max(5).default(3),
    includeInactive: z.boolean().default(false),
  })
  .strict();

export const orgUnitNodeSchema = z
  .object({
    id: entityIdSchema,
    parentId: entityIdSchema.nullable(),
    code: z.string().min(1).max(100),
    name: z.string().min(1).max(300),
    manager: z.object({ id: entityIdSchema, name: z.string().min(1).max(300) }).strict().nullable(),
    activeMemberCount: z.number().int().nonnegative(),
    status: z.enum(["active", "inactive"]),
  })
  .strict();

export const orgGetTreeDataSchema = z.object({ nodes: z.array(orgUnitNodeSchema).max(100) }).strict();

export const orgListMembersInputSchema = z
  .object({
    orgUnitId: entityIdSchema,
    recursive: z.boolean().default(false),
    projectId: entityIdSchema.optional(),
    cursor: cursorSchema.optional(),
    limit: z.number().int().min(1).max(100).default(20),
  })
  .strict();

export const orgMemberSchema = z
  .object({
    userId: entityIdSchema,
    name: z.string().min(1).max(300),
    orgUnitId: entityIdSchema,
    orgUnitName: z.string().min(1).max(300),
    positionName: z.string().min(1).max(300).nullable(),
    managerId: entityIdSchema.nullable(),
    status: z.enum(["active", "inactive"]),
  })
  .strict();

export const orgListMembersDataSchema = z.object({ items: z.array(orgMemberSchema).max(100) }).strict();

export const workloadScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("users"), userIds: z.array(entityIdSchema).min(1).max(100) }).strict(),
  z.object({ type: z.literal("project"), projectId: entityIdSchema }).strict(),
  z.object({ type: z.literal("org_unit"), orgUnitId: entityIdSchema, recursive: z.boolean().default(false) }).strict(),
]);

export const memberGetWorkloadInputSchema = z
  .object({
    scope: workloadScopeSchema,
    dateFrom: dateOnlySchema,
    dateTo: dateOnlySchema,
    projectId: entityIdSchema.optional(),
    includeTaskDetails: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    const from = Date.parse(`${value.dateFrom}T00:00:00.000Z`);
    const to = Date.parse(`${value.dateTo}T00:00:00.000Z`);
    const days = Math.floor((to - from) / 86_400_000) + 1;
    if (days < 1) context.addIssue({ code: "custom", path: ["dateTo"], message: "dateTo 不能早于 dateFrom" });
    if (days > 92) context.addIssue({ code: "custom", path: ["dateTo"], message: "时间窗不能超过 92 天" });
    if (value.scope.type === "project" && value.projectId && value.projectId !== value.scope.projectId) {
      context.addIssue({ code: "custom", path: ["projectId"], message: "projectId 必须与 project scope 一致" });
    }
  });

export const workloadTaskDetailSchema = z
  .object({
    taskId: entityIdSchema,
    title: z.string().min(1).max(500),
    projectId: entityIdSchema,
    status: z.string().min(1).max(100),
    estimatedHours: z.number().nonnegative().nullable(),
    plannedHoursInWindow: z.number().nonnegative(),
  })
  .strict();

export const memberWorkloadSchema = z
  .object({
    userId: entityIdSchema,
    name: z.string().min(1).max(300),
    openTaskCount: z.number().int().nonnegative(),
    openEstimatedHours: z.number().nonnegative(),
    loggedHoursInWindow: z.number().nonnegative(),
    capacityHoursInWindow: z.number().nonnegative().nullable(),
    plannedHoursInWindow: z.number().nonnegative().nullable(),
    utilizationPercent: z.number().nonnegative().nullable(),
    dataQuality: z.enum(["complete", "partial", "insufficient"]),
    missingFields: z.array(z.enum(["weekly_capacity_hours", "published_plan_window", "ambiguous_plan_window", "zero_capacity"])),
    taskDetails: z.array(workloadTaskDetailSchema).max(20).optional(),
  })
  .strict();

export const memberGetWorkloadDataSchema = z
  .object({
    calculationMethod: z.literal("workload_v1"),
    rankingMetric: z.enum(["open_estimated_hours", "planned_hours_in_window", "none"]),
    period: z.object({ start: dateOnlySchema, end: dateOnlySchema, timezone: z.string().min(1).max(64), workingDays: z.number().int().nonnegative() }).strict(),
    members: z.array(memberWorkloadSchema).max(100),
  })
  .strict();

export const reportSectionSchema = z.enum([
  "progress",
  "completed",
  "risks",
  "milestones",
  "bom",
  "changes",
  "workload",
]);

export const reportGenerateWeeklyInputSchema = z
  .object({
    projectId: entityIdSchema,
    weekStart: dateOnlySchema,
    sections: z.array(reportSectionSchema).min(1).max(7).optional(),
    format: z.enum(["structured", "markdown"]).default("structured"),
  })
  .strict();

export const reportGenerateWeeklyDataSchema = z
  .object({
    period: z
      .object({ start: dateOnlySchema, end: dateOnlySchema, timezone: z.string().min(1).max(64) })
      .strict(),
    project: z.object({ id: entityIdSchema, code: z.string(), name: z.string() }).strict(),
    snapshot: z
      .object({
        progress: z
          .object({
            percent: z.number().int().min(0).max(100),
            completedTasks: z.number().int().nonnegative(),
            totalTasks: z.number().int().nonnegative(),
            calculationMethod: z.literal("done_task_count"),
          })
          .strict(),
        completedTasks: z
          .array(
            z
              .object({
                id: entityIdSchema,
                title: z.string(),
                assigneeName: z.string().nullable(),
                completedAt: isoDateTimeSchema,
              })
              .strict(),
          )
          .max(200),
        openRisks: z
          .array(
            z
              .object({
                code: z.enum(["blocked_task", "overdue_task", "delayed_bom", "missed_milestone"]),
                severity: z.enum(["warning", "critical"]),
                summary: z.string().max(1_000),
                evidenceIds: z.array(z.string().min(1).max(128)).max(20),
              })
              .strict(),
          )
          .max(200),
        upcomingMilestones: z
          .array(
            z
              .object({ id: entityIdSchema, name: z.string(), date: isoDateTimeSchema, status: z.string() })
              .strict(),
          )
          .max(100),
        bom: z
          .object({
            kitRatePercent: z.number().min(0).max(100),
            calculationMethod: z.literal("arrived_row_count"),
            riskCount: z.number().int().nonnegative(),
          })
          .strict()
          .nullable(),
        changes: z
          .array(
            z
              .object({
                id: entityIdSchema,
                type: z.enum(["ECR", "ECO"]),
                number: z.string(),
                action: z.string(),
                occurredAt: isoDateTimeSchema,
              })
              .strict(),
          )
          .max(200),
        workload: z
          .array(
            z
              .object({
                userId: entityIdSchema,
                name: z.string(),
                openEstimatedHours: z.number().nonnegative(),
                loggedHoursInWindow: z.number().nonnegative(),
                capacityHoursInWindow: z.number().nonnegative().nullable(),
                utilizationPercent: z.number().nonnegative().nullable(),
              })
              .strict(),
          )
          .max(200)
          .nullable(),
      })
      .strict(),
    draftMarkdown: z.string().max(50_000).nullable(),
    omittedSections: z
      .array(z.object({ section: reportSectionSchema, reason: z.string().min(1).max(500) }).strict())
      .max(20),
  })
  .strict();

export const taskUpdateProposalChangesSchema = z
  .object({
    description: z.string().trim().max(10_000).nullable().optional(),
    priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
    dueDate: dateOnlySchema.nullable().optional(),
    estimatedHours: z.number().finite().min(0).max(100_000).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "至少需要一个变更字段" });

export const taskUpdateProposalInputSchema = z
  .object({
    taskId: entityIdSchema,
    changes: taskUpdateProposalChangesSchema,
    reason: z.string().trim().min(1).max(500).optional(),
    idempotencyKey: z.string().min(8).max(128),
  })
  .strict();

const actionFieldValueSchema = z.union([z.string(), z.number(), z.null()]);

export const taskUpdateProposalDataSchema = z
  .object({
    proposalId: entityIdSchema,
    approvalRequestId: entityIdSchema,
    actionType: z.literal("TASK_UPDATE_LOW_RISK"),
    status: z.enum(["PENDING", "APPROVED", "EXPIRED", "CANCELLED", "EXECUTED", "REJECTED", "CONFLICT", "FAILED"]),
    riskLevel: z.literal("LOW"),
    target: z
      .object({ taskId: entityIdSchema, projectId: entityIdSchema, title: z.string().min(1).max(500) })
      .strict(),
    before: z.record(z.string(), actionFieldValueSchema),
    after: z.record(z.string(), actionFieldValueSchema),
    expectedVersion: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema,
    confirmationRequired: z.literal(true),
    executionToolExposedToModel: z.literal(false),
  })
  .strict();

export type ToolWarning = z.infer<typeof toolWarningSchema>;
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;
export type ProjectResolveInput = z.infer<typeof projectResolveInputSchema>;
export type ProjectGetSummaryInput = z.infer<typeof projectGetSummaryInputSchema>;
export type TaskListInput = z.infer<typeof taskListInputSchema>;
export type TaskGetDependenciesInput = z.infer<typeof taskGetDependenciesInputSchema>;
export type MilestoneListInput = z.infer<typeof milestoneListInputSchema>;
export type BomGetRisksInput = z.infer<typeof bomGetRisksInputSchema>;
export type ChangeGetImpactInput = z.infer<typeof changeGetImpactInputSchema>;
export type DocumentSearchInput = z.infer<typeof documentSearchInputSchema>;
export type OrgGetTreeInput = z.infer<typeof orgGetTreeInputSchema>;
export type OrgListMembersInput = z.infer<typeof orgListMembersInputSchema>;
export type MemberGetWorkloadInput = z.infer<typeof memberGetWorkloadInputSchema>;
export type WorkloadScope = z.infer<typeof workloadScopeSchema>;
export type ReportGenerateWeeklyInput = z.infer<typeof reportGenerateWeeklyInputSchema>;
export type TaskUpdateProposalInput = z.infer<typeof taskUpdateProposalInputSchema>;

export type JsonSchema = Record<string, unknown>;

export function schemaToJsonSchema(schema: z.ZodType, io: "input" | "output" = "input"): JsonSchema {
  return toJSONSchema(schema, { target: "draft-2020-12", io, reused: "ref" }) as JsonSchema;
}
