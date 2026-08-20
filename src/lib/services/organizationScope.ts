import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/rbac";

type OrgLink = { id: string; parentId: string | null };

export function collectOrgSubtreeIds(rows: readonly OrgLink[], rootIds: readonly string[]): string[] {
  const children = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parentId) continue;
    const values = children.get(row.parentId) ?? [];
    values.push(row.id);
    children.set(row.parentId, values);
  }

  const queue = [...new Set(rootIds)];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const child of children.get(current) ?? []) queue.push(child);
  }
  return [...visited];
}

export async function managedOrgUnitIds(user: SessionUser): Promise<string[] | null> {
  if (user.roleName === "admin") return null;
  const [rows, managed] = await Promise.all([
    prisma.orgUnit.findMany({ select: { id: true, parentId: true } }),
    prisma.orgUnit.findMany({ where: { managerId: user.id }, select: { id: true } }),
  ]);
  return collectOrgSubtreeIds(rows, managed.map((row) => row.id));
}

/**
 * 组织基本信息可见范围：本人主部门 + 本人负责组织的完整子树。
 * 负载等敏感多人数据必须另外使用 managedOrgUnitIds，不能只依赖本函数。
 */
export async function visibleOrgUnitIds(user: SessionUser): Promise<string[] | null> {
  if (user.roleName === "admin") return null;
  const [rows, current, managedRows] = await Promise.all([
    prisma.orgUnit.findMany({ select: { id: true, parentId: true } }),
    prisma.user.findUnique({ where: { id: user.id }, select: { primaryOrgUnitId: true } }),
    prisma.orgUnit.findMany({ where: { managerId: user.id }, select: { id: true } }),
  ]);
  const subtree = collectOrgSubtreeIds(rows, managedRows.map((row) => row.id));
  return [...new Set([...(current?.primaryOrgUnitId ? [current.primaryOrgUnitId] : []), ...subtree])];
}

export function orgAncestorIds(rows: readonly OrgLink[], orgUnitId: string): string[] {
  const parentById = new Map(rows.map((row) => [row.id, row.parentId]));
  const result: string[] = [];
  const visited = new Set<string>();
  let cursor: string | null = orgUnitId;
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    result.push(cursor);
    cursor = parentById.get(cursor) ?? null;
  }
  return result;
}
