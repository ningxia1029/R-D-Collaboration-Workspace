import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      roleId: string;
      roleName: string;
      mustChangePassword: boolean;
      sessionVersion: number;
    } & DefaultSession["user"];
  }

  interface User {
    roleId?: string;
    roleName?: string;
    mustChangePassword?: boolean;
    sessionVersion?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    roleId?: string;
    roleName?: string;
    mustChangePassword?: boolean;
    sessionVersion?: number;
  }
}
