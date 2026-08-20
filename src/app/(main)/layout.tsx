import { redirect } from "next/navigation";
import MainShell from "@/components/layout/MainShell";
import { ApiError, requireAuth } from "@/lib/rbac";

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  let redirectTo: string | null = null;
  try {
    await requireAuth();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirectTo = "/session-revoked";
    else if (error instanceof ApiError && error.status === 403) redirectTo = "/change-password";
    else throw error;
  }

  if (redirectTo === "/session-revoked") redirect("/session-revoked");
  if (redirectTo === "/change-password") redirect("/change-password");
  return <MainShell>{children}</MainShell>;
}
