"use client";

import { SessionProvider } from "next-auth/react";
import AppShell from "@/components/layout/AppShell";

export default function MainShell({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
