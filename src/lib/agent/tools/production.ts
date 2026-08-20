import { ROLE_NAMES, type PermissionCode, type RoleName } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import {
  ApiError,
  effectiveRole,
  roleHasPerm,
  visibleProjectIds as getVisibleProjectIds,
  type SessionUser,
} from "@/lib/rbac";
import { TOOL_CONTRACT_VERSION } from "@/lib/agent/tools/contracts";
import { PrismaActionService } from "@/lib/agent/actions/service";
import { actionApprovalSecretReady } from "@/lib/agent/actions/token";
import type { MemberGetWorkloadInput } from "@/lib/agent/tools/contracts";
import { ToolInvocationError } from "@/lib/agent/tools/errors";
import { ToolGateway } from "@/lib/agent/tools/gateway";
import { PrismaToolReadDataSource } from "@/lib/agent/tools/prismaDataSource";
import type { AuthorizedWorkloadScope, ToolAuditEvent, ToolAuditSink, ToolAuthorizer } from "@/lib/agent/tools/types";
import {
  collectOrgSubtreeIds,
  managedOrgUnitIds,
  visibleOrgUnitIds as getVisibleOrgUnitIds,
} from "@/lib/services/organizationScope";

function isRoleName(value: string): value is RoleName {
  return (ROLE_NAMES as readonly string[]).includes(value);
}

export class WorkBuddyToolAuthorizer implements ToolAuthorizer {
  async resolveSubject(sessionSubject: string): Promise<SessionUser> {
    const user = await prisma.user.findUnique({
      where: { id: sessionSubject },
      include: { role: { select: { id: true, name: true } } },
    });
    if (!user || user.status !== "active" || !isRoleName(user.role.name)) {
      throw new ToolInvocationError("auth_required", "登录状态无效、账号已停用或角色不可用，请重新登录");
    }
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      roleId: user.roleId,
      roleName: user.role.name,
    };
  }

  visibleProjectIds(user: SessionUser): Promise<string[] | null> {
    return getVisibleProjectIds(user);
  }

  visibleOrgUnitIds(user: SessionUser): Promise<string[] | null> {
    return getVisibleOrgUnitIds(user);
  }

  async authorizeWorkloadScope(user: SessionUser, input: MemberGetWorkloadInput): Promise<AuthorizedWorkloadScope> {
    const projectId = input.scope.type === "project" ? input.scope.projectId : input.projectId;
    let userIds: string[] = [];
    let orgUnitIds: string[] = [];
    const permissionsApplied: string[] = [];

    if (input.scope.type === "project") {
      await this.assertPermissions(user, ["time:read_all", "project:read"], projectId);
      permissionsApplied.push("time:read_all", "project:read", "project_membership_scope");
      const members = await prisma.projectMember.findMany({
        where: { projectId, user: { status: "active" } },
        select: { userId: true, user: { select: { primaryOrgUnitId: true } } },
        orderBy: { userId: "asc" },
        take: 101,
      });
      if (members.length > 100) throw new ToolInvocationError("validation_error", "项目成员超过 100 人，请改用组织或用户范围缩小查询");
      userIds = members.map((member) => member.userId);
      orgUnitIds = members.flatMap((member) => member.user.primaryOrgUnitId ? [member.user.primaryOrgUnitId] : []);
    } else if (input.scope.type === "org_unit") {
      const orgScope = input.scope;
      await this.assertPermissions(user, ["time:read_all", "org:read"]);
      permissionsApplied.push("time:read_all", "org:read", "managed_org_scope");
      const rows = await prisma.orgUnit.findMany({ select: { id: true, parentId: true } });
      const selectedOrgIds = orgScope.recursive
        ? collectOrgSubtreeIds(rows, [orgScope.orgUnitId])
        : [orgScope.orgUnitId];
      const managedIds = await managedOrgUnitIds(user);
      if (
        !rows.some((row) => row.id === orgScope.orgUnitId) ||
        (managedIds !== null && !selectedOrgIds.every((orgId) => managedIds.includes(orgId)))
      ) {
        throw new ApiError(403, "目标资源不存在或当前账号无权访问");
      }
      orgUnitIds = selectedOrgIds;
      if (projectId) {
        await this.assertPermissions(user, ["project:read"], projectId);
        permissionsApplied.push("project:read", "project_membership_intersection");
      }
      const users = await prisma.user.findMany({
        where: {
          status: "active",
          primaryOrgUnitId: { in: selectedOrgIds },
          ...(projectId ? { memberships: { some: { projectId } } } : {}),
        },
        select: { id: true },
        orderBy: { id: "asc" },
        take: 101,
      });
      if (users.length > 100) throw new ToolInvocationError("validation_error", "组织成员超过 100 人，请缩小查询范围");
      userIds = users.map((member) => member.id);
    } else {
      userIds = [...new Set(input.scope.userIds)];
      const selfOnly = userIds.length === 1 && userIds[0] === user.id;
      if (selfOnly) {
        await this.assertPermissions(user, ["time:read"]);
        permissionsApplied.push("time:read", "self_scope");
        if (projectId) {
          await this.assertPermissions(user, ["project:read"], projectId);
          permissionsApplied.push("project:read", "project_membership_intersection");
        }
      } else {
        await this.assertPermissions(user, ["time:read_all"]);
        permissionsApplied.push("time:read_all");
        if (projectId) {
          await this.assertPermissions(user, ["project:read"], projectId);
          permissionsApplied.push("project:read", "project_membership_intersection");
        } else {
          permissionsApplied.push("managed_org_scope");
        }
      }

      const users = await prisma.user.findMany({
        where: {
          id: { in: userIds },
          status: "active",
          ...(projectId ? { memberships: { some: { projectId } } } : {}),
        },
        select: { id: true, primaryOrgUnitId: true },
      });
      if (users.length !== userIds.length) throw new ApiError(403, "目标资源不存在或当前账号无权访问");
      orgUnitIds = users.flatMap((member) => member.primaryOrgUnitId ? [member.primaryOrgUnitId] : []);
      if (!selfOnly && !projectId && user.roleName !== "admin") {
        const managedIds = await managedOrgUnitIds(user);
        if (managedIds === null || users.some((member) => !member.primaryOrgUnitId || !managedIds.includes(member.primaryOrgUnitId))) {
          throw new ApiError(403, "目标资源不存在或当前账号无权访问");
        }
      }
    }

    return {
      userIds,
      ...(projectId ? { projectId } : {}),
      orgUnitIds: [...new Set(orgUnitIds)],
      permissionsApplied: [...new Set(permissionsApplied)],
    };
  }

  async assertPermissions(
    user: SessionUser,
    permissions: readonly PermissionCode[],
    projectId?: string,
  ): Promise<void> {
    const role = await effectiveRole(user, projectId);
    const missing = permissions.filter((permission) => !roleHasPerm(role, permission));
    if (missing.length > 0) throw new ApiError(403, "目标资源不存在或当前账号无权访问");
  }
}

