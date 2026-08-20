import { requirePerm, apiError, ApiError } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { validatePassword } from "@/lib/passwordPolicy";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { Prisma } from "@prisma/client";

const strongPasswordSchema = z.string().min(1).max(128).superRefine((password, ctx) => {
  for (const message of validatePassword(password).errors) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  }
});

const createUserSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  name: z.string().trim().min(1).max(100),
  password: strongPasswordSchema,
  roleId: z.string().min(1).max(64),
}).strict();

const optionalPasswordSchema = z.preprocess(
  (value) => value === "" ? undefined : value,
  strongPasswordSchema.optional(),
);

const updateUserSchema = z.object({
  id: z.string().min(1).max(64),
  email: z.string().trim().email().max(254).optional(),
  name: z.string().trim().min(1).max(100).optional(),
  password: optionalPasswordSchema,
  roleId: z.string().min(1).max(64).optional(),
  status: z.enum(["active", "disabled"]).optional(),
}).strict().refine(
  ({ email: _email, id: _id, ...patch }) => Object.values(patch).some((value) => value !== undefined),
  { message: "至少提供一个需要更新的字段" },
);

const publicUserSelect = {
  id: true,
  email: true,
  name: true,
  roleId: true,
  status: true,
  mustChangePassword: true,
  passwordChangedAt: true,
  sessionVersion: true,
  createdAt: true,
  role: true,
  _count: { select: { memberships: true, assignedTasks: true } },
} satisfies Prisma.UserSelect;

export async function GET() {
  try {
    await requirePerm("admin:user_manage");
    return Response.json(
      await prisma.user.findMany({
        select: publicUserSelect,
        orderBy: { createdAt: "asc" },
      })
    );
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const actor = await requirePerm("admin:user_manage");
    const data = createUserSchema.parse(await req.json());
    const passwordHash = await bcrypt.hash(data.password, 10);
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: data.email,
          name: data.name,
          passwordHash,
          roleId: data.roleId,
          mustChangePassword: true,
        },
        select: publicUserSelect,
      });
      await writeAudit({
        userId: actor.id,
        action: "CREATE",
        entityType: "USER",
        entityId: created.id,
        diff: { email: created.email, name: created.name, roleId: created.roleId, status: created.status, mustChangePassword: true },
      }, tx);
      return created;
    });
    return Response.json(user, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(req: Request) {
  try {
    const actor = await requirePerm("admin:user_manage");
    const data = updateUserSchema.parse(await req.json());
    const user = await prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({
        where: { id: data.id },
        select: { id: true, email: true, name: true, roleId: true, status: true, passwordHash: true, mustChangePassword: true },
      });
      if (!before) throw new ApiError(404, "用户不存在");
      if (data.email && data.email.toLowerCase() !== before.email.toLowerCase()) {
        throw new ApiError(400, "此接口不允许修改登录邮箱");
      }

      const patch: Prisma.UserUncheckedUpdateInput = {};
      const changes: Record<string, unknown> = {};
      let revokeSessions = false;

      if (data.name !== undefined && data.name !== before.name) {
        patch.name = data.name;
        changes.name = { from: before.name, to: data.name };
      }
      if (data.roleId !== undefined && data.roleId !== before.roleId) {
        patch.roleId = data.roleId;
        changes.roleId = { from: before.roleId, to: data.roleId };
        revokeSessions = true;
      }
      if (data.status !== undefined && data.status !== before.status) {
        patch.status = data.status;
        changes.status = { from: before.status, to: data.status };
        revokeSessions = true;
      }
      if (data.password !== undefined) {
        if (await bcrypt.compare(data.password, before.passwordHash)) {
          throw new ApiError(400, "临时密码不能与当前密码相同");
        }
        patch.passwordHash = await bcrypt.hash(data.password, 10);
        patch.mustChangePassword = true;
        patch.passwordChangedAt = null;
        changes.credential = { from: "existing", to: "temporary" };
        changes.mustChangePassword = { from: before.mustChangePassword, to: true };
        revokeSessions = true;
      }
      if (revokeSessions) patch.sessionVersion = { increment: 1 };

      if (Object.keys(changes).length > 0) {
        await tx.user.update({ where: { id: data.id }, data: patch });
        await writeAudit({
          userId: actor.id,
          action: data.password !== undefined ? "PASSWORD_RESET" : "UPDATE",
          entityType: "USER",
          entityId: data.id,
          diff: changes,
        }, tx);
      }

      return tx.user.findUniqueOrThrow({ where: { id: data.id }, select: publicUserSelect });
    });
    return Response.json(user);
  } catch (e) {
    return apiError(e);
  }
}
