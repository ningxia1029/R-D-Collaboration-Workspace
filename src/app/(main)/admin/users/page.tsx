"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, Table, Button, Space, App, Modal, Form, Input, Select, Tag, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { get, post, patch } from "@/lib/api-client";
import { ROLE_LABELS, type RoleName } from "@/lib/constants";

interface User {
  id: string; email: string; name: string; status: string;
  role: { id: string; name: string };
  _count: { memberships: number; assignedTasks: number };
}

interface Role { id: string; name: string; description?: string }

export default function AdminUsersPage() {
  const { message } = App.useApp();
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form] = Form.useForm();

  const load = useCallback(() => {
    setLoading(true);
    get<User[]>("/api/admin/users").then(setUsers).catch((e) => message.error(e.message)).finally(() => setLoading(false));
  }, [message]);

  useEffect(() => {
    load();
    get<Role[]>("/api/admin/roles").then(setRoles).catch(() => undefined);
  }, [load]);

  const save = async () => {
    const values = await form.validateFields();
    try {
      if (editing) {
        await patch("/api/admin/users", { id: editing.id, ...values });
        message.success("用户已更新");
      } else {
        await post("/api/admin/users", values);
        message.success("用户已创建");
      }
      setFormOpen(false);
      setEditing(null);
      form.resetFields();
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  return (
    <Card
      size="small"
      title="用户与角色"
      extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); form.resetFields(); setFormOpen(true); }}>新建用户</Button>}
    >
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={users}
        pagination={false}
        columns={[
          { title: "姓名", dataIndex: "name" },
          { title: "邮箱", dataIndex: "email" },
          {
            title: "全局角色", width: 130,
            render: (_, r) => <Tag color={r.role.name === "admin" ? "red" : r.role.name === "pm" ? "blue" : "default"}>{ROLE_LABELS[r.role.name as RoleName] ?? r.role.name}</Tag>,
          },
          {
            title: "状态", dataIndex: "status", width: 100,
            render: (v) => <Tag color={v === "active" ? "success" : "default"}>{v === "active" ? "启用" : "停用"}</Tag>,
          },
          { title: "参与项目", dataIndex: ["_count", "memberships"], width: 100, align: "right" },
          { title: "负责任务", dataIndex: ["_count", "assignedTasks"], width: 100, align: "right" },
          {
            title: "操作", width: 90,
            render: (_, r) => (
              <Button size="small" type="link" onClick={() => {
                setEditing(r);
                form.setFieldsValue({ name: r.name, email: r.email, roleId: r.role.id, status: r.status });
                setFormOpen(true);
              }}>编辑</Button>
            ),
          },
        ]}
      />

      <Modal title={editing ? `编辑用户：${editing.name}` : "新建用户"} open={formOpen} onOk={save} onCancel={() => { setFormOpen(false); setEditing(null); }} okText="保存">
        <Form form={form} layout="vertical" initialValues={{ status: "active" }}>
          <Form.Item name="name" label="姓名" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="email" label="邮箱" rules={[{ required: true, type: "email" }]}>
            <Input disabled={!!editing} />
          </Form.Item>
          <Form.Item name="roleId" label="全局角色" rules={[{ required: true }]}>
            <Select options={roles.map((r) => ({ value: r.id, label: r.description ?? r.name }))} />
          </Form.Item>
          <Form.Item name="password" label={editing ? "重置密码（留空不改）" : "初始密码"} rules={editing ? [] : [{ required: true, min: 8, message: "至少 8 位" }]}>
            <Input.Password placeholder={editing ? "留空保持不变" : "至少 8 位"} />
          </Form.Item>
          {editing && (
            <Form.Item name="status" label="状态">
              <Select options={[{ value: "active", label: "启用" }, { value: "disabled", label: "停用" }]} />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </Card>
  );
}
