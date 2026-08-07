// Edge 安全的 NextAuth 配置（不引入 Prisma/bcrypt，供 middleware 使用）
import type { NextAuthConfig } from "next-auth";

export default {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [], // 实际 provider 在 auth.ts 中注入（Node 运行时）
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id as string;
        token.roleId = (user as { roleId?: string }).roleId ?? "";
        token.roleName = (user as { roleName?: string }).roleName ?? "";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.userId as string) ?? "";
        session.user.roleId = (token.roleId as string) ?? "";
        session.user.roleName = (token.roleName as string) ?? "";
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
