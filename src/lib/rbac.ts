// RBAC 权限校验：requireAuth / requirePerm / 可见项目过滤
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ROLE_PERMISSION_MAP, type PermissionCode, type RoleName } from "@/lib/constants";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  roleId: string;
  roleName: RoleName;
}

/** 获取当前登录用户；未登录抛 401 */
export async function requireAuth(): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user?.id) throw new ApiError(401, "未登录或会话已过期");
  return {
    id: session.user.id,
    email: session.user.email ?? "",
    name: session.user.name ?? "",
    roleId: session.user.roleId,
    roleName: (session.user.roleName || "viewer") as RoleName,
  };
}

/** 计算用户在指定项目下的有效角色（项目角色覆盖全局角色） */
async function effectiveRole(user: SessionUser, projectId?: string): Promise<RoleName> {
  if (user.roleName === "admin") return "admin";
  if (!projectId) return user.roleName;
  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: user.id } },
    include: { role: true },
  });
  if (!member) throw new ApiError(403, "您不是该项目成员，无权访问");
  return (member.role?.name as RoleName) ?? user.roleName;
}

function roleHasPerm(role: RoleName, code: PermissionCode): boolean {
  if (role === "admin") return true;
  return (ROLE_PERMISSION_MAP[role] as readonly string[]).includes(code);
}

/** 校验权限点；projectId 非空时同时校验项目成员身份 */
export async function requirePerm(code: PermissionCode, projectId?: string): Promise<SessionUser> {
  const user = await requireAuth();
  const role = await effectiveRole(user, projectId);
  if (!roleHasPerm(role, code)) throw new ApiError(403, `缺少权限：${code}`);
  return user;
}

/** 当前用户可见的项目 ID 列表（admin 返回 null 表示全量） */
export async function visibleProjectIds(user: SessionUser): Promise<string[] | null> {
  if (user.roleName === "admin") return null;
  const rows = await prisma.projectMember.findMany({
    where: { userId: user.id },
    select: { projectId: true },
  });
  return rows.map((r) => r.projectId);
}

/** 校验用户是否可访问某项目（admin 短路） */
export async function requireProjectAccess(user: SessionUser, projectId: string): Promise<void> {
  if (user.roleName === "admin") return;
  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: user.id } },
  });
  if (!member) throw new ApiError(403, "您不是该项目成员，无权访问");
}

/** 统一 API 错误响应 */
export function apiError(err: unknown): Response {
  if (err instanceof ApiError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof Error && err.name === "ZodError") {
    return Response.json({ error: "参数校验失败", detail: String(err) }, { status: 400 });
  }
  console.error("[API Error]", err);
  return Response.json(
    { error: err instanceof Error ? err.message : "服务器内部错误" },
    { status: 500 }
  );
}
