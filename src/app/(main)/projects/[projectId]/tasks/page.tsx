"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { Card, Segmented, Button, Space, Input, App } from "antd";
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { get } from "@/lib/api-client";
import KanbanBoard from "@/components/tasks/KanbanBoard";
import TaskTable from "@/components/tasks/TaskTable";
import GanttView from "@/components/tasks/GanttView";
import TaskForm from "@/components/tasks/TaskForm";
import { useProject } from "../ProjectContext";
import type { TaskItem } from "@/components/tasks/types";
import { useSession } from "next-auth/react";

export default function TasksPageWrapper() {
  return (
    <Suspense>
      <TasksPage />
    </Suspense>
  );
}

function TasksPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { project } = useProject();
  const { message } = App.useApp();
  const { data: session } = useSession();
  const permissions = project?.currentUserAccess.permissions ?? [];
  const canCreate = permissions.includes("task:create");
  const canUpdateAll = permissions.includes("task:update");
  const canUpdateOwn = permissions.includes("task:update_own");
  const canAssign = permissions.includes("task:assign");
  const canLogTime = permissions.includes("time:log");
  const canComment = project?.currentUserAccess.role !== "viewer";
  const canEditTask = (task: TaskItem) => canUpdateAll || (canUpdateOwn && (task.assigneeId === session?.user?.id || task.createdBy === session?.user?.id));

  const view = searchParams.get("view") ?? "kanban";
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TaskItem | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    get<TaskItem[]>(`/api/tasks?projectId=${projectId}`)
      .then(setTasks)
      .catch((e) => message.error(e.message))
      .finally(() => setLoading(false));
  }, [projectId, message]);

  useEffect(load, [load]);

  // Ctrl+N 新建任务
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (canCreate && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setEditing(null);
        setFormOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [canCreate]);

  const openEdit = (task: TaskItem) => {
    setEditing(task);
    setFormOpen(true);
  };

  const filtered = q ? tasks.filter((t) => t.title.includes(q)) : tasks;

  return (
    <Card
      size="small"
      title={
        <Segmented
          value={view}
          onChange={(v) => router.push(`/projects/${projectId}/tasks?view=${v}`)}
          options={[
            { value: "kanban", label: "看板视图" },
            { value: "table", label: "表格视图" },
            { value: "gantt", label: "甘特图" },
          ]}
        />
      }
      extra={
        <Space>
          <Input allowClear prefix={<SearchOutlined />} placeholder="筛选任务标题" style={{ width: 200 }}
            value={q} onChange={(e) => setQ(e.target.value)} />
          {canCreate && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); setFormOpen(true); }}>
              新建任务 (Ctrl+N)
            </Button>
          )}
        </Space>
      }
      loading={loading && view !== "kanban"}
    >
      {view === "kanban" && <KanbanBoard tasks={filtered} onCardClick={openEdit} onChanged={load} canEditTask={canEditTask} />}
      {view === "table" && (
        <TaskTable tasks={filtered} phases={project?.phases ?? []} onRowClick={openEdit} onChanged={load} projectId={projectId} canEditTask={canEditTask} canBatchEdit={canUpdateAll} canAssign={canAssign} />
      )}
      {view === "gantt" && <GanttView projectId={projectId} />}

      <TaskForm
        open={formOpen}
        task={editing}
        projectId={projectId}
        phases={project?.phases ?? []}
        canEdit={!editing || canEditTask(editing)}
        canAssign={canAssign}
        canLogTime={canLogTime}
        canComment={canComment}
        onClose={(changed) => {
          setFormOpen(false);
          setEditing(null);
          if (changed) load();
        }}
      />
    </Card>
  );
}
