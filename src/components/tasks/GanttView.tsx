"use client";

import { useEffect, useRef, useState } from "react";
import { Segmented, Empty, Space, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { get } from "@/lib/api-client";
import "frappe-gantt/dist/frappe-gantt.css";

interface GanttData {
  tasks: {
    id: string; title: string; status: string; priority: string;
    startDate?: string | null; dueDate?: string | null; isMilestone: boolean;
    assignee?: { name: string } | null;
  }[];
  dependencies: { id: string; predecessorId: string; successorId: string }[];
  milestones: { id: string; name: string; date: string; status: string }[];
  phases: { id: string; phaseName: string; targetDate?: string | null; status: string }[];
}

const STATUS_CLASS: Record<string, string> = {
  "To Do": "bar-todo",
  "In Progress": "bar-progress",
  Blocked: "bar-blocked",
  Testing: "bar-testing",
  Done: "bar-done",
};

export default function GanttView({ projectId }: { projectId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const ganttRef = useRef<{ refresh: (tasks: unknown[]) => void; change_view_mode: (m: string) => void } | null>(null);
  const [data, setData] = useState<GanttData | null>(null);
  const [mode, setMode] = useState<string>("Week");

  useEffect(() => {
    get<GanttData>(`/api/tasks?projectId=${projectId}&view=gantt`).then(setData).catch(() => setData(null));
  }, [projectId]);

  useEffect(() => {
    if (!data || !ref.current) return;
    const ganttTasks = data.tasks
      .filter((t) => t.startDate || t.dueDate)
      .map((t) => {
        const start = t.startDate ?? t.dueDate!;
        const end = t.dueDate ?? t.startDate!;
        const deps = data.dependencies.filter((d) => d.successorId === t.id).map((d) => d.predecessorId);
        return {
          id: t.id,
          name: `${t.isMilestone ? "◆ " : ""}${t.title}`,
          start: dayjs(start).format("YYYY-MM-DD"),
          end: dayjs(dayjs(end).isBefore(dayjs(start)) ? start : end).add(1, "day").format("YYYY-MM-DD"),
          progress: t.status === "Done" ? 100 : t.status === "In Progress" ? 50 : 0,
          dependencies: deps.join(","),
          custom_class: STATUS_CLASS[t.status] ?? "",
        };
      });
    // 里程碑追加为单点任务
    for (const ms of data.milestones) {
      ganttTasks.push({
        id: "ms-" + ms.id,
        name: `◆ ${ms.name}`,
        start: dayjs(ms.date).format("YYYY-MM-DD"),
        end: dayjs(ms.date).add(1, "day").format("YYYY-MM-DD"),
        progress: ms.status === "done" ? 100 : 0,
        dependencies: "",
        custom_class: "bar-milestone",
      });
    }

    let cancelled = false;
    // 直接使用 UMD 成品构建，避免编译包内 scss 源码
    import("frappe-gantt/dist/frappe-gantt.js").then((mod) => {
      if (cancelled || !ref.current) return;
      const Gantt = mod.default;
      ref.current.innerHTML = "";
      ganttRef.current = new Gantt(ref.current, ganttTasks, {
        view_mode: mode,
        language: "zh",
        readonly: true,
        popup: (ctx: { task: { name: string; _start: Date; _end: Date; progress: number } }) =>
          `<div class="title">${ctx.task.name}</div>
           <div class="subtitle">${dayjs(ctx.task._start).format("YYYY-MM-DD")} ~ ${dayjs(ctx.task._end).format("YYYY-MM-DD")}</div>
           <p>完成度 ${ctx.task.progress}%</p>`,
      }) as unknown as typeof ganttRef.current;
    });
    return () => {
      cancelled = true;
    };
  }, [data, mode]);

  if (data && data.tasks.length === 0) return <Empty description="暂无任务" />;

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Segmented
          value={mode}
          onChange={(v) => setMode(String(v))}
          options={[
            { value: "Day", label: "日" },
            { value: "Week", label: "周" },
            { value: "Month", label: "月" },
            { value: "Year", label: "季度/年" },
          ]}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          依赖冲突请通过调整任务日期解决（只读视图，拖拽编辑在表格/看板中完成）
        </Typography.Text>
      </Space>
      <div ref={ref} className="gantt-container" />
      <style jsx global>{`
        .gantt .bar-todo .bar { fill: #bfbfbf; }
        .gantt .bar-progress .bar { fill: #1677ff; }
        .gantt .bar-blocked .bar { fill: #cf1322; }
        .gantt .bar-testing .bar { fill: #fa8c16; }
        .gantt .bar-done .bar { fill: #52c41a; }
        .gantt .bar-milestone .bar { fill: #722ed1; }
      `}</style>
    </div>
  );
}
