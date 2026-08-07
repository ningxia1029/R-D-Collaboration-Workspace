"use client";

import { useEffect, useState } from "react";
import { Card, Table, Button, Space, Select, App, Modal, Form, Input, DatePicker, Popconfirm, Tag, Row, Col, Typography } from "antd";
import { PlusOutlined, DeleteOutlined } from "@ant-design/icons";
import { useParams } from "next/navigation";
import dayjs from "dayjs";
import { useSession } from "next-auth/react";
import { get, post, patch, del } from "@/lib/api-client";
import { PHASE_NAMES } from "@/lib/constants";
import { StatusTag } from "@/components/common/Tags";
import { useProject } from "../ProjectContext";

interface Member { userId: string; roleId?: string | null; user: { id: string; name: string; email: string }; role?: { id: string; name: string; description?: string | null } | null }
interface Role { id: string; name: string; description?: string }
interface User { id: string; name: string; email: string }

export default function ProjectSettingsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { project, reload } = useProject();
  const { message } = App.useApp();
  const { data: session } = useSession();
  const canManage = ["admin", "pm"].includes(session?.user?.roleName ?? "");

  const [members, setMembers] = useState<Member[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [phaseForm] = Form.useForm();
  const [msForm] = Form.useForm();
  const [phaseOpen, setPhaseOpen] = useState(false);
  const [msOpen, setMsOpen] = useState(false);

  const loadMembers = () => {
    get<Member[]>(`/api/projects/${projectId}/members`).then(setMembers).catch(() => undefined);
  };

  useEffect(() => {
    loadMembers();
    get<Role[]>("/api/admin/roles").then(setRoles).catch(() => undefined);
    get<User[]>("/api/users").then(setUsers).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const addMember = async (userId: string) => {
    try {
      await post(`/api/projects/${projectId}/members`, { userId });
      message.success("成员已添加");
      loadMembers();
      reload();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const changeRole = async (userId: string, roleId: string | null) => {
    await post(`/api/projects/${projectId}/members`, { userId, roleId });
    message.success("项目内角色已更新");
    loadMembers();
  };

  const removeMember = async (userId: string) => {
    await del(`/api/projects/${projectId}/members`, { userId });
    loadMembers();
    reload();
  };

  const addPhase = async () => {
    const values = await phaseForm.validateFields();
    await post(`/api/projects/${projectId}/phases`, { ...values, targetDate: values.targetDate?.toISOString() });
    message.success("阶段已添加");
    setPhaseOpen(false);
    phaseForm.resetFields();
    reload();
  };

  const setPhaseStatus = async (id: string, status: string) => {
    await patch(`/api/projects/${projectId}/phases`, { id, status });
    reload();
  };

  const addMilestone = async () => {
    const values = await msForm.validateFields();
    await post("/api/milestones", { ...values, projectId, date: values.date.toISOString() });
    message.success("里程碑已添加");
    setMsOpen(false);
    msForm.resetFields();
    reload();
  };

  const setMsStatus = async (id: string, status: string) => {
    await patch("/api/milestones", { id, status });
    reload();
  };

  const memberIds = new Set(members.map((m) => m.userId));

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} xl={10}>
        <Card
          size="small"
          title="项目成员"
          extra={canManage && (
            <Select
              placeholder="添加成员"
              style={{ width: 200 }}
              onChange={addMember}
              options={users.filter((u) => !memberIds.has(u.id)).map((u) => ({ value: u.id, label: `${u.name} (${u.email})` }))}
            />
          )}
        >
          <Table
            rowKey="userId"
            size="small"
            dataSource={members}
            pagination={false}
            columns={[
              { title: "成员", render: (_, r) => <Space direction="vertical" size={0}><span>{r.user.name}</span><Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.user.email}</Typography.Text></Space> },
              {
                title: "项目内角色", width: 170,
                render: (_, r) =>
                  canManage ? (
                    <Select
                      size="small"
                      style={{ width: 150 }}
                      allowClear
                      placeholder="默认全局角色"
                      value={r.roleId ?? undefined}
                      onChange={(v) => changeRole(r.userId, v ?? null)}
                      options={roles.map((ro) => ({ value: ro.id, label: ro.description ?? ro.name }))}
                    />
                  ) : (
                    <Tag>{r.role?.description ?? "默认"}</Tag>
                  ),
              },
              ...(canManage
                ? [{
                    title: "操作", width: 70,
                    render: (_: unknown, r: Member) => (
                      <Popconfirm title="移出项目？" onConfirm={() => removeMember(r.userId)}>
                        <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    ),
                  }]
                : []),
            ]}
          />
        </Card>
      </Col>

      <Col xs={24} xl={7}>
        <Card size="small" title="试制阶段" extra={canManage && <Button size="small" icon={<PlusOutlined />} onClick={() => setPhaseOpen(true)}>添加</Button>}>
          <Table
            rowKey="id"
            size="small"
            dataSource={project?.phases ?? []}
            pagination={false}
            columns={[
              { title: "阶段", dataIndex: "phaseName" },
              { title: "目标日期", dataIndex: "targetDate", width: 110, render: (v) => (v ? dayjs(v).format("YYYY-MM-DD") : "—") },
              {
                title: "状态", width: 130,
                render: (_, r) =>
                  canManage ? (
                    <Select size="small" value={r.status} style={{ width: 100 }} onChange={(v) => setPhaseStatus(r.id, v)}
                      options={[{ value: "pending", label: "未开始" }, { value: "active", label: "进行中" }, { value: "done", label: "已完成" }]} />
                  ) : (
                    <StatusTag value={r.status} />
                  ),
              },
            ]}
          />
        </Card>
      </Col>

      <Col xs={24} xl={7}>
        <Card size="small" title="里程碑" extra={canManage && <Button size="small" icon={<PlusOutlined />} onClick={() => setMsOpen(true)}>添加</Button>}>
          <Table
            rowKey="id"
            size="small"
            dataSource={project?.milestones ?? []}
            pagination={false}
            columns={[
              { title: "里程碑", dataIndex: "name", render: (v) => `◆ ${v}` },
              { title: "日期", dataIndex: "date", width: 110, render: (v) => dayjs(v).format("YYYY-MM-DD") },
              {
                title: "状态", width: 110,
                render: (_, r) =>
                  canManage ? (
                    <Select size="small" value={r.status} style={{ width: 90 }} onChange={(v) => setMsStatus(r.id, v)}
                      options={[{ value: "pending", label: "待达成" }, { value: "done", label: "已达成" }, { value: "missed", label: "已错过" }]} />
                  ) : (
                    <StatusTag value={r.status} />
                  ),
              },
            ]}
          />
        </Card>
      </Col>

      <Modal title="添加试制阶段" open={phaseOpen} onOk={addPhase} onCancel={() => setPhaseOpen(false)} okText="添加">
        <Form form={phaseForm} layout="vertical">
          <Form.Item name="phaseName" label="阶段名称" rules={[{ required: true }]}>
            <Select options={PHASE_NAMES.map((p) => ({ value: p, label: p }))} />
          </Form.Item>
          <Form.Item name="targetDate" label="目标日期"><DatePicker style={{ width: "100%" }} /></Form.Item>
        </Form>
      </Modal>

      <Modal title="添加里程碑" open={msOpen} onOk={addMilestone} onCancel={() => setMsOpen(false)} okText="添加">
        <Form form={msForm} layout="vertical">
          <Form.Item name="name" label="里程碑名称" rules={[{ required: true }]}><Input placeholder="如：EVT 封样" /></Form.Item>
          <Form.Item name="date" label="日期" rules={[{ required: true }]}><DatePicker style={{ width: "100%" }} /></Form.Item>
        </Form>
      </Modal>
    </Row>
  );
}
