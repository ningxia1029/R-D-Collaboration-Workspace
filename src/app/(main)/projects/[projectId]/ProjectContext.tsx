"use client";

import { createContext, useContext } from "react";

export interface ProjectDetail {
  id: string; name: string; code: string; status: string; lifecycleStage: string;
  description?: string;
  productId?: string | null; startDate?: string | null; endDate?: string | null;
  owner?: { id: string; name: string } | null;
  product?: { id: string; name: string; code: string } | null;
  phases: { id: string; phaseName: string; targetDate?: string | null; status: string; sortOrder: number }[];
  milestones: { id: string; name: string; date: string; status: string }[];
  members: { userId: string; user: { id: string; name: string } }[];
  currentUserAccess: { role: string; permissions: string[] };
}

export const ProjectCtx = createContext<{ project: ProjectDetail | null; reload: () => void }>({
  project: null,
  reload: () => undefined,
});
export const useProject = () => useContext(ProjectCtx);
