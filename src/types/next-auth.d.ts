import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      roleId: string;
      roleName: string;
    } & DefaultSession["user"];
  }

  interface User {
    roleId?: string;
    roleName?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    roleId?: string;
    roleName?: string;
  }
}
