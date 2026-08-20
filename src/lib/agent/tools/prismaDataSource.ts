import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ToolInvocationError } from "@/lib/agent/tools/errors";
import type {
  BomRiskPage,
  ChangeImpactRecord,
  DocumentSearchPage,
  DocumentSearchRecord,
  PageResult,
  ProjectCandidateRecord,
  ProjectSummaryRecord,
  TaskDependencyRecord,
  ToolReadDataSource,
  WeeklyReportRecord,
} from "@/lib/agent/tools/types";
import { getKitRate } from "@/lib/services/bomService";
import { documentVisibilityScope, withDocumentScope } from "@/lib/services/documentScope";
import { AGENT_KNOWLEDGE_INDEX_VERSION } from "@/lib/agent/knowledge/indexer";
import { collectOrgSubtreeIds } from "@/lib/services/organizationScope";

const DAY_MS = 86_400_000;

function visibleProjectWhere(visibleProjectIds: string[] | null): Prisma.ProjectWhereInput {
  return visibleProjectIds === null ? {} : { id: { in: visibleProjectIds } };
}

function scopedProjectIdWhere(visibleProjectIds: string[] | null): Prisma.StringFilter | undefined {
  return visibleProjectIds === null ? undefined : { in: visibleProjectIds };
}

function lexicalTerms(query: string): string[] {
  const normalized = query.normalize("NFKC").toLocaleLowerCase().trim();
  const terms = normalized.split(/[\s,，。；;:：、/\\|()[\]{}]+/u).filter(Boolean);
  return Array.from(new Set(terms.length ? terms : [normalized])).slice(0, 8);
}

function jsonStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").slice(0, 20);
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function payloadString(payload: Record<string, unknown> | null, key: string): string | null {
  const value = payload?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeSummary(value: string): string {
  return Array.from(value.replace(/[\r\n]+/g, " ").trim()).slice(0, 1_000).join("");
}

function dateConflict(
  type: string,
  lagDays: number,
  predecessor: { startDate: Date | null; dueDate: Date | null },
  successor: { startDate: Date | null; dueDate: Date | null },
): boolean {
  const addLag = (value: Date | null) => (value ? new Date(value.getTime() + lagDays * DAY_MS) : null);
  const left = type === "SS" || type === "SF" ? addLag(predecessor.startDate) : addLag(predecessor.dueDate);
  const right = type === "FF" || type === "SF" ? successor.dueDate : successor.startDate;
  return Boolean(left && right && left > right);
}

export class PrismaToolReadDataSource implements ToolReadDataSource {
  async resolveProjects(
    input: Parameters<ToolReadDataSource["resolveProjects"]>[0],
  ): Promise<ProjectCandidateRecord[]> {
    const scope = visibleProjectWhere(input.visibleProjectIds);
    const candidates = new Map<string, ProjectCandidateRecord>();
    const add = (
      project: { id: string; code: string; name: string; status: string; lifecycleStage: string; updatedAt: Date },
      matchedBy: ProjectCandidateRecord["matchedBy"],
    ) => {
      if (candidates.has(project.id) || candidates.size >= input.limit) return;
      candidates.set(project.id, {
        ...project,
        status: project.status as ProjectCandidateRecord["status"],
        matchedBy,
      });
    };

    if (input.contextProjectId) {
      const contextProject = await prisma.project.findFirst({
        where: { AND: [scope, { id: input.contextProjectId }] },
        select: { id: true, code: true, name: true, status: true, lifecycleStage: true, updatedAt: true },
      });
      if (contextProject) add(contextProject, "context");
    }

    const rows = await prisma.project.findMany({
      where: {
        AND: [
          scope,
          {
            OR: [
              { code: { equals: input.query, mode: "insensitive" } },
              { name: { equals: input.query, mode: "insensitive" } },
              { name: { contains: input.query, mode: "insensitive" } },
            ],
          },
        ],
      },
      select: { id: true, code: true, name: true, status: true, lifecycleStage: true, updatedAt: true },
      orderBy: [{ code: "asc" }, { id: "asc" }],
      take: input.limit * 3,
    });
    const query = input.query.toLocaleLowerCase();
    for (const row of rows) {
      const matchedBy =
        row.code.toLocaleLowerCase() === query
          ? "code"
          : row.name.toLocaleLowerCase() === query
            ? "exact_name"
            : "partial_name";
      add(row, matchedBy);
    }
    return Array.from(candidates.values()).slice(0, input.limit);
  }

  async getProjectSummary(projectId: string, asOf: Date): Promise<ProjectSummaryRecord | null> {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        lifecycleStage: true,
        startDate: true,
        endDate: true,
        updatedAt: true,
        owner: { select: { id: true, name: true } },
      },
    });
    if (!project) return null;

    const upcomingEnd = new Date(asOf.getTime() + 90 * DAY_MS);
    const [
      completedTasks,
      totalTasks,
      blockedTaskCount,
      overdueTaskCount,
      delayedBomCount,
      openTasks,
      milestonesPending,
      submittedEcr,
      pendingEco,
      upcomingMilestones,
    ] = await Promise.all([
      prisma.task.count({ where: { projectId, status: "Done" } }),
      prisma.task.count({ where: { projectId } }),
      prisma.task.count({ where: { projectId, status: "Blocked" } }),
      prisma.task.count({ where: { projectId, status: { not: "Done" }, dueDate: { lt: asOf } } }),
      prisma.bomItem.count({ where: { projectId, status: "Delayed" } }),
      prisma.task.count({ where: { projectId, status: { not: "Done" } } }),
      prisma.milestone.count({ where: { projectId, status: { not: "done" } } }),
      prisma.changeRequest.count({ where: { projectId, status: "SUBMITTED" } }),
      prisma.changeLog.count({ where: { projectId, status: "PENDING" } }),
      prisma.milestone.findMany({
        where: { projectId, status: { not: "done" }, date: { gte: asOf, lte: upcomingEnd } },
        select: { id: true, name: true, date: true, status: true },
        orderBy: [{ date: "asc" }, { id: "asc" }],
        take: 20,
      }),
    ]);

    return {
      project,
      completedTasks,
      totalTasks,
      blockedTaskCount,
      overdueTaskCount,
      delayedBomCount,
      openTasks,
      milestonesPending,
      submittedEcr,
      pendingEco,
      upcomingMilestones,
    };
  }

  async listTasks(input: Parameters<ToolReadDataSource["listTasks"]>[0]) {
    const conditions: Prisma.TaskWhereInput[] = [
      { projectId: input.projectId },
      ...(input.statuses ? [{ status: { in: input.statuses } }] : []),
      ...(input.priorities ? [{ priority: { in: input.priorities } }] : []),
      ...(input.phaseId ? [{ phaseId: input.phaseId }] : []),
      ...(input.assigneeId ? [{ assigneeId: input.assigneeId }] : []),
      ...(input.query ? [{ title: { contains: input.query, mode: "insensitive" as const } }] : []),
      ...(input.overdueOnly ? [{ status: { not: "Done" }, dueDate: { lt: input.asOf } }] : []),
      ...(input.dueFromDate || input.dueToDate
        ? [
            {
              dueDate: {
                ...(input.dueFromDate ? { gte: input.dueFromDate } : {}),
                ...(input.dueToDate ? { lt: input.dueToDate } : {}),
              },
            },
          ]
        : []),
      ...(input.updatedSince ? [{ updatedAt: { gte: new Date(input.updatedSince) } }] : []),
    ];
    const where: Prisma.TaskWhereInput = { AND: conditions };
    const orderBy: Prisma.TaskOrderByWithRelationInput[] =
      input.sort === "updated_at_desc"
        ? [{ updatedAt: "desc" }, { id: "desc" }]
        : input.sort === "priority_asc"
          ? [{ priority: "asc" }, { id: "asc" }]
          : [{ dueDate: { sort: "asc", nulls: "last" } }, { id: "asc" }];
    const rows = await prisma.task.findMany({
      where,
      select: {
        id: true,
        projectId: true,
        title: true,
        status: true,
        priority: true,
        startDate: true,
        dueDate: true,
        estimatedHours: true,
        updatedAt: true,
        assignee: { select: { id: true, name: true } },
        phase: { select: { id: true, phaseName: true } },
      },
      orderBy,
      ...(input.cursorId ? { cursor: { id: input.cursorId }, skip: 1 } : {}),
      take: input.limit + 1,
    });
    const hasMore = rows.length > input.limit;
    const pageRows = rows.slice(0, input.limit);
    return {
      hasMore,
      nextCursorId: pageRows.at(-1)?.id,
      items: pageRows.map((row) => ({
        ...row,
        status: row.status as "To Do" | "In Progress" | "Blocked" | "Testing" | "Done",
        priority: row.priority as "P0" | "P1" | "P2" | "P3",
        phase: row.phase ? { id: row.phase.id, name: row.phase.phaseName } : null,
      })),
    };
  }

  async getTaskProjectId(taskId: string): Promise<string | null> {
    const task = await prisma.task.findUnique({ where: { id: taskId }, select: { projectId: true } });
    return task?.projectId ?? null;
  }

  async getTaskDependencies(
    input: Parameters<ToolReadDataSource["getTaskDependencies"]>[0],
    maxNodes: number,
  ): Promise<TaskDependencyRecord | null> {
    const taskSelect = {
      id: true,
      projectId: true,
      title: true,
      status: true,
      startDate: true,
      dueDate: true,
      updatedAt: true,
    } satisfies Prisma.TaskSelect;
    const root = await prisma.task.findUnique({ where: { id: input.taskId }, select: taskSelect });
    if (!root) return null;

    const nodes = new Map<string, typeof root>([[root.id, root]]);
    const edges = new Map<string, TaskDependencyRecord["edges"][number]>();
    let frontier = new Set([root.id]);
    let truncated = false;
    for (let level = 0; level < input.depth && frontier.size > 0; level += 1) {
      const frontierIds = Array.from(frontier);
      const where: Prisma.TaskDependencyWhereInput =
        input.direction === "predecessors"
          ? { successorId: { in: frontierIds } }
          : input.direction === "successors"
            ? { predecessorId: { in: frontierIds } }
            : { OR: [{ successorId: { in: frontierIds } }, { predecessorId: { in: frontierIds } }] };
      const relations = await prisma.taskDependency.findMany({
        where,
        select: { id: true, predecessorId: true, successorId: true, type: true, lagDays: true, predecessor: { select: taskSelect }, successor: { select: taskSelect } },
        orderBy: { id: "asc" },
      });
      const nextFrontier = new Set<string>();
      for (const relation of relations) {
        if (relation.predecessor.projectId !== root.projectId || relation.successor.projectId !== root.projectId) {
          throw new ToolInvocationError("internal_error", "任务依赖数据违反项目边界，请联系管理员并提供 traceId");
        }
        const candidates = [relation.predecessor, relation.successor];
        const missing = candidates.filter((candidate) => !nodes.has(candidate.id));
        if (nodes.size + missing.length > maxNodes) {
          truncated = true;
          continue;
        }
        for (const candidate of missing) {
          nodes.set(candidate.id, candidate);
          nextFrontier.add(candidate.id);
        }
        edges.set(relation.id, {
          id: relation.id,
          predecessorId: relation.predecessorId,
          successorId: relation.successorId,
          type: relation.type,
          lagDays: relation.lagDays,
          dateConflict: dateConflict(relation.type, relation.lagDays, relation.predecessor, relation.successor),
        });
      }
      frontier = nextFrontier;
    }

    return {
      rootTaskId: root.id,
      projectId: root.projectId,
      nodes: Array.from(nodes.values())
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(({ projectId: _projectId, ...node }) => node),
      edges: Array.from(edges.values()).sort((left, right) => left.id.localeCompare(right.id)),
      truncated,
    };
  }

  async listMilestones(input: Parameters<ToolReadDataSource["listMilestones"]>[0]) {
    const explicitDateRange = input.dateFromDate || input.dateToDate;
    const defaultEnd = new Date(input.asOf.getTime() + 90 * DAY_MS);
    const where: Prisma.MilestoneWhereInput = {
      projectId: input.projectId,
      ...(input.statuses ? { status: { in: input.statuses } } : {}),
      ...(explicitDateRange
        ? {
            date: {
              ...(input.dateFromDate ? { gte: input.dateFromDate } : {}),
              ...(input.dateToDate ? { lt: input.dateToDate } : {}),
            },
          }
        : {
            OR: [
              { date: { gte: input.asOf, lte: defaultEnd } },
              { date: { lt: input.asOf }, status: { not: "done" } },
            ],
          }),
    };
    const rows = await prisma.milestone.findMany({
      where,
      orderBy: [{ date: "asc" }, { id: "asc" }],
      ...(input.cursorId ? { cursor: { id: input.cursorId }, skip: 1 } : {}),
      take: input.limit + 1,
    });
    const pageRows = rows.slice(0, input.limit);
    return {
      hasMore: rows.length > input.limit,
      nextCursorId: pageRows.at(-1)?.id,
      items: pageRows.map((row) => ({
        ...row,
        status: row.status as "pending" | "done" | "missed",
      })),
    };
  }

  async getBomRisks(input: Parameters<ToolReadDataSource["getBomRisks"]>[0]): Promise<BomRiskPage> {
    const requested = new Set(input.riskTypes ?? ["delayed", "critical_not_arrived", "eta_overdue", "eta_within_window"]);
    const windowEnd = new Date(input.asOf.getTime() + input.windowDays * DAY_MS);
    const riskConditions: Prisma.BomItemWhereInput[] = [];
    if (requested.has("delayed")) riskConditions.push({ status: "Delayed" });
    if (requested.has("critical_not_arrived")) riskConditions.push({ isCritical: true, status: { not: "Arrived" } });
    if (requested.has("eta_overdue")) riskConditions.push({ status: { not: "Arrived" }, eta: { lt: input.asOf } });
    if (requested.has("eta_within_window")) {
      riskConditions.push({ status: { not: "Arrived" }, eta: { gte: input.asOf, lte: windowEnd } });
    }
    const [kitRate, rows] = await Promise.all([
      getKitRate(input.projectId, input.phaseId),
      prisma.bomItem.findMany({
        where: {
          projectId: input.projectId,
          ...(input.phaseId ? { phaseId: input.phaseId } : {}),
          OR: riskConditions,
        },
        orderBy: [{ isCritical: "desc" }, { eta: { sort: "asc", nulls: "last" } }, { id: "asc" }],
        ...(input.cursorId ? { cursor: { id: input.cursorId }, skip: 1 } : {}),
        take: input.limit + 1,
      }),
    ]);
    const pageRows = rows.slice(0, input.limit);
    return {
      kitRate: {
        totalItemRows: kitRate.total,
        arrivedItemRows: kitRate.arrived,
        percent: kitRate.rate,
        assemblyReady: kitRate.assemblyReady,
        byStatus: kitRate.byStatus,
      },
      hasMore: rows.length > input.limit,
      nextCursorId: pageRows.at(-1)?.id,
      risks: pageRows.map((row) => {
        const reasonCodes: BomRiskPage["risks"][number]["reasonCodes"] = [];
        if (requested.has("delayed") && row.status === "Delayed") reasonCodes.push("delayed");
        if (requested.has("critical_not_arrived") && row.isCritical && row.status !== "Arrived") {
          reasonCodes.push("critical_not_arrived");
        }
        if (requested.has("eta_overdue") && row.status !== "Arrived" && row.eta && row.eta < input.asOf) {
          reasonCodes.push("eta_overdue");
        }
        if (
          requested.has("eta_within_window") &&
          row.status !== "Arrived" &&
          row.eta &&
          row.eta >= input.asOf &&
          row.eta <= windowEnd
        ) {
          reasonCodes.push("eta_within_window");
        }
        return {
          id: row.id,
          projectId: row.projectId,
          mpn: row.mpn,
          name: row.name,
          status: row.status,
          quantity: row.qty,
          isCritical: row.isCritical,
          eta: row.eta,
          phaseId: row.phaseId,
          updatedAt: row.updatedAt,
          reasonCodes,
        };
      }),
    };
  }

  async getChangeImpact(
    input: Parameters<ToolReadDataSource["getChangeImpact"]>[0],
  ): Promise<ChangeImpactRecord | null> {
    const projectScope = scopedProjectIdWhere(input.visibleProjectIds);
    const ecrPromise =
      input.changeType === "ECO"
        ? Promise.resolve(null)
        : prisma.changeRequest.findFirst({
            where: {
              ...(projectScope ? { projectId: projectScope } : {}),
              OR: [{ id: input.changeRef }, { ecrNumber: { equals: input.changeRef, mode: "insensitive" } }],
            },
            include: { eco: { select: { id: true, ecoNumber: true } } },
          });
    const ecoPromise =
      input.changeType === "ECR"
        ? Promise.resolve(null)
        : prisma.changeLog.findFirst({
            where: {
              ...(projectScope ? { projectId: projectScope } : {}),
              OR: [{ id: input.changeRef }, { ecoNumber: { equals: input.changeRef, mode: "insensitive" } }],
            },
            include: { ecr: { select: { id: true, ecrNumber: true } }, impacts: true },
          });
    const [ecr, eco] = await Promise.all([ecrPromise, ecoPromise]);
    if (ecr && eco) throw new ToolInvocationError("ambiguous_reference", "该变更引用同时匹配 ECR 与 ECO，请指定 changeType");
    if (!ecr && !eco) return null;

    const targetType = ecr ? "ECR" : "ECO";
    const targetId = (ecr ?? eco)!.id;
    const approvals = input.includeApprovals
      ? await prisma.approvalRecord.findMany({
          where: { targetType, targetId },
          select: { action: true, approverId: true, comment: true, createdAt: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        })
      : [];
    const approverIds = Array.from(new Set(approvals.map((approval) => approval.approverId)));
    const approvers = approverIds.length
      ? await prisma.user.findMany({ where: { id: { in: approverIds } }, select: { id: true, name: true } })
      : [];
    const approverNames = new Map(approvers.map((user) => [user.id, user.name]));

    if (ecr) {
      return {
        change: {
          id: ecr.id,
          type: "ECR",
          number: ecr.ecrNumber,
          projectId: ecr.projectId,
          title: ecr.title,
          status: ecr.status,
          changeCategory: ecr.type,
          reason: ecr.reason,
          versionFrom: null,
          versionTo: null,
          convertedEco: ecr.eco ? { id: ecr.eco.id, number: ecr.eco.ecoNumber } : null,
        },
        impacts: [],
        approvals: approvals.map((approval) => ({
          action: approval.action,
          approverName: approverNames.get(approval.approverId) ?? "未知审批人",
          comment: approval.comment,
          createdAt: approval.createdAt,
        })),
      };
    }

    const impacts = eco!.impacts;
    const idsByType = new Map<string, string[]>();
    for (const impact of impacts) {
      idsByType.set(impact.entityType, [...(idsByType.get(impact.entityType) ?? []), impact.entityId]);
    }
    const [bomRows, taskRows, specRows, productRows] = await Promise.all([
      prisma.bomItem.findMany({
        where: { id: { in: idsByType.get("BOM_ITEM") ?? [] }, projectId: eco!.projectId },
        select: { id: true, mpn: true, name: true },
      }),
      prisma.task.findMany({
        where: { id: { in: idsByType.get("TASK") ?? [] }, projectId: eco!.projectId },
        select: { id: true, title: true },
      }),
      prisma.techSpec.findMany({
        where: { id: { in: idsByType.get("TECH_SPEC") ?? [] }, projectId: eco!.projectId },
        select: { id: true, metricName: true },
      }),
      prisma.product.findMany({
        where: { id: { in: idsByType.get("PRODUCT") ?? [] } },
        select: { id: true, code: true, name: true },
      }),
    ]);
    const labels = new Map<string, string>([
      ...bomRows.map((row) => [row.id, `${row.mpn} ${row.name}`] as const),
      ...taskRows.map((row) => [row.id, row.title] as const),
      ...specRows.map((row) => [row.id, row.metricName] as const),
      ...productRows.map((row) => [row.id, `${row.code} ${row.name}`] as const),
    ]);
    return {
      change: {
        id: eco!.id,
        type: "ECO",
        number: eco!.ecoNumber,
        projectId: eco!.projectId,
        title: null,
        status: eco!.status,
        changeCategory: eco!.type,
        reason: eco!.reason,
        versionFrom: eco!.versionFrom,
        versionTo: eco!.versionTo,
        sourceEcr: eco!.ecr ? { id: eco!.ecr.id, number: eco!.ecr.ecrNumber } : null,
      },
      impacts: impacts.map((impact) => ({
        impactId: impact.id,
        entityType: impact.entityType as "BOM_ITEM" | "TASK" | "TECH_SPEC" | "PRODUCT",
        entityId: impact.entityId,
        label: labels.get(impact.entityId) ?? null,
        note: impact.note,
      })),
      approvals: approvals.map((approval) => ({
        action: approval.action,
        approverName: approverNames.get(approval.approverId) ?? "未知审批人",
        comment: approval.comment,
        createdAt: approval.createdAt,
      })),
    };
  }

  async searchDocuments(
    input: Parameters<ToolReadDataSource["searchDocuments"]>[0],
  ): Promise<DocumentSearchPage> {
    const scope = documentVisibilityScope(input.visibleProjectIds);
    const projectCondition: Prisma.DocumentWhereInput = input.projectId
      ? input.includeShared
        ? { OR: [{ projectId: input.projectId }, { projectId: null }] }
        : { projectId: input.projectId }
      : input.includeShared
        ? {}
        : { projectId: { not: null } };
    const tagConditions = (input.tags ?? []).map(
      (tag): Prisma.DocumentWhereInput => ({ tags: { some: { tag: { name: tag } } } }),
    );
    const documentWhere = withDocumentScope(
      scope,
      projectCondition,
      input.categories ? { category: { in: input.categories } } : {},
      ...tagConditions,
    );
    const terms = lexicalTerms(input.query);
    const termConditions: Prisma.AgentDocumentChunkWhereInput[] = terms.map((term) => ({
      OR: [
        { contentText: { contains: term, mode: "insensitive" } },
        { document: { title: { contains: term, mode: "insensitive" } } },
        { document: { summary: { contains: term, mode: "insensitive" } } },
      ],
    }));
    const where: Prisma.AgentDocumentChunkWhereInput = {
      AND: [{ indexVersion: AGENT_KNOWLEDGE_INDEX_VERSION }, { document: documentWhere }, ...termConditions],
    };
    const allowedLagProjectIds = input.projectId
      ? [input.projectId]
      : input.visibleProjectIds === null
        ? null
        : input.visibleProjectIds;
    const includePublicLag = input.includeShared;
    const lagScopeConditions: Prisma.OutboxEventWhereInput[] =
      allowedLagProjectIds === null
        ? []
        : [
            ...allowedLagProjectIds.map(
              (projectId): Prisma.OutboxEventWhereInput => ({
                payloadJson: { path: ["projectId"], equals: projectId },
              }),
            ),
            ...(includePublicLag
              ? [{ payloadJson: { path: ["projectId"], equals: Prisma.JsonNull } } satisfies Prisma.OutboxEventWhereInput]
              : []),
          ];
    const pendingWhere: Prisma.OutboxEventWhereInput = {
      aggregateType: "DOCUMENT",
      eventType: { in: ["DOCUMENT_INDEX_UPSERT", "DOCUMENT_INDEX_DELETE"] },
      status: { not: "PROCESSED" },
      ...(allowedLagProjectIds === null
        ? {}
        : lagScopeConditions.length
          ? { OR: lagScopeConditions }
          : { aggregateId: "__no_visible_document__" }),
    };
    const [rows, indexLagCount, oldestPending] = await Promise.all([
      prisma.agentDocumentChunk.findMany({
        where,
        select: {
          id: true,
          sectionPathJson: true,
          contentText: true,
          indexVersion: true,
          promptInjectionDetected: true,
          sourceUpdatedAt: true,
          docVersion: { select: { version: true } },
          document: { select: { id: true, projectId: true, title: true, summary: true, category: true, updatedAt: true } },
        },
        orderBy: [{ sourceUpdatedAt: "desc" }, { id: "asc" }],
        ...(input.cursorId ? { cursor: { id: input.cursorId }, skip: 1 } : {}),
        take: input.limit + 1,
      }),
      prisma.outboxEvent.count({ where: pendingWhere }),
      prisma.outboxEvent.findFirst({ where: pendingWhere, select: { createdAt: true }, orderBy: { createdAt: "asc" } }),
    ]);
    const hasMore = rows.length > input.limit;
    const items: DocumentSearchRecord[] = rows.slice(0, input.limit).map((row) => {
      const content = row.contentText.toLocaleLowerCase();
      const title = row.document.title.toLocaleLowerCase();
      const summary = row.document.summary?.toLocaleLowerCase() ?? "";
      const matches = terms.filter((term) => content.includes(term) || title.includes(term) || summary.includes(term)).length;
      const titleBoost = terms.some((term) => title.includes(term)) ? 0.15 : 0;
      return {
        documentId: row.document.id,
        projectId: row.document.projectId,
        title: row.document.title,
        category: row.document.category,
        documentVersion: row.docVersion.version,
        chunkId: row.id,
        sectionPath: jsonStringArray(row.sectionPathJson),
        contentText: row.contentText,
        score: Math.min(1, Math.round((matches / terms.length + titleBoost) * 1_000) / 1_000),
        indexVersion: row.indexVersion,
        promptInjectionDetected: row.promptInjectionDetected,
        updatedAt: row.document.updatedAt,
      };
    });
    return {
      items,
      hasMore,
      nextCursorId: items.at(-1)?.chunkId,
      indexLagCount,
      oldestPendingAt: oldestPending?.createdAt ?? null,
    };
  }

  async getOrgTree(input: Parameters<ToolReadDataSource["getOrgTree"]>[0]) {
    const rows = await prisma.orgUnit.findMany({
      where: input.visibleOrgUnitIds === null ? {} : { id: { in: input.visibleOrgUnitIds } },
      select: {
        id: true,
        parentId: true,
        code: true,
        name: true,
        status: true,
        updatedAt: true,
        manager: { select: { id: true, name: true } },
        _count: { select: { members: { where: { status: "active" } } } },
      },
      orderBy: [{ code: "asc" }, { id: "asc" }],
      take: 2_000,
    });
    const included = rows.filter((row) => input.includeInactive || row.status === "active");
    const includedIds = new Set(included.map((row) => row.id));
    if (input.rootOrgUnitId && !includedIds.has(input.rootOrgUnitId)) return [];
    const children = new Map<string, typeof included>();
    for (const row of included) {
      if (!row.parentId) continue;
      const values = children.get(row.parentId) ?? [];
      values.push(row);
      children.set(row.parentId, values);
    }
    const roots = input.rootOrgUnitId
      ? included.filter((row) => row.id === input.rootOrgUnitId)
      : included.filter((row) => !row.parentId || !includedIds.has(row.parentId));
    const selected: typeof included = [];
    const queue = roots.map((row) => ({ row, level: 1 }));
    const visited = new Set<string>();
    while (queue.length > 0 && selected.length < 100) {
      const current = queue.shift()!;
      if (visited.has(current.row.id)) continue;
      visited.add(current.row.id);
      selected.push(current.row);
      if (current.level >= input.depth) continue;
      for (const child of children.get(current.row.id) ?? []) queue.push({ row: child, level: current.level + 1 });
    }
    const selectedIds = new Set(selected.map((row) => row.id));
    return selected.map((row) => ({
      id: row.id,
      parentId: row.parentId && selectedIds.has(row.parentId) ? row.parentId : null,
      code: row.code,
      name: row.name,
      manager: row.manager,
      activeMemberCount: row._count.members,
      status: row.status === "active" ? "active" as const : "inactive" as const,
      updatedAt: row.updatedAt,
    }));
  }

  async listOrgMembers(input: Parameters<ToolReadDataSource["listOrgMembers"]>[0]) {
    const orgRows = await prisma.orgUnit.findMany({
      where: input.visibleOrgUnitIds === null ? {} : { id: { in: input.visibleOrgUnitIds } },
      select: { id: true, parentId: true },
    });
    if (!orgRows.some((row) => row.id === input.orgUnitId)) return { items: [], hasMore: false };
    const orgUnitIds = input.recursive ? collectOrgSubtreeIds(orgRows, [input.orgUnitId]) : [input.orgUnitId];
    const rows = await prisma.user.findMany({
      where: {
        primaryOrgUnitId: { in: orgUnitIds },
        ...(input.projectId ? { memberships: { some: { projectId: input.projectId } } } : {}),
      },
      select: {
        id: true,
        name: true,
        status: true,
        managerId: true,
        createdAt: true,
        primaryOrgUnit: { select: { id: true, name: true } },
        position: { select: { name: true } },
      },
      orderBy: { id: "asc" },
      ...(input.cursorId ? { cursor: { id: input.cursorId }, skip: 1 } : {}),
      take: input.limit + 1,
    });
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit).flatMap((row) => row.primaryOrgUnit ? [{
      userId: row.id,
      name: row.name,
      orgUnitId: row.primaryOrgUnit.id,
      orgUnitName: row.primaryOrgUnit.name,
      positionName: row.position?.name ?? null,
      managerId: row.managerId,
      status: row.status === "active" ? "active" as const : "inactive" as const,
      createdAt: row.createdAt,
    }] : []);
    return { items, hasMore, nextCursorId: items.at(-1)?.userId };
  }

  async getMemberWorkloads(input: Parameters<ToolReadDataSource["getMemberWorkloads"]>[0]) {
    if (input.userIds.length === 0) return [];
    const taskWhere: Prisma.TaskWhereInput = {
      assigneeId: { in: input.userIds },
      status: { not: "Done" },
      ...(input.projectId ? { projectId: input.projectId } : {}),
    };
    const entryWhere: Prisma.TimeEntryWhereInput = {
      userId: { in: input.userIds },
      date: { gte: input.loggedFrom, lt: input.loggedToExclusive },
      ...(input.projectId ? { task: { projectId: input.projectId } } : {}),
    };
    const [users, tasks, entries, windows] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: input.userIds }, status: "active" },
        select: { id: true, name: true, weeklyCapacityHours: true },
        orderBy: { id: "asc" },
      }),
      prisma.task.findMany({
        where: taskWhere,
        select: { id: true, projectId: true, assigneeId: true, title: true, status: true, estimatedHours: true },
        orderBy: [{ estimatedHours: "desc" }, { id: "asc" }],
      }),
      prisma.timeEntry.findMany({ where: entryWhere, select: { userId: true, hours: true } }),
      prisma.resourcePlanWindow.findMany({
        where: {
          userId: { in: input.userIds },
          status: "published",
          dateFrom: { lte: input.dateFrom },
          dateTo: { gte: input.dateTo },
        },
        select: {
          id: true,
          userId: true,
          allocations: {
            where: {
              date: { gte: input.dateFrom, lte: input.dateTo },
              ...(input.projectId ? { task: { projectId: input.projectId } } : {}),
            },
            select: { taskId: true, hours: true },
          },
        },
        orderBy: [{ userId: "asc" }, { id: "asc" }],
      }),
    ]);
    const tasksByUser = new Map<string, typeof tasks>();
    for (const task of tasks) {
      if (!task.assigneeId) continue;
      const values = tasksByUser.get(task.assigneeId) ?? [];
      values.push(task);
      tasksByUser.set(task.assigneeId, values);
    }
    const loggedByUser = new Map<string, number>();
    for (const entry of entries) loggedByUser.set(entry.userId, (loggedByUser.get(entry.userId) ?? 0) + entry.hours);
    const windowsByUser = new Map<string, typeof windows>();
    for (const window of windows) {
      const values = windowsByUser.get(window.userId) ?? [];
      values.push(window);
      windowsByUser.set(window.userId, values);
    }
    const round = (value: number) => Math.round(value * 100) / 100;

    return users.map((user) => {
      const userTasks = tasksByUser.get(user.id) ?? [];
      const userWindows = windowsByUser.get(user.id) ?? [];
      const missingFields: Array<"weekly_capacity_hours" | "published_plan_window" | "ambiguous_plan_window" | "zero_capacity"> = [];
      const capacity = user.weeklyCapacityHours === null ? null : round((user.weeklyCapacityHours / 5) * input.workingDays);
      if (user.weeklyCapacityHours === null) missingFields.push("weekly_capacity_hours");
      if (capacity === 0) missingFields.push("zero_capacity");
      const uniqueWindow = userWindows.length === 1 ? userWindows[0] : null;
      if (userWindows.length === 0) missingFields.push("published_plan_window");
      if (userWindows.length > 1) missingFields.push("ambiguous_plan_window");
      const plannedByTask = new Map<string, number>();
      for (const allocation of uniqueWindow?.allocations ?? []) {
        plannedByTask.set(allocation.taskId, (plannedByTask.get(allocation.taskId) ?? 0) + allocation.hours);
      }
      const planned = uniqueWindow ? round([...plannedByTask.values()].reduce((sum, value) => sum + value, 0)) : null;
      const utilization = capacity !== null && capacity > 0 && planned !== null ? round((planned / capacity) * 100) : null;
      const dataQuality: "complete" | "partial" | "insufficient" =
        capacity !== null && capacity > 0 && uniqueWindow
          ? "complete"
          : userWindows.length > 1 || ((capacity === null || capacity === 0) && !uniqueWindow)
            ? "insufficient"
            : "partial";
      const taskDetails = input.includeTaskDetails
        ? userTasks.slice(0, 20).map((task) => ({
            taskId: task.id,
            title: task.title,
            projectId: task.projectId,
            status: task.status,
            estimatedHours: task.estimatedHours,
            plannedHoursInWindow: round(plannedByTask.get(task.id) ?? 0),
          }))
        : undefined;
      return {
        userId: user.id,
        name: user.name,
        openTaskCount: userTasks.length,
        openEstimatedHours: round(userTasks.reduce((sum, task) => sum + (task.estimatedHours ?? 0), 0)),
        loggedHoursInWindow: round(loggedByUser.get(user.id) ?? 0),
        capacityHoursInWindow: capacity,
        plannedHoursInWindow: planned,
        utilizationPercent: utilization,
        dataQuality,
        missingFields,
        ...(taskDetails ? { taskDetails } : {}),
        snapshotAt: input.asOf,
      };
    });
  }

  async getWeeklyReport(
    input: Parameters<ToolReadDataSource["getWeeklyReport"]>[0],
  ): Promise<WeeklyReportRecord | null> {
    const project = await prisma.project.findUnique({
      where: { id: input.projectId },
      select: { id: true, code: true, name: true, updatedAt: true },
    });
    if (!project) return null;

    const activityWhere: Prisma.ActivityEventWhereInput = {
      projectId: input.projectId,
      occurredAt: { gte: input.periodStart, lt: input.periodEndExclusive },
      entityType: { in: ["TASK", "ECR", "ECO"] },
    };
    const upcomingEnd = new Date(input.asOf.getTime() + 30 * DAY_MS);
    const [
      totalTasks,
      completedTaskCount,
      activityEventCount,
      activityRows,
      blockedTasks,
      overdueTasks,
      delayedBom,
      missedMilestones,
      upcomingMilestones,
      kitRate,
    ] = await Promise.all([
      prisma.task.count({ where: { projectId: input.projectId } }),
      prisma.task.count({ where: { projectId: input.projectId, status: "Done" } }),
      prisma.activityEvent.count({ where: activityWhere }),
      prisma.activityEvent.findMany({
        where: activityWhere,
        select: { id: true, eventType: true, entityType: true, entityId: true, payloadJson: true, occurredAt: true },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        take: 401,
      }),
      prisma.task.findMany({
        where: { projectId: input.projectId, status: "Blocked" },
        select: { id: true, title: true, priority: true, updatedAt: true },
        orderBy: [{ priority: "asc" }, { updatedAt: "desc" }],
        take: 100,
      }),
      prisma.task.findMany({
        where: { projectId: input.projectId, status: { not: "Done" }, dueDate: { lt: input.asOf } },
        select: { id: true, title: true, priority: true, dueDate: true, updatedAt: true },
        orderBy: [{ dueDate: "asc" }, { id: "asc" }],
        take: 100,
      }),
      prisma.bomItem.findMany({
        where: { projectId: input.projectId, status: "Delayed" },
        select: { id: true, mpn: true, name: true, isCritical: true, updatedAt: true },
        orderBy: [{ isCritical: "desc" }, { updatedAt: "desc" }],
        take: 100,
      }),
      prisma.milestone.findMany({
        where: { projectId: input.projectId, status: "missed" },
        select: { id: true, name: true, date: true },
        orderBy: [{ date: "asc" }, { id: "asc" }],
        take: 100,
      }),
      prisma.milestone.findMany({
        where: { projectId: input.projectId, status: { not: "done" }, date: { gte: input.asOf, lte: upcomingEnd } },
        select: { id: true, name: true, date: true, status: true },
        orderBy: [{ date: "asc" }, { id: "asc" }],
        take: 100,
      }),
      getKitRate(input.projectId),
    ]);

    const completedTasks: WeeklyReportRecord["completedTasks"] = [];
    const changes: WeeklyReportRecord["changes"] = [];
    let malformedActivityCount = 0;
    for (const event of activityRows.slice(0, 400)) {
      const payload = jsonObject(event.payloadJson);
      if (event.entityType === "TASK" && event.eventType === "task.completed") {
        const title = payloadString(payload, "title");
        if (!title || completedTasks.length >= 200) {
          malformedActivityCount += title ? 0 : 1;
          continue;
        }
        completedTasks.push({
          eventId: event.id,
          taskId: event.entityId,
          title,
          assigneeName: payloadString(payload, "assigneeName"),
          completedAt: event.occurredAt,
        });
        continue;
      }
      if (event.entityType === "ECR" || event.entityType === "ECO") {
        const number = payloadString(payload, "number");
        const action = payloadString(payload, "action");
        if (!number || !action || changes.length >= 200) {
          malformedActivityCount += number && action ? 0 : 1;
          continue;
        }
        changes.push({
          eventId: event.id,
          id: event.entityId,
          type: event.entityType,
          number,
          action,
          occurredAt: event.occurredAt,
        });
      }
    }

    const openRisks: WeeklyReportRecord["openRisks"] = [
      ...blockedTasks.map((task) => ({
        code: "blocked_task" as const,
        severity: (["P0", "P1"].includes(task.priority) ? "critical" : "warning") as "critical" | "warning",
        entityType: "TASK" as const,
        entityId: task.id,
        summary: safeSummary(`阻塞任务：${task.title}`),
        updatedAt: task.updatedAt,
      })),
      ...overdueTasks.map((task) => ({
        code: "overdue_task" as const,
        severity: (["P0", "P1"].includes(task.priority) ? "critical" : "warning") as "critical" | "warning",
        entityType: "TASK" as const,
        entityId: task.id,
        summary: safeSummary(`逾期任务：${task.title}（截止 ${task.dueDate?.toISOString() ?? "未知"}）`),
        updatedAt: task.updatedAt,
      })),
      ...delayedBom.map((item) => ({
        code: "delayed_bom" as const,
        severity: (item.isCritical ? "critical" : "warning") as "critical" | "warning",
        entityType: "BOM_ITEM" as const,
        entityId: item.id,
        summary: safeSummary(`延迟物料：${item.mpn} ${item.name}`),
        updatedAt: item.updatedAt,
      })),
      ...missedMilestones.map((milestone) => ({
        code: "missed_milestone" as const,
        severity: "critical" as const,
        entityType: "MILESTONE" as const,
        entityId: milestone.id,
        summary: safeSummary(`错过里程碑：${milestone.name}`),
        updatedAt: milestone.date,
      })),
    ].slice(0, 200);

    return {
      project,
      progress: { completedTasks: completedTaskCount, totalTasks },
      completedTasks,
      openRisks,
      upcomingMilestones,
      bom: { kitRatePercent: kitRate.rate, riskCount: delayedBom.length },
      changes,
      activityEventCount,
      malformedActivityCount,
      activityTruncated: activityEventCount > 400,
    };
  }
}
