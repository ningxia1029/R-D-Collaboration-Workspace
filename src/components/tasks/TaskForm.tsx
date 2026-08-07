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
  onClose: (changed?: boolean) => void;
}

interface UserOption { id: string; name: string }
interface LinkItem { id: string; entityType: string; entityId: string }

const ENTITY_TYPES = [
  { value: "PRODUCT", label: "产品" },
  { value: "BOM_ITEM", label: "BOM 条目" },
  { value: "DOCUMENT", label: "知识库文档" },
  { value: "TECH_SPEC", label: "技术参数" },
  { value: "ECO", label: "ECO" },
];

export default function TaskForm({ open, task, projectId, phases, onClose }: Props) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const [users, setUsers] = useState<UserOption[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [docs, setDocs] = useState<{ id: string; title: string }[]>([]);
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [newLink, setNewLink] = useState<{ entityType: string; entityId: string }>({ entityType: "DOCUMENT", entityId: "" });
  const [predecessors, setPredecessors] = useState<{ id: string; successorId: string; successor?: { title: string } }[]>([]);
  const [newDep, setNewDep] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    get<UserOption[]>("/api/users").then(setUsers).catch(() => undefined);
    get<TaskItem[]>(`/api/tasks?projectId=${projectId}`).then(setTasks).catch(() => undefined);
    get<{ id: string; title: string }[]>("/api/documents").then(setDocs).catch(() => undefined);
    if (task) {
      form.setFieldsValue({
        ...task,
        startDate: task.startDate ? dayjs(task.startDate) : null,
        dueDate: task.dueDate ? dayjs(task.dueDate) : null,
      });
      get<LinkItem[]>(`/api/links?taskId=${task.id}`).then(setLinks).catch(() => undefined);
    } else {
      form.resetFields();
      setLinks([]);
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
      message.success("依赖已添加");
      setNewDep("");
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const linkOptions = (type: string) => {
    if (type === "DOCUMENT") return docs.map((d) => ({ value: d.id, label: d.title }));
    return [];
  };

  return (
    <Drawer
      title={task ? "编辑任务" : "新建任务"}
      open={open}
      width={520}
      onClose={() => onClose(false)}
      extra={<Button type="primary" onClick={onSave}>保存</Button>}
    >
      <Form form={form} layout="vertical" initialValues={{ status: "To Do", priority: "P2" }}>
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
            <Select style={{ width: 160 }} allowClear showSearch optionFilterProp="label"
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
                actions={[
                  <Popconfirm key="del" title="删除关联？" onConfirm={() => removeLink(l.id)}>
                    <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                  </Popconfirm>,
                ]}
              >
                <Tag>{ENTITY_TYPES.find((x) => x.value === l.entityType)?.label ?? l.entityType}</Tag>
                {l.entityId}
              </List.Item>
            )}
          />
          <Space.Compact style={{ width: "100%" }}>
            <Select style={{ width: 140 }} value={newLink.entityType}
              onChange={(v) => setNewLink({ entityType: v, entityId: "" })} options={ENTITY_TYPES} />
            {newLink.entityType === "DOCUMENT" ? (
              <Select style={{ flex: 1 }} showSearch optionFilterProp="label" placeholder="选择文档"
                value={newLink.entityId || undefined}
                onChange={(v) => setNewLink({ ...newLink, entityId: v })}
                options={linkOptions(newLink.entityType)} />
            ) : (
              <Input placeholder="输入实体 ID / MPN / ECO 编号" value={newLink.entityId}
                onChange={(e) => setNewLink({ ...newLink, entityId: e.target.value })} />
            )}
            <Button icon={<PlusOutlined />} onClick={addLink} />
          </Space.Compact>

          <Divider orientation="left" plain>前置依赖（FS）</Divider>
          <Space.Compact style={{ width: "100%" }}>
            <Select style={{ flex: 1 }} showSearch optionFilterProp="label" placeholder="选择后继任务（本任务完成后才能开始）"
              value={newDep || undefined} onChange={setNewDep}
              options={tasks.filter((x) => x.id !== task.id).map((x) => ({ value: x.id, label: x.title }))} />
            <Button icon={<PlusOutlined />} onClick={addDependency} />
          </Space.Compact>

          <Divider orientation="left" plain>评论</Divider>
          <CommentsSection entityType="TASK" entityId={task.id} />
        </>
      )}
    </Drawer>
  );
}
