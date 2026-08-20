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
  mustChangePassword?: boolean;
  sessionVersion?: number;
}

/** 缺少版本号的旧 JWT 也应失效，避免部署后绕过会话撤销。 */
export function isSessionVersionCurrent(sessionVersion: number | undefined, currentVersion: number): boolean {
  return Number.isInteger(sessionVersion) && sessionVersion === currentVersion;
}

/** 获取当前登录用户；未登录抛 401 */
export async function requireAuth(options: { allowPasswordChange?: boolean } = {}): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user?.id) throw new ApiError(401, "未登录或会话已过期");
  // JWT 只作为会话标识；角色与账号状态每次从数据库读取，确保停用/降权立即生效。
  const current = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true },
  });
  if (!current || current.status !== "active") throw new ApiError(401, "账号已停用或不存在");
  if (!isSessionVersionCurrent(session.user.sessionVersion, current.sessionVersion)) {
    throw new ApiError(401, "会话已被撤销，请重新登录");
  }
  if (current.mustChangePassword && !options.allowPasswordChange) {
    throw new ApiError(403, "首次登录必须修改密码");
  }
  return {
    id: current.id,
    email: current.email,
    name: current.name,
    roleId: current.roleId,
    roleName: current.role.name as RoleName,
    mustChangePassword: current.mustChangePassword,
    sessionVersion: current.sessionVersion,
  };
}

/** 计算用户在指定项目下的有效角色（项目角色覆盖全局角色） */
export async function effectiveRole(user: SessionUser, projectId?: string): Promise<RoleName> {
  if (user.roleName === "admin") return "admin";
  if (!projectId) return user.roleName;
  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: user.id } },
    include: { role: true },
  });
  if (!member) throw new ApiError(403, "您不是该项目成员，无权访问");
  return (member.role?.name as RoleName) ?? user.roleName;
}

export function roleHasPerm(role: RoleName, code: PermissionCode): boolean {
  if (role === "admin") return true;
  return (ROLE_PERMISSION_MAP[role] as readonly string[]).includes(code);
}

export function roleCanComment(role: RoleName): boolean {
  return role !== "viewer";
}

export type ProjectEntityType = "PROJECT" | "TASK" | "BOM_ITEM" | "TECH_SPEC" | "ECO" | "ECR" | "DOCUMENT";

/** 统一解析实体所属项目，避免各 API 只校验调用方提交的 projectId。null 表示跨项目公共文档。 */
export async function entityProjectId(entityType: ProjectEntityType, entityId: string): Promise<string | null> {
  switch (entityType) {
    case "PROJECT": {
      const row = await prisma.project.findUnique({ where: { id: entityId }, select: { id: true } });
      if (!row) throw new ApiError(404, "项目不存在");
      return row.id;
    }
    case "TASK": {
      const row = await prisma.task.findUnique({ where: { id: entityId }, select: { projectId: true } });
      if (!row) throw new ApiError(404, "任务不存在");
      return row.projectId;
    }
    case "BOM_ITEM": {
      const row = await prisma.bomItem.findUnique({ where: { id: entityId }, select: { projectId: true } });
      if (!row) throw new ApiError(404, "BOM 条目不存在");
      return row.projectId;
    }
    case "TECH_SPEC": {
      const row = await prisma.techSpec.findUnique({ where: { id: entityId }, select: { projectId: true } });
      if (!row) throw new ApiError(404, "技术参数不存在");
      return row.projectId;
    }
    case "ECO": {
      const row = await prisma.changeLog.findUnique({ where: { id: entityId }, select: { projectId: true } });
      if (!row) throw new ApiError(404, "ECO 不存在");
      return row.projectId;
    }
    case "ECR": {
      const row = await prisma.changeRequest.findUnique({ where: { id: entityId }, select: { projectId: true } });
      if (!row) throw new ApiError(404, "ECR 不存在");
      return row.projectId;
    }
    case "DOCUMENT": {
      const row = await prisma.document.findUnique({ where: { id: entityId }, select: { projectId: true } });
      if (!row) throw new ApiError(404, "文档不存在");
      return row.projectId;
    }
  }
}

export async function requireEntityAccess(user: SessionUser, entityType: ProjectEntityType, entityId: string) {
  const projectId = await entityProjectId(entityType, entityId);
  if (projectId) await requireProjectAccess(user, projectId);
  return projectId;
}

export async function requireEntityPerm(code: PermissionCode, entityType: ProjectEntityType, entityId: string) {
  const projectId = await entityProjectId(entityType, entityId);
  return requirePerm(code, projectId ?? undefined);
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
  // Next.js 构建期用该信号把路由判定为动态；必须继续抛出，不能误记成业务 500。
  if ((err as { digest?: string } | null)?.digest === "DYNAMIC_SERVER_USAGE") throw err;
  if (err instanceof ApiError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof Error && err.name === "ZodError") {
    const issue = (err as Error & { issues?: Array<{ code?: string; message?: string }> }).issues?.[0];
    const issueMessage = issue?.code === "custom" && issue.message && issue.message.length <= 160 && !/[\r\n\u0000-\u001f]/.test(issue.message)
      ? issue.message
      : "参数校验失败";
    return Response.json({ error: issueMessage }, { status: 400 });
  }
  console.error("[API Error]", err);
  return Response.json({ error: "服务器内部错误" }, { status: 500 });
}
