"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Card, Form, Grid, Input, InputNumber, Modal, Select, Space, Table, Tabs, Tag, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { get, patch, post } from "@/lib/api-client";

type OrgUnit = {
  id: string; code: string; name: string; parentId: string | null; managerId: string | null; status: string;
  manager: { id: string; name: string } | null; _count: { members: number; positions: number };
};
type Position = { id: string; code: string; name: string; orgUnitId: string | null; status: string; orgUnit: { id: string; name: string } | null };
type Member = {
  id: string; name: string; email: string; status: string; primaryOrgUnitId: string | null; positionId: string | null;
  managerId: string | null; weeklyCapacityHours: number | null;
  primaryOrgUnit: { id: string; name: string } | null; position: { id: string; name: string } | null; manager: { id: string; name: string } | null;
};
type Snapshot = { units: OrgUnit[]; positions: Position[]; members: Member[] };
type EditState = { kind: "org_unit" | "position" | "member"; row?: OrgUnit | Position | Member } | null;

export default function AdminOrganizationPage() {
  const { message } = App.useApp();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const [snapshot, setSnapshot] = useState<Snapshot>({ units: [], positions: [], members: [] });
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EditState>(null);
  const [form] = Form.useForm();

  const load = useCallback(() => {
    setLoading(true);
    get<Snapshot>("/api/admin/organization")
      .then(setSnapshot)
      .catch((error) => message.error(error.message))
      .finally(() => setLoading(false));
  }, [message]);
  useEffect(load, [load]);

  const unitName = useMemo(() => new Map(snapshot.units.map((unit) => [unit.id, unit.name])), [snapshot.units]);
  const open = (kind: NonNullable<EditState>["kind"], row?: OrgUnit | Position | Member) => {
    setEditing({ kind, row });
    form.resetFields();
    if (!row) {
      form.setFieldsValue({ status: "active" });
      return;
    }
    if (kind === "member") {
      const member = row as Member;
      form.setFieldsValue({
        primaryOrgUnitId: member.primaryOrgUnitId,
        positionId: member.positionId,
        managerId: member.managerId,
        weeklyCapacityHours: member.weeklyCapacityHours,
      });
    } else {
      form.setFieldsValue(row);
    }
  };
  const save = async () => {
    if (!editing) return;
    const values = await form.validateFields();
    try {
      if (editing.kind === "member") {
        await patch("/api/admin/organization", { kind: "member", userId: editing.row?.id, ...values });
      } else if (editing.row) {
        await patch("/api/admin/organization", { kind: editing.kind, id: editing.row.id, ...values });
      } else {
        await post("/api/admin/organization", { kind: editing.kind, ...values });
      }
      message.success("组织数据已保存");
      setEditing(null);
      form.resetFields();
      load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const statusTag = (value: string) => <Tag color={value === "active" ? "success" : "default"}>{value === "active" ? "启用" : "停用"}</Tag>;
  const mobileList = (rows: Array<{ id: string; title: string; subtitle?: string; lines: React.ReactNode[]; edit: () => void }>) => (
    <div style={{ display: "grid", gap: 8 }}>
      {rows.map((row) => <Card
        key={row.id}
        size="small"
        title={<Space direction="vertical" size={0}><Typography.Text strong>{row.title}</Typography.Text>{row.subtitle && <Typography.Text type="secondary">{row.subtitle}</Typography.Text>}</Space>}
        extra={<Button type="link" size="small" onClick={row.edit}>编辑</Button>}
      >
        <Space direction="vertical" size={4}>{row.lines.map((line, index) => <div key={index}>{line}</div>)}</Space>
      </Card>)}
    </div>
  );
  const items = [
    {
      key: "units",
      label: `组织单元 (${snapshot.units.length})`,
      children: <Space direction="vertical" size={8} style={{ width: "100%" }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => open("org_unit")}>新建组织</Button>
        {isMobile ? mobileList(snapshot.units.map((unit) => ({
          id: unit.id,
          title: unit.name,
          subtitle: unit.code,
          lines: [
            <>上级组织：{unit.parentId ? unitName.get(unit.parentId) ?? "不可见/已删除" : "根组织"}</>,
            <>负责人：{unit.manager?.name ?? "未设置"}</>,
            <>启用成员：{unit._count.members}　{statusTag(unit.status)}</>,
          ],
          edit: () => open("org_unit", unit),
        }))) : <Table<OrgUnit>
        rowKey="id" size="small" loading={loading} dataSource={snapshot.units} pagination={{ pageSize: 20, showSizeChanger: false }}
        columns={[
          { title: "编码", dataIndex: "code", width: 140 },
          { title: "名称", dataIndex: "name" },
          { title: "上级组织", render: (_, row) => row.parentId ? unitName.get(row.parentId) ?? "不可见/已删除" : "根组织" },
          { title: "负责人", render: (_, row) => row.manager?.name ?? "未设置" },
          { title: "启用成员", dataIndex: ["_count", "members"], align: "right", width: 100 },
          { title: "状态", dataIndex: "status", render: statusTag, width: 90 },
          { title: "操作", width: 80, render: (_, row) => <Button type="link" size="small" onClick={() => open("org_unit", row)}>编辑</Button> },
        ]}
      />}
      </Space>,
    },
    {
      key: "positions",
      label: `岗位 (${snapshot.positions.length})`,
      children: <Space direction="vertical" size={8} style={{ width: "100%" }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => open("position")}>新建岗位</Button>
        {isMobile ? mobileList(snapshot.positions.map((position) => ({
          id: position.id,
          title: position.name,
          subtitle: position.code,
          lines: [<>所属组织：{position.orgUnit?.name ?? "全局岗位"}</>, <>状态：{statusTag(position.status)}</>],
          edit: () => open("position", position),
        }))) : <Table<Position>
        rowKey="id" size="small" loading={loading} dataSource={snapshot.positions} pagination={{ pageSize: 20, showSizeChanger: false }}
        columns={[
          { title: "编码", dataIndex: "code", width: 140 },
          { title: "名称", dataIndex: "name" },
          { title: "所属组织", render: (_, row) => row.orgUnit?.name ?? "全局岗位" },
          { title: "状态", dataIndex: "status", render: statusTag, width: 90 },
          { title: "操作", width: 80, render: (_, row) => <Button type="link" size="small" onClick={() => open("position", row)}>编辑</Button> },
        ]}
      />}
      </Space>,
    },
    {
      key: "members",
      label: `成员配置 (${snapshot.members.length})`,
      children: isMobile ? mobileList(snapshot.members.map((member) => ({
        id: member.id,
        title: member.name,
        subtitle: member.email,
        lines: [
          <>主部门：{member.primaryOrgUnit?.name ?? "未设置"}</>,
          <>岗位：{member.position?.name ?? "未设置"}</>,
          <>直属经理：{member.manager?.name ?? "未设置"}</>,
          <>周产能：{member.weeklyCapacityHours === null ? "未知" : `${member.weeklyCapacityHours} h`}　{statusTag(member.status)}</>,
        ],
        edit: () => open("member", member),
      }))) : <Table<Member>
        rowKey="id" size="small" loading={loading} dataSource={snapshot.members} pagination={{ pageSize: 20, showSizeChanger: false }} scroll={{ x: 900 }}
        columns={[
          { title: "姓名", dataIndex: "name", fixed: "left", width: 120 },
          { title: "邮箱（仅管理员）", dataIndex: "email", width: 220 },
          { title: "主部门", render: (_, row) => row.primaryOrgUnit?.name ?? "未设置", width: 150 },
          { title: "岗位", render: (_, row) => row.position?.name ?? "未设置", width: 150 },
          { title: "直属经理", render: (_, row) => row.manager?.name ?? "未设置", width: 130 },
          { title: "周产能", render: (_, row) => row.weeklyCapacityHours === null ? "未知" : `${row.weeklyCapacityHours} h`, align: "right", width: 100 },
          { title: "状态", dataIndex: "status", render: statusTag, width: 90 },
          { title: "操作", fixed: "right", width: 80, render: (_, row) => <Button type="link" size="small" onClick={() => open("member", row)}>配置</Button> },
        ]}
      />,
    },
  ];

  const editingMember = editing?.kind === "member" ? editing.row as Member | undefined : undefined;
  const editingUnit = editing?.kind === "org_unit" ? editing.row as OrgUnit | undefined : undefined;
  return <Space direction="vertical" size={12} style={{ width: "100%" }}>
    <Card size="small">
      <Typography.Title level={3} style={{ marginTop: 0 }}>组织架构与资源口径</Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        一人一个主部门；组织负责人必须是本部门启用成员。周产能为空表示未知，资源利用率不会被计算为 0%。
      </Typography.Paragraph>
    </Card>
    <Card size="small"><Tabs items={items} /></Card>

    <Modal
      title={editing?.kind === "member" ? `配置成员：${editingMember?.name ?? ""}` : editing?.kind === "position" ? "岗位维护" : "组织维护"}
      open={!!editing} onOk={save} onCancel={() => { setEditing(null); form.resetFields(); }} okText="保存" destroyOnClose
    >
      <Form form={form} layout="vertical">
        {editing?.kind !== "member" && <>
          <Form.Item name="code" label="编码" rules={[{ required: true }, { max: 64 }]}><Input autoComplete="off" /></Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true }, { max: 120 }]}><Input /></Form.Item>
        </>}
        {editing?.kind === "org_unit" && <>
          <Form.Item name="parentId" label="上级组织">
            <Select allowClear options={snapshot.units.filter((unit) => unit.id !== editingUnit?.id && unit.status === "active").map((unit) => ({ value: unit.id, label: `${unit.code} ${unit.name}` }))} />
          </Form.Item>
          {editingUnit && <Form.Item name="managerId" label="组织负责人">
            <Select allowClear options={snapshot.members.filter((member) => member.status === "active" && member.primaryOrgUnitId === editingUnit.id).map((member) => ({ value: member.id, label: member.name }))} />
          </Form.Item>}
          <Form.Item name="status" label="状态"><Select options={[{ value: "active", label: "启用" }, { value: "inactive", label: "停用" }]} /></Form.Item>
        </>}
        {editing?.kind === "position" && <>
          <Form.Item name="orgUnitId" label="所属组织"><Select allowClear options={snapshot.units.filter((unit) => unit.status === "active").map((unit) => ({ value: unit.id, label: unit.name }))} /></Form.Item>
          <Form.Item name="status" label="状态"><Select options={[{ value: "active", label: "启用" }, { value: "inactive", label: "停用" }]} /></Form.Item>
        </>}
        {editing?.kind === "member" && <>
          <Form.Item name="primaryOrgUnitId" label="主部门"><Select allowClear options={snapshot.units.filter((unit) => unit.status === "active").map((unit) => ({ value: unit.id, label: unit.name }))} /></Form.Item>
          <Form.Item name="positionId" label="岗位"><Select allowClear options={snapshot.positions.filter((position) => position.status === "active").map((position) => ({ value: position.id, label: position.orgUnit ? `${position.name} · ${position.orgUnit.name}` : position.name }))} /></Form.Item>
          <Form.Item name="managerId" label="直属经理"><Select allowClear showSearch optionFilterProp="label" options={snapshot.members.filter((member) => member.id !== editingMember?.id && member.status === "active").map((member) => ({ value: member.id, label: `${member.name}${member.primaryOrgUnit ? ` · ${member.primaryOrgUnit.name}` : ""}` }))} /></Form.Item>
          <Form.Item name="weeklyCapacityHours" label="周标准产能（小时）" extra="留空表示未知；0 表示明确无产能。"><InputNumber min={0} max={168} precision={1} style={{ width: "100%" }} /></Form.Item>
        </>}
      </Form>
    </Modal>
  </Space>;
}
