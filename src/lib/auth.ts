import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import authConfig from "@/lib/auth.config";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_ATTEMPT_CAPACITY = 10_000;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function pruneLoginAttempts(now: number) {
  for (const [key, attempt] of loginAttempts) {
    if (attempt.resetAt <= now) loginAttempts.delete(key);
  }
}

function loginAttemptKey(clientIp: string, email: string) {
  return `${clientIp}\n${email}`;
}

function clientIpFromRequest(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

function isLoginBlocked(key: string, now = Date.now()) {
  pruneLoginAttempts(now);
  const attempt = loginAttempts.get(key);
  if (!attempt) return false;
  if (attempt.resetAt <= now) {
    loginAttempts.delete(key);
    return false;
  }
  return attempt.count >= LOGIN_MAX_FAILURES;
}

function recordLoginFailure(key: string, now = Date.now()) {
  pruneLoginAttempts(now);
  const current = loginAttempts.get(key);
  if (!current || current.resetAt <= now) {
    if (loginAttempts.size >= LOGIN_ATTEMPT_CAPACITY) {
      const oldestKey = loginAttempts.keys().next().value;
      if (oldestKey !== undefined) loginAttempts.delete(oldestKey);
    }
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }
  current.count += 1;
  loginAttempts.delete(key);
  loginAttempts.set(key, current);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "账号密码登录",
      credentials: {
        email: { label: "邮箱", type: "email" },
        password: { label: "密码", type: "password" },
      },
      async authorize(credentials, request) {
        const email = (credentials?.email as string | undefined)?.trim().toLowerCase();
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;
        const clientIp = clientIpFromRequest(request);
        const attemptKey = loginAttemptKey(clientIp, email);
        if (isLoginBlocked(attemptKey)) return null;

        const user = await prisma.user.findUnique({
          where: { email },
          include: { role: true },
        });
        if (!user || user.status !== "active") {
          recordLoginFailure(attemptKey);
          return null;
        }

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) {
          recordLoginFailure(attemptKey);
          return null;
        }
        loginAttempts.delete(attemptKey);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          roleId: user.roleId,
          roleName: user.role.name,
          mustChangePassword: user.mustChangePassword,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
  ],
});