export class PrismaToolAuditSink implements ToolAuditSink {
  async record(event: ToolAuditEvent): Promise<void> {
    const existing = await prisma.agentToolExecution.findUnique({
      where: { requestId: event.requestId },
      select: { runId: true, toolName: true, inputHash: true, status: true },
    });
    if (existing) {
      if (
        existing.runId === event.runId &&
        existing.toolName === event.tool &&
        existing.inputHash === event.inputHash &&
        existing.status === event.status
      ) {
        return;
      }
      throw new ToolInvocationError("conflict", "requestId 已用于不同的 Tool 执行记录");
    }

    const completedAt = new Date();
    const startedAt = new Date(Math.max(0, completedAt.getTime() - event.durationMs));
    await prisma.agentToolExecution.create({
      data: {
        runId: event.runId,
        requestId: event.requestId,
        toolName: event.tool,
        contractVersion: TOOL_CONTRACT_VERSION,
        status: event.status,
        inputHash: event.inputHash,
        inputSummaryJson: { traceId: event.traceId, rawInputStored: false },
        outputSummaryJson: { evidenceCount: event.evidenceIds.length },
        evidenceJson: { evidenceIds: event.evidenceIds },
        projectIdsJson: event.projectIds,
        errorCode: event.errorCode ?? null,
        durationMs: event.durationMs,
        startedAt,
        completedAt,
      },
    });
  }
}

export function createProductionToolGateway(options: { cursorSecret: string; clock?: () => Date }): ToolGateway {
  return new ToolGateway({
    dataSource: new PrismaToolReadDataSource(),
    authorizer: new WorkBuddyToolAuthorizer(),
    auditSink: new PrismaToolAuditSink(),
    ...(actionApprovalSecretReady() ? { actionProposalService: new PrismaActionService(prisma, options.clock) } : {}),
    cursorSecret: options.cursorSecret,
    clock: options.clock,
  });
}
