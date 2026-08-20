import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/rbac";
import {
  AgentGovernanceError,
  assertManagerAssignment,
  assertOrgParentChange,
  validateWeeklyCapacityHours,
} from "@/lib/agent/governance";
import { orgAncestorIds } from "@/lib/services/organizationScope";

type Tx = Prisma.TransactionClient;

function text(value: unknown, field: string, max = 200): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || Array.from(normalized).length > max) throw new ApiError(400, `${field} 格式无效`);
  return normalized;
}

function optionalId(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return text(value, "ID", 128);
}

function status(value: unknown): "active" | "inactive" {
  if (value !== "active" && value !== "inactive") throw new ApiError(400, "状态必须是 active 或 inactive");
  return value;
}

async function lockOrganization(tx: Tx): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('workbuddy:organization'))`;
}

async function organizationLinks(tx: Tx) {
  return tx.orgUnit.findMany({ select: { id: true, parentId: true, status: true } });
}

function governanceError(error: unknown): never {
  if (error instanceof AgentGovernanceError) throw new ApiError(400, error.message);
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new ApiError(409, "组织或岗位编码已存在");
  }
  throw error;
}

export async function getOrganizationAdminSnapshot() {
  const [units, positions, members] = await Promise.all([
    prisma.orgUnit.findMany({
      include: {
        manager: { select: { id: true, name: true } },
        _count: { select: { members: { where: { status: "active" } }, positions: true } },
      },
      orderBy: [{ parentId: "asc" }, { code: "asc" }],
    }),
    prisma.position.findMany({ include: { orgUnit: { select: { id: true, name: true } } }, orderBy: { code: "asc" } }),
    prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        primaryOrgUnitId: true,
        positionId: true,
        managerId: true,
        weeklyCapacityHours: true,
        primaryOrgUnit: { select: { id: true, name: true } },
        position: { select: { id: true, name: true } },
        manager: { select: { id: true, name: true } },
      },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    }),
  ]);
  return { units, positions, members };
}

export async function createOrgUnit(input: Record<string, unknown>) {
  try {
    return await prisma.$transaction(async (tx) => {
      await lockOrganization(tx);
      const parentId = optionalId(input.parentId);
      const rows = await organizationLinks(tx);
      const parentById = new Map(rows.map((row) => [row.id, row.parentId]));
      if (parentId && !parentById.has(parentId)) throw new ApiError(400, "父组织不存在");
      const id = typeof input.id === "string" && input.id.trim() ? input.id.trim() : undefined;
      if (id) assertOrgParentChange(id, parentId, parentById);
      return tx.orgUnit.create({
        data: {
          ...(id ? { id } : {}),
          code: text(input.code, "组织编码", 64),
          name: text(input.name, "组织名称", 120),
          parentId,
          status: input.status === undefined ? "active" : status(input.status),
        },
      });
    });
  } catch (error) {
    governanceError(error);
  }
}

export async function updateOrgUnit(input: Record<string, unknown>) {
  try {
    return await prisma.$transaction(async (tx) => {
      await lockOrganization(tx);
      const id = text(input.id, "组织 ID", 128);
      const current = await tx.orgUnit.findUnique({ where: { id } });
      if (!current) throw new ApiError(404, "组织不存在");
      const rows = await organizationLinks(tx);
      const parentById = new Map(rows.map((row) => [row.id, row.parentId]));
      const parentId = "parentId" in input ? optionalId(input.parentId) : current.parentId;
      assertOrgParentChange(id, parentId, parentById);

      const nextStatus = "status" in input ? status(input.status) : (current.status as "active" | "inactive");
      if (nextStatus === "inactive") {
        const [activeMembers, activeChildren] = await Promise.all([
          tx.user.count({ where: { primaryOrgUnitId: id, status: "active" } }),
          tx.orgUnit.count({ where: { parentId: id, status: "active" } }),
        ]);
        if (activeMembers || activeChildren) throw new ApiError(409, "存在启用成员或子组织，不能停用该组织");
      }

      const managerId = "managerId" in input ? optionalId(input.managerId) : current.managerId;
      if (managerId) {
        const manager = await tx.user.findUnique({ where: { id: managerId }, select: { status: true, primaryOrgUnitId: true } });
        if (!manager || manager.status !== "active" || manager.primaryOrgUnitId !== id) {
          throw new ApiError(400, "组织负责人必须是该组织的启用成员");
        }
      }
      return tx.orgUnit.update({
        where: { id },
        data: {
          ...(input.code !== undefined ? { code: text(input.code, "组织编码", 64) } : {}),
          ...(input.name !== undefined ? { name: text(input.name, "组织名称", 120) } : {}),
          parentId,
          managerId,
          status: nextStatus,
        },
      });
    });
  } catch (error) {
    governanceError(error);
  }
}

async function requireActiveOrg(tx: Tx, orgUnitId: string | null) {
  if (!orgUnitId) return null;
  const org = await tx.orgUnit.findUnique({ where: { id: orgUnitId } });
  if (!org || org.status !== "active") throw new ApiError(400, "岗位所属组织不存在或已停用");
  return org;
}

export async function createPosition(input: Record<string, unknown>) {
  try {
    return await prisma.$transaction(async (tx) => {
      await lockOrganization(tx);
      const orgUnitId = optionalId(input.orgUnitId);
      await requireActiveOrg(tx, orgUnitId);
      return tx.position.create({
        data: {
          code: text(input.code, "岗位编码", 64),
          name: text(input.name, "岗位名称", 120),
          orgUnitId,
          status: input.status === undefined ? "active" : status(input.status),
        },
      });
    });
  } catch (error) {
    governanceError(error);
  }
}

export async function updatePosition(input: Record<string, unknown>) {
  try {
    return await prisma.$transaction(async (tx) => {
      await lockOrganization(tx);
      const id = text(input.id, "岗位 ID", 128);
      const current = await tx.position.findUnique({ where: { id } });
      if (!current) throw new ApiError(404, "岗位不存在");
      const orgUnitId = "orgUnitId" in input ? optionalId(input.orgUnitId) : current.orgUnitId;
      await requireActiveOrg(tx, orgUnitId);
      const nextStatus = "status" in input ? status(input.status) : (current.status as "active" | "inactive");
      if (nextStatus === "inactive" && (await tx.user.count({ where: { positionId: id, status: "active" } })) > 0) {
        throw new ApiError(409, "仍有启用成员使用该岗位，不能停用");
      }
      return tx.position.update({
        where: { id },
        data: {
          ...(input.code !== undefined ? { code: text(input.code, "岗位编码", 64) } : {}),
          ...(input.name !== undefined ? { name: text(input.name, "岗位名称", 120) } : {}),
          orgUnitId,
          status: nextStatus,
        },
      });
    });
  } catch (error) {
    governanceError(error);
  }
}

export async function updateMemberOrganization(input: Record<string, unknown>) {
  try {
    return await prisma.$transaction(async (tx) => {
      await lockOrganization(tx);
      const userId = text(input.userId, "用户 ID", 128);
      const current = await tx.user.findUnique({ where: { id: userId } });
      if (!current) throw new ApiError(404, "用户不存在");

      const primaryOrgUnitId = "primaryOrgUnitId" in input ? optionalId(input.primaryOrgUnitId) : current.primaryOrgUnitId;
      const positionId = "positionId" in input ? optionalId(input.positionId) : current.positionId;
      const managerId = "managerId" in input ? optionalId(input.managerId) : current.managerId;
      const weeklyCapacityHours =
        "weeklyCapacityHours" in input
          ? validateWeeklyCapacityHours(input.weeklyCapacityHours === "" ? null : input.weeklyCapacityHours)
          : current.weeklyCapacityHours;
      assertManagerAssignment(userId, managerId);

      const rows = await organizationLinks(tx);
      const org = primaryOrgUnitId ? await tx.orgUnit.findUnique({ where: { id: primaryOrgUnitId } }) : null;
      if (primaryOrgUnitId && (!org || org.status !== "active")) throw new ApiError(400, "主部门不存在或已停用");
      if (positionId) {
        const position = await tx.position.findUnique({ where: { id: positionId } });
        if (!position || position.status !== "active") throw new ApiError(400, "岗位不存在或已停用");
        if (position.orgUnitId && position.orgUnitId !== primaryOrgUnitId) throw new ApiError(400, "岗位与主部门不一致");
      }
      if (managerId) {
        const manager = await tx.user.findUnique({ where: { id: managerId } });
        if (!manager || manager.status !== "active") throw new ApiError(400, "直属经理不存在或已停用");
        const allowedManagerOrgs = primaryOrgUnitId ? orgAncestorIds(rows, primaryOrgUnitId) : [];
        if (!manager.primaryOrgUnitId || !allowedManagerOrgs.includes(manager.primaryOrgUnitId)) {
          throw new ApiError(400, "直属经理必须属于成员主部门或其上级组织");
        }
        const visited = new Set<string>();
        let cursor: string | null = managerId;
        while (cursor) {
          if (cursor === userId) throw new ApiError(400, "直属经理关系会形成循环");
          if (visited.has(cursor)) throw new ApiError(400, "现有直属经理关系包含循环");
          visited.add(cursor);
          const row: { managerId: string | null } | null = await tx.user.findUnique({
            where: { id: cursor },
            select: { managerId: true },
          });
          cursor = row?.managerId ?? null;
        }
      }

      const managedUnits = await tx.orgUnit.findMany({ where: { managerId: userId }, select: { id: true } });
      if (managedUnits.some((unit) => unit.id !== primaryOrgUnitId)) {
        throw new ApiError(409, "该用户仍负责其他组织，请先调整组织负责人");
      }

      return tx.user.update({
        where: { id: userId },
        data: { primaryOrgUnitId, positionId, managerId, weeklyCapacityHours },
        select: {
          id: true,
          name: true,
          primaryOrgUnitId: true,
          positionId: true,
          managerId: true,
          weeklyCapacityHours: true,
        },
      });
    });
  } catch (error) {
    governanceError(error);
  }
}
