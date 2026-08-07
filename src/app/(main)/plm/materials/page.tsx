"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, Table, Button, Space, Input, App, Modal, Form, Popconfirm, Typography, Tag } from "antd";
import { PlusOutlined, DeleteOutlined, SearchOutlined } from "@ant-design/icons";
import { useSession } from "next-auth/react";
import { get, post, patch, del } from "@/lib/api-client";

interface Material {
  id: string; mpn: string; name: string; spec?: string | null; manufacturer?: string | null;
  category?: string | null; unit?: string | null; defaultSupplierUrl?: string | null;
  _count: { bomItems: number };
}

export default function MaterialsPage() {
  const { message } = App.useApp();
  const { data: session } = useSession();
  const canManage = ["admin", "pm"].includes(session?.user?.roleName ?? "");
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Material | null>(null);
  const [form] = Form.useForm();

  const load = useCallback(() => {
    setLoading(true);
    get<Material[]>(`/api/plm/materials${q ? `?q=${encodeURIComponent(q)}` : ""}`)
      .then(setMaterials)
      .catch((e) => message.error(e.message))
      .finally(() => setLoading(false));
  }, [q, message]);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  const save = async () => {
    const values = await form.validateFields();
    try {
      if (editing) {
        await patch(`/api/plm/materials/${editing.id}`, values);
        message.success("物料已更新");
      } else {
        await post("/api/plm/materials", values);
        message.success("物料已创建");
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
      title="物料库（跨项目共享主数据）"
      extra={
        <Space>
          <Input allowClear prefix={<SearchOutlined />} placeholder="搜索 MPN / 名称 / 厂商" style={{ width: 240 }}
            onChange={(e) => setQ(e.target.value)} />
          {canManage && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); form.resetFields(); setFormOpen(true); }}>
              新建物料
            </Button>
          )}
        </Space>
      }
    >
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={materials}
        columns={[
          { title: "MPN", dataIndex: "mpn", width: 180, render: (v) => <Typography.Text code>{v}</Typography.Text> },
          { title: "名称", dataIndex: "name", ellipsis: true },
          { title: "规格", dataIndex: "spec", ellipsis: true, render: (v) => v ?? "—" },
          { title: "厂商", dataIndex: "manufacturer", width: 120, render: (v) => v ?? "—" },
          { title: "分类", dataIndex: "category", width: 110, render: (v) => (v ? <Tag>{v}</Tag> : "—") },
          { title: "单位", dataIndex: "unit", width: 70, render: (v) => v ?? "—" },
          { title: "被引用", width: 90, align: "right", render: (_, r) => <Tag color={r._count.bomItems ? "blue" : "default"}>{r._count.bomItems} 处</Tag> },
          ...(canManage
            ? [{
                title: "操作", width: 140,
                render: (_: unknown, r: Material) => (
                  <Space size={0}>
                    <Button size="small" type="link" onClick={() => { setEditing(r); form.setFieldsValue(r); setFormOpen(true); }}>编辑</Button>
                    <Popconfirm title="删除该物料？" onConfirm={async () => {
                      try { await del(`/api/plm/materials/${r.id}`); message.success("已删除"); load(); }
                      catch (e) { message.error((e as Error).message); }
                    }}>
                      <Button size="small" type="link" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </Space>
                ),
              }]
            : []),
        ]}
      />

      <Modal title={editing ? "编辑物料" : "新建物料"} open={formOpen} onOk={save} onCancel={() => { setFormOpen(false); setEditing(null); }} okText="保存">
        <Form form={form} layout="vertical">
          <Form.Item name="mpn" label="MPN 物料编码" rules={[{ required: true }]}>
            <Input disabled={!!editing} />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="spec" label="规格"><Input /></Form.Item>
          <Form.Item name="manufacturer" label="厂商"><Input /></Form.Item>
          <Form.Item name="category" label="分类"><Input placeholder="如：MCU / 传感器 / 被动元件" /></Form.Item>
          <Form.Item name="unit" label="单位"><Input placeholder="pcs / reel" /></Form.Item>
          <Form.Item name="defaultSupplierUrl" label="默认供应商链接"><Input /></Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
