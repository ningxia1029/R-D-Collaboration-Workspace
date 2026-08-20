"use client";

import { useEffect, useState } from "react";
import { Table, Select, DatePicker, Input, Space, Button, App, Dropdown, Tag } from "antd";
import { DownOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { patch } from "@/lib/api-client";
import { TASK_STATUSES, PRIORITIES } from "@/lib/constants";
import { StatusTag, PriorityTag } from "@/components/common/Tags";
import type { TaskItem } from "./types";

interface Props {
  tasks: TaskItem[];
  phases: { id: string; phaseName: string }[];
  onRowClick: (task: TaskItem) => void;
  onChanged: () => void;
  projectId: string;
  canEditTask: (task: TaskItem) => boolean;
  canBatchEdit: boolean;
  canAssign: boolean;
}

/** 双击进入行内编辑的单元格 */
function EditableCell({
  value,
  onSave,
  editor,
  editable,
}: {
  value: React.ReactNode;
  onSave: (v: unknown) => Promise<void>;
  editor: (commit: (v: unknown) => void, cancel: () => void) => React.ReactNode;
  editable: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const commit = async (v: unknown) => {
    setEditing(false);
    await onSave(v);
  };
  return (
    <div className="inline-edit-cell" onDoubleClick={(e) => { if (editable) { e.stopPropagation(); setEditing(true); } }}>
      {editing ? editor(commit, () => setEditing(false)) : value ?? "—"}
    </div>
  );
}

export default function TaskTable({ tasks, phases, onRowClick, onChanged, projectId, canEditTask, canBatchEdit, canAssign }: Props) {
  const { message } = App.useApp();
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [filters, setFilters] = useState<{ status?: string; priority?: string; phaseId?: string }>({});
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    import("@/lib/api-client").then(({ get }) =>
      get<{ user: { id: string; name: string; status: string } }[]>(`/api/projects/${projectId}/members`)
        .then((members) => setUsers(members.filter((member) => member.user.status === "active").map((member) => member.user)))
        .catch(() => undefined)
    );
  }, [projectId]);

  // Space 快捷键：切换勾选聚焦行
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        const focused = document.activeElement?.closest("tr[data-row-key]");
        if (focused) {
          e.preventDefault();
          const key = focused.getAttribute("data-row-key")!;
          setSelectedKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const saveField = async (id: string, field: string, value: unknown) => {
    try {
      await patch(`/api/tasks/${id}`, { [field]: value });
      onChanged();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const batchUpdate = async (patchData: Record<string, unknown>) => {
    try {
      await patch("/api/tasks/batch", { ids: selectedKeys, patch: patchData, projectId });
      message.success(`已批量更新 ${selectedKeys.length} 条任务`);
      setSelectedKeys([]);
      onChanged();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const filtered = tasks.filter(
    (t) =>
      (!filters.status || t.status === filters.status) &&
      (!filters.priority || t.priority === filters.priority) &&
      (!filters.phaseId || t.phaseId === filters.phaseId)
  );

  return (
    <>
      <Space style={{ marginBottom: 12 }} wrap>
        <Select allowClear placeholder="状态" style={{ width: 130 }}
          options={TASK_STATUSES.map((s) => ({ value: s, label: s }))}
          onChange={(v) => setFilters((f) => ({ ...f, status: v }))} />
        <Select allowClear placeholder="优先级" style={{ width: 100 }}
          options={PRIORITIES.map((p) => ({ value: p, label: p }))}
          onChange={(v) => setFilters((f) => ({ ...f, priority: v }))} />
        <Select allowClear placeholder="试制阶段" style={{ width: 140 }}
          options={phases.map((p) => ({ value: p.id, label: p.phaseName }))}
          onChange={(v) => setFilters((f) => ({ ...f, phaseId: v }))} />
        {canBatchEdit && selectedKeys.length > 0 && (
          <Dropdown
            menu={{
              items: [
                ...TASK_STATUSES.map((s) => ({ key: `status:${s}`, label: `状态 → ${s}` })),
                ...PRIORITIES.map((p) => ({ key: `priority:${p}`, label: `优先级 → ${p}` })),
              ],
              onClick: ({ key }) => {
                const [field, value] = key.split(":");
                batchUpdate({ [field]: value });
              },
            }}
          >
            <Button>
              批量更新 ({selectedKeys.length}) <DownOutlined />
            </Button>
          </Dropdown>
        )}
      </Space>
      <Table
        rowKey="id"
        size="small"
        dataSource={filtered}
        pagination={false}
        rowSelection={canBatchEdit ? { selectedRowKeys: selectedKeys, onChange: setSelectedKeys } : undefined}
        onRow={(record) => ({ onClick: () => onRowClick(record), tabIndex: 0 })}
        columns={[
          {
            title: "任务", dataIndex: "title", ellipsis: true,
            render: (v: string, r) => (
              <Space size={4}>
                {r.parentId && <Tag style={{ marginRight: 0 }}>子</Tag>}
                {r.isMilestone && <Tag color="gold" style={{ marginRight: 0 }}>◆</Tag>}
                <EditableCell value={v} editable={canEditTask(r)} onSave={(nv) => saveField(r.id, "title", nv)}
                  editor={(commit, cancel) => (
                    <Input size="small" autoFocus defaultValue={v}
                      onBlur={cancel}
                      onPressEnter={(e) => commit((e.target as HTMLInputElement).value)} />
                  )} />
              </Space>
            ),
          },
          {
            title: "状态", dataIndex: "status", width: 130,
            sorter: (a, b) => a.status.localeCompare(b.status),
            render: (v: string, r) => (
              <EditableCell value={<StatusTag value={v} />} editable={canEditTask(r)} onSave={(nv) => saveField(r.id, "status", nv)}
                editor={(commit) => (
                  <Select size="small" autoFocus defaultOpen defaultValue={v} style={{ width: 120 }}
                    options={TASK_STATUSES.map((s) => ({ value: s, label: s }))}
                    onChange={commit} />
                )} />
            ),
          },
          {
            title: "优先级", dataIndex: "priority", width: 90,
            sorter: (a, b) => a.priority.localeCompare(b.priority),
            render: (v: string, r) => (
              <EditableCell value={<PriorityTag value={v} />} editable={canEditTask(r)} onSave={(nv) => saveField(r.id, "priority", nv)}
                editor={(commit) => (
                  <Select size="small" autoFocus defaultOpen defaultValue={v} style={{ width: 80 }}
                    options={PRIORITIES.map((p) => ({ value: p, label: p }))}
                    onChange={commit} />
                )} />
            ),
          },
          {
            title: "负责人", dataIndex: ["assignee", "name"], width: 110,
            render: (v: string, r) => (
              <EditableCell value={v} editable={canEditTask(r) && canAssign} onSave={(nv) => saveField(r.id, "assigneeId", nv)}
                editor={(commit) => (
                  <Select size="small" autoFocus defaultOpen defaultValue={r.assigneeId} allowClear style={{ width: 130 }}
                    options={users.map((u) => ({ value: u.id, label: u.name }))}
                    onChange={commit} />
                )} />
            ),
          },
          {
            title: "阶段", dataIndex: ["phase", "phaseName"], width: 110,
            render: (v: string, r) => (
              <EditableCell value={v ? <Tag color="purple">{v}</Tag> : "—"} editable={canEditTask(r)} onSave={(nv) => saveField(r.id, "phaseId", nv)}
                editor={(commit) => (
                  <Select size="small" autoFocus defaultOpen defaultValue={r.phaseId} allowClear style={{ width: 120 }}
                    options={phases.map((p) => ({ value: p.id, label: p.phaseName }))}
                    onChange={commit} />
                )} />
            ),
          },
          {
            title: "截止日期", dataIndex: "dueDate", width: 120,
            sorter: (a, b) => dayjs(a.dueDate).unix() - dayjs(b.dueDate).unix(),
            render: (v: string, r) => {
              const overdue = v && r.status !== "Done" && dayjs(v).isBefore(dayjs(), "day");
              return (
                <EditableCell
                  editable={canEditTask(r)}
                  value={v ? <span className={overdue ? "eta-overdue" : undefined}>{dayjs(v).format("YYYY-MM-DD")}</span> : "—"}
                  onSave={(nv) => saveField(r.id, "dueDate", nv)}
                  editor={(commit) => (
                    <DatePicker size="small" autoFocus defaultOpen defaultValue={v ? dayjs(v) : undefined}
                      onChange={(d) => commit(d?.toISOString() ?? null)} />
                  )} />
              );
            },
          },
          {
            title: "工时(估/实)", width: 100,
            render: (_, r) => <span>{r.estimatedHours ?? "—"}</span>,
          },
          {
            title: "ECO", width: 120,
            render: (_, r) => (r.eco ? <Tag color="red">{r.eco.ecoNumber}</Tag> : "—"),
          },
        ]}
      />
    </>
  );
}
