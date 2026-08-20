"use client";

import { useEffect, useState } from "react";
import { Drawer, Form, Input, Select, DatePicker, InputNumber, Switch, Button, Space, App, Divider, List, Tag, Popconfirm } from "antd";
import { PlusOutlined, DeleteOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { get, post, patch, del } from "@/lib/api-client";
import { TASK_STATUSES, PRIORITIES } from "@/lib/constants";
import CommentsSection from "@/components/common/CommentsSection";
import type { TaskItem } from "./types";

interface Props {
  open: boolean;
  task?: TaskItem | null;
  projectId: string;
  phases: { id: string; phaseName: string }[];
  canEdit: boolean;
  canAssign: boolean;
  canLogTime: boolean;
  canComment: boolean;
  onClose: (changed?: boolean) => void;
}

interface UserOption { id: string; name: string }
interface LinkItem { id: string; entityType: string; entityId: string }
interface DependencyItem {
  id: string; predecessorId: string; successorId: string;
  predecessor: { id: string; title: string }; successor: { id: string; title: string };
}
interface TimeEntryItem { id: string; date: string; hours: number; note?: string | null; user: { id: string; name: string } }

const ENTITY_TYPES = [
  { value: "PRODUCT", label: "产品" },
  { value: "BOM_ITEM", label: "BOM 条目" },
  { value: "DOCUMENT", label: "知识库文档" },
  { value: "TECH_SPEC", label: "技术参数" },
  { value: "ECO", label: "ECO" },
];

export default function TaskForm({ open, task, projectId, phases, canEdit, canAssign, canLogTime, canComment, onClose }: Props) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const [users, setUsers] = useState<UserOption[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [docs, setDocs] = useState<{ id: string; title: string; projectId?: string | null }[]>([]);
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [newLink, setNewLink] = useState<{ entityType: string; entityId: string }>({ entityType: "DOCUMENT", entityId: "" });
  const [dependencies, setDependencies] = useState<DependencyItem[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntryItem[]>([]);
  const [timeHours, setTimeHours] = useState<number | null>(null);
  const [timeNote, setTimeNote] = useState("");
  const [linkCatalog, setLinkCatalog] = useState<Record<string, { value: string; label: string }[]>>({});
  const [newDep, setNewDep] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    get<{ user: UserOption & { status: string } }[]>(`/api/projects/${projectId}/members`)
      .then((members) => setUsers(members.filter((member) => member.user.status === "active").map((member) => member.user)))
      .catch(() => undefined);
    get<TaskItem[]>(`/api/tasks?projectId=${projectId}`).then(setTasks).catch(() => undefined);
    get<{ id: string; title: string; projectId?: string | null }[]>("/api/documents")
      .then((items) => setDocs(items.filter((item) => !item.projectId || item.projectId === projectId)))
      .catch(() => undefined);
    Promise.all([
      get<{ id: string; mpn: string; name: string }[]>(`/api/bom?projectId=${projectId}`),
      get<{ id: string; metricName: string }[]>(`/api/specs?projectId=${projectId}`),
      get<{ id: string; ecoNumber: string }[]>(`/api/ecos?projectId=${projectId}`),
      get<{ id: string; code: string; name: string }[]>("/api/plm/products"),
    ]).then(([boms, specs, ecos, products]) => setLinkCatalog({
      BOM_ITEM: boms.map((item) => ({ value: item.id, label: `${item.mpn} ${item.name}` })),
      TECH_SPEC: specs.map((item) => ({ value: item.id, label: item.metricName })),
      ECO: ecos.map((item) => ({ value: item.id, label: item.ecoNumber })),
      PRODUCT: products.map((item) => ({ value: item.id, label: `${item.code} ${item.name}` })),
    })).catch(() => setLinkCatalog({}));
    if (task) {
      form.setFieldsValue({
        ...task,
        startDate: task.startDate ? dayjs(task.startDate) : null,
        dueDate: task.dueDate ? dayjs(task.dueDate) : null,
      });
      get<LinkItem[]>(`/api/links?taskId=${task.id}`).then(setLinks).catch(() => undefined);
      get<DependencyItem[]>(`/api/tasks/${task.id}/dependencies`).then(setDependencies).catch(() => setDependencies([]));
      get<TimeEntryItem[]>(`/api/tasks/${task.id}/time-entries`).then(setTimeEntries).catch(() => setTimeEntries([]));
    } else {
      form.resetFields();
      setLinks([]);
      setDependencies([]);
      setTimeEntries([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task]);

  const onSave = async () => {
    const values = await form.validateFields();
    const payload = {
      ...values,
      startDate: values.startDate?.toISOString() ?? null,
      dueDate: values.dueDate?.toISOString() ?? null,
      projectId,
    };
    try {
      if (task) {
        await patch(`/api/tasks/${task.id}`, payload);
        message.success("任务已更新");
      } else {
        await post("/api/tasks", payload);
        message.success("任务已创建");
      }
      onClose(true);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const addLink = async () => {
    if (!task || !newLink.entityId) return;
    try {
      const link = await post<LinkItem>("/api/links", { taskId: task.id, ...newLink });
      setLinks((prev) => [...prev, link]);
      setNewLink({ entityType: "DOCUMENT", entityId: "" });
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const removeLink = async (id: string) => {
    await del("/api/links", { id });
    setLinks((prev) => prev.filter((l) => l.id !== id));
  };

  const addDependency = async () => {
    if (!task || !newDep) return;
    try {
      await post(`/api/tasks/${task.id}/dependencies`, { successorId: newDep });
      setDependencies(await get<DependencyItem[]>(`/api/tasks/${task.id}/dependencies`));
      message.success("依赖已添加");
      setNewDep("");
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const removeDependency = async (dependencyId: string) => {
    if (!task) return;
    await del(`/api/tasks/${task.id}/dependencies`, { dependencyId });
    setDependencies((prev) => prev.filter((item) => item.id !== dependencyId));
  };

  const addTimeEntry = async () => {
    if (!task || !timeHours) return;
    try {
      await post(`/api/tasks/${task.id}/time-entries`, { hours: timeHours, note: timeNote });
      setTimeEntries(await get<TimeEntryItem[]>(`/api/tasks/${task.id}/time-entries`));
      setTimeHours(null);
      setTimeNote("");
      message.success("工时已登记");
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const linkOptions = (type: string) => {
    if (type === "DOCUMENT") return docs.map((d) => ({ value: d.id, label: d.title }));
    return linkCatalog[type] ?? [];
  };

  return (
    <Drawer
      title={task ? "编辑任务" : "新建任务"}
      open={open}
      width={520}
      onClose={() => onClose(false)}
      extra={canEdit ? <Button type="primary" onClick={onSave}>保存</Button> : <Tag>只读</Tag>}
    >
      <Form form={form} layout="vertical" disabled={!canEdit} initialValues={{ status: "To Do", priority: "P2" }}>
        <Form.Item name="title" label="任务标题" rules={[{ required: true, message: "请输入标题" }]}>
          <Input />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea rows={2} />
        </Form.Item>
        <Space size={12} wrap>
          <Form.Item name="status" label="状态">
            <Select style={{ width: 140 }} options={TASK_STATUSES.map((s) => ({ value: s, label: s }))} />
          </Form.Item>
          <Form.Item name="priority" label="优先级">
            <Select style={{ width: 100 }} options={PRIORITIES.map((p) => ({ value: p, label: p }))} />
          </Form.Item>
          <Form.Item name="phaseId" label="试制阶段">
            <Select style={{ width: 150 }} allowClear options={phases.map((p) => ({ value: p.id, label: p.phaseName }))} />
          </Form.Item>
        </Space>
        <Space size={12} wrap>
          <Form.Item name="assigneeId" label="负责人">
            <Select style={{ width: 160 }} allowClear showSearch optionFilterProp="label" disabled={!canAssign}
              options={users.map((u) => ({ value: u.id, label: u.name }))} />
          </Form.Item>
          <Form.Item name="parentId" label="父任务 (WBS)">
            <Select style={{ width: 200 }} allowClear showSearch optionFilterProp="label"
              options={tasks.filter((x) => x.id !== task?.id).map((x) => ({ value: x.id, label: x.title }))} />
          </Form.Item>
        </Space>
        <Space size={12} wrap>
          <Form.Item name="startDate" label="开始日期"><DatePicker /></Form.Item>
          <Form.Item name="dueDate" label="截止日期"><DatePicker /></Form.Item>
          <Form.Item name="estimatedHours" label="预估工时(h)"><InputNumber min={0} style={{ width: 110 }} /></Form.Item>
        </Space>
        <Form.Item name="isMilestone" label="里程碑任务" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>

      {task && (
        <>
          <Divider orientation="left" plain>追溯关联（产品 / BOM / 文档 / ECO）</Divider>
          <List
            size="small"
            dataSource={links}
            locale={{ emptyText: "暂无关联" }}
            renderItem={(l) => (
              <List.Item
                actions={canEdit ? [
                  <Popconfirm key="del" title="删除关联？" onConfirm={() => removeLink(l.id)}>
                    <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                  </Popconfirm>,
                ] : undefined}
              >
                <Tag>{ENTITY_TYPES.find((x) => x.value === l.entityType)?.label ?? l.entityType}</Tag>
                {l.entityId}
              </List.Item>
            )}
          />
          {canEdit && <Space.Compact style={{ width: "100%" }}>
            <Select style={{ width: 140 }} value={newLink.entityType}
              onChange={(v) => setNewLink({ entityType: v, entityId: "" })} options={ENTITY_TYPES} />
            {linkOptions(newLink.entityType).length > 0 ? (
              <Select style={{ flex: 1 }} showSearch optionFilterProp="label" placeholder="选择关联实体"
                value={newLink.entityId || undefined}
                onChange={(v) => setNewLink({ ...newLink, entityId: v })}
                options={linkOptions(newLink.entityType)} />
            ) : (
              <Input placeholder="输入实体 ID" value={newLink.entityId}
                onChange={(e) => setNewLink({ ...newLink, entityId: e.target.value })} />
            )}
            <Button icon={<PlusOutlined />} onClick={addLink} />
          </Space.Compact>}

          <Divider orientation="left" plain>前置依赖（FS）</Divider>
          <List size="small" dataSource={dependencies} locale={{ emptyText: "暂无依赖" }} renderItem={(dep) => (
            <List.Item actions={canEdit ? [
              <Popconfirm key="del" title="删除依赖？" onConfirm={() => removeDependency(dep.id)}>
                <Button size="small" type="text" danger icon={<DeleteOutlined />} />
              </Popconfirm>,
            ] : undefined}>
              {dep.predecessor.title} → {dep.successor.title}
            </List.Item>
          )} />
          {canEdit && <Space.Compact style={{ width: "100%" }}>
            <Select style={{ flex: 1 }} showSearch optionFilterProp="label" placeholder="选择后继任务（本任务完成后才能开始）"
              value={newDep || undefined} onChange={setNewDep}
              options={tasks.filter((x) => x.id !== task.id).map((x) => ({ value: x.id, label: x.title }))} />
            <Button icon={<PlusOutlined />} onClick={addDependency} />
          </Space.Compact>}

          <Divider orientation="left" plain>工时登记</Divider>
          <List size="small" dataSource={timeEntries} locale={{ emptyText: "暂无工时记录" }} renderItem={(entry) => (
            <List.Item>{dayjs(entry.date).format("YYYY-MM-DD")} · {entry.user.name} · {entry.hours}h{entry.note ? ` · ${entry.note}` : ""}</List.Item>
          )} />
          {canLogTime && <Space.Compact style={{ width: "100%" }}>
            <InputNumber min={0.1} max={24} step={0.5} placeholder="小时" value={timeHours} onChange={setTimeHours} style={{ width: 100 }} />
            <Input placeholder="工作说明" value={timeNote} onChange={(event) => setTimeNote(event.target.value)} />
            <Button type="primary" onClick={addTimeEntry}>登记</Button>
          </Space.Compact>}

          <Divider orientation="left" plain>评论</Divider>
          <CommentsSection entityType="TASK" entityId={task.id} readOnly={!canComment} />
        </>
      )}
    </Drawer>
  );
}
