import type { Prisma } from "@prisma/client";

/** 公共文档 + 可见项目文档范围，必须作为独立 AND 条件保留。 */
export function documentVisibilityScope(visibleIds: string[] | null): Prisma.DocumentWhereInput {
  return visibleIds === null ? {} : { OR: [{ projectId: null }, { projectId: { in: visibleIds } }] };
}

export function withDocumentScope(
  scope: Prisma.DocumentWhereInput,
  ...conditions: Prisma.DocumentWhereInput[]
): Prisma.DocumentWhereInput {
  return { AND: [scope, ...conditions] };
}
