"use client";

import { useState } from "react";
import { Card, Tag, Typography, App } from "antd";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import dayjs from "dayjs";
import { patch } from "@/lib/api-client";
import { TASK_STATUSES } from "@/lib/constants";
import { PriorityTag } from "@/components/common/Tags";
import type { TaskItem } from "./types";

const COLUMN_COLORS: Record<string, string> = {
  "To Do": "#8c8c8c",
  "In Progress": "#1677ff",
  Blocked: "#cf1322",
  Testing: "#fa8c16",
  Done: "#52c41a",
};

function KanbanCard({ task, onClick, overlay, canDrag = true }: { task: TaskItem; onClick?: () => void; overlay?: boolean; canDrag?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id, disabled: !canDrag });
  const overdue = task.dueDate && task.status !== "Done" && dayjs(task.dueDate).isBefore(dayjs(), "day");
  return (
    <Card
      ref={setNodeRef}
      size="small"
      className={isDragging ? "kanban-card-dragging" : undefined}
      style={{
        marginBottom: 8,
        cursor: canDrag ? "grab" : "pointer",
        transform: CSS.Translate.toString(transform),
        opacity: overlay ? 0.95 : undefined,
        borderLeft: `3px solid ${COLUMN_COLORS[task.status] ?? "#ddd"}`,
      }}
      {...listeners}
      {...attributes}
      onClick={onClick}
    >
      <Typography.Text strong style={{ fontSize: 13 }}>{task.title}</Typography.Text>
      <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
        <PriorityTag value={task.priority} />
        {task.phase && <Tag color="purple">{task.phase.phaseName}</Tag>}
        {task.isMilestone && <Tag color="gold">里程碑</Tag>}
        {task.eco && <Tag color="red">{task.eco.ecoNumber}</Tag>}
      </div>
      <div style={{ marginTop: 6, display: "flex", justifyContent: "space-between", fontSize: 12 }}>
        <Typography.Text type="secondary">{task.assignee?.name ?? "未分配"}</Typography.Text>
        {task.dueDate && (
          <Typography.Text type={overdue ? "danger" : "secondary"}>
            {dayjs(task.dueDate).format("MM-DD")}{overdue ? " 逾期" : ""}
          </Typography.Text>
        )}
      </div>
    </Card>
  );
}

function KanbanColumn({ status, tasks, onCardClick, canEditTask }: { status: string; tasks: TaskItem[]; onCardClick: (t: TaskItem) => void; canEditTask: (task: TaskItem) => boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      style={{
        flex: "1 0 220px",
        minWidth: 220,
        background: isOver ? "#e6f4ff" : "#f7f8fa",
        borderRadius: 8,
        padding: 8,
        minHeight: 300,
        transition: "background 0.15s",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 6px 10px" }}>
        <Typography.Text strong style={{ color: COLUMN_COLORS[status] }}>{status}</Typography.Text>
        <Typography.Text type="secondary">{tasks.length}</Typography.Text>
      </div>
      {tasks.map((t) => (
        <KanbanCard key={t.id} task={t} onClick={() => onCardClick(t)} canDrag={canEditTask(t)} />
      ))}
    </div>
  );
}

interface Props {
  tasks: TaskItem[];
  onCardClick: (task: TaskItem) => void;
  onChanged: () => void;
  canEditTask: (task: TaskItem) => boolean;
}

export default function KanbanBoard({ tasks, onCardClick, onChanged, canEditTask }: Props) {
  const [active, setActive] = useState<TaskItem | null>(null);
  const { message } = App.useApp();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragStart = (e: DragStartEvent) => {
    setActive(tasks.find((t) => t.id === e.active.id) ?? null);
  };

  const onDragEnd = async (e: DragEndEvent) => {
    const taskId = String(e.active.id);
    const over = e.over?.id;
    setActive(null);
    if (!over) return;
    const newStatus = String(over);
    const task = tasks.find((t) => t.id === taskId);
    if (!task || !canEditTask(task) || task.status === newStatus || !TASK_STATUSES.includes(newStatus as never)) return;
    try {
      await patch(`/api/tasks/${taskId}`, { status: newStatus });
      onChanged();
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 8 }}>
        {TASK_STATUSES.map((status) => (
          <KanbanColumn key={status} status={status} tasks={tasks.filter((t) => t.status === status)} onCardClick={onCardClick} canEditTask={canEditTask} />
        ))}
      </div>
      <DragOverlay>{active ? <KanbanCard task={active} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}
