import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { validatePassword } from "@/lib/passwordPolicy";
import { ApiError, apiError, requireAuth } from "@/lib/rbac";

const strongPasswordSchema = z.string().min(1).max(128).superRefine((password, ctx) => {
  for (const message of validatePassword(password).errors) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  }
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: strongPasswordSchema,
}).strict();

export async function POST(req: Request) {
  try {
    const sessionUser = await requireAuth({ allowPasswordChange: true });
    const data = changePasswordSchema.parse(await req.json());
    const expectedSessionVersion = sessionUser.sessionVersion;
    if (typeof expectedSessionVersion !== "number" || !Number.isInteger(expectedSessionVersion)) {
      throw new ApiError(401, "会话已被撤销，请重新登录");
    }

    await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({
        where: { id: sessionUser.id },
        select: { id: true, status: true, passwordHash: true, sessionVersion: true },
      });
      if (!current || current.status !== "active") throw new ApiError(401, "账号已停用或不存在");
      if (current.sessionVersion !== expectedSessionVersion) throw new ApiError(401, "会话已被撤销，请重新登录");
      if (!await bcrypt.compare(data.currentPassword, current.passwordHash)) {
        throw new ApiError(400, "当前密码不正确");
      }
      if (await bcrypt.compare(data.newPassword, current.passwordHash)) {
        throw new ApiError(400, "新密码不能与当前密码相同");
      }

      const passwordHash = await bcrypt.hash(data.newPassword, 10);
      const updated = await tx.user.updateMany({
        where: { id: current.id, status: "active", sessionVersion: expectedSessionVersion },
        data: {
          passwordHash,
          mustChangePassword: false,
          passwordChangedAt: new Date(),
          sessionVersion: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new ApiError(401, "会话已被撤销，请重新登录");
      await writeAudit({
        userId: current.id,
        action: "PASSWORD_CHANGE",
        entityType: "USER",
        entityId: current.id,
        diff: { credential: { from: "temporary-or-existing", to: "user-chosen" }, mustChangePassword: false, sessionsRevoked: true },
      }, tx);
    });

    return Response.json({ ok: true, requiresReauthentication: true });
  } catch (e) {
    return apiError(e);
  }
}
