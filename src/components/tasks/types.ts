export interface TaskItem {
  id: string;
  projectId: string;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  phaseId?: string | null;
  dueDate?: string | null;
  startDate?: string | null;
  ecoId?: string | null;
  parentId?: string | null;
  assigneeId?: string | null;
  estimatedHours?: number | null;
  isMilestone: boolean;
  sortOrder: number;
  createdBy?: string | null;
  assignee?: { id: string; name: string } | null;
  phase?: { id: string; phaseName: string } | null;
  eco?: { id: string; ecoNumber: string } | null;
  links?: { id: string; entityType: string; entityId: string }[];
}
