"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, Tree, Button, Space, App, Modal, Form, Input, InputNumber, Select, Tag, Typography, Row, Col, Timeline, Popconfirm, Empty } from "antd";
import { PlusOutlined, DeleteOutlined, TagOutlined } from "@ant-design/icons";
import { useSession } from "next-auth/react";
import { get, post, patch, del } from "@/lib/api-client";
import { PRODUCT_NODE_TYPES } from "@/lib/constants";

interface ProductNode {
  id: string; name: string; code: string; parentId?: string | null; nodeType: string;
  qty: number; currentVersion?: string | null;
  material?: { mpn: string; name: string } | null;
  versions: { id: string; version: string; note?: string | null; releasedAt: string }[];
  children: ProductNode[];
}

const NODE_COLORS: Record<string, string> = { PRODUCT: "geekblue", ASSEMBLY: "purple", COMPONENT: "cyan", MATERIAL: "green" };
const NODE_LABELS: Record<string, string> = { PRODUCT: "产品", ASSEMBLY: "部件", COMPONENT: "组件", MATERIAL: "物料" };

export default function ProductsPage() {
  const { message } = App.useApp();
  const { data: session } = useSession();
  const canManage = ["admin", "pm"].includes(session?.user?.roleName ?? "");
  const [tree, setTree] = useState<ProductNode[]>([]);
  const [selected, setSelected] = useState<ProductNode | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [parentForNew, setParentForNew] = useState<string | null>(null);
  const [versionOpen, setVersionOpen] = useState(false);
  const [materials, setMaterials] = useState<{ id: string; mpn: string; name: string }[]>([]);
  const [form] = Form.useForm();
  const [versionForm] = Form.useForm();

  const load = useCallback(() => {
    get<ProductNode[]>("/api/plm/products").then(setTree).catch((e) => message.error(e.message));
  }, [message]);

  useEffect(() => {
    load();
    get<{ id: string; mpn: string; name: string }[]>("/api/plm/materials").then(setMaterials).catch(() => undefined);
  }, [load]);

  const toTreeData = (nodes: ProductNode[]): { key: string; title: React.ReactNode; children: unknown[] }[] =>
    nodes.map((n) => ({
      key: n.id,
      title: (
        <Space size={4}>
          <Tag color={NODE_COLORS[n.nodeType]} style={{ marginRight: 0 }}>{NODE_LABELS[n.nodeType]}</Tag>
          <span>{n.name}</span>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {n.code}{n.qty > 1 ? ` ×${n.qty}` : ""}{n.currentVersion ? ` · ${n.currentVersion}` : ""}
          </Typography.Text>
        </Space>
      ),
      children: toTreeData(n.children ?? []),
    }));

  const findNode = (nodes: ProductNode[], id: string): ProductNode | null => {
    for (const n of nodes) {
      if (n.id === id) return n;
      const hit = findNode(n.children ?? [], id);
      if (hit) return hit;
    }
    return null;
  };

  const createNode = async () => {
    const values = await form.validateFields();
    try {
      await post("/api/plm/products", { ...values, parentId: parentForNew });
      message.success("节点已创建");
      setFormOpen(false);
      form.resetFields();
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const releaseVersion = async () => {
    if (!selected) return;
    const values = await versionForm.validateFields();
    try {
      await patch(`/api/plm/products/${selected.id}`, values);
      message.success("版本已发布");
      setVersionOpen(false);
      versionForm.resetFields();
      load();
      setSelected(null);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const removeNode = async (id: string) => {
    try {
      await del(`/api/plm/products/${id}`);
      message.success("已删除");
      setSelected(null);
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  return (
    <Row gutter={16}>
      <Col xs={24} xl={13}>
        <Card
          size="small"
          title="产品结构树"
          extra={canManage && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { setParentForNew(null); form.resetFields(); setFormOpen(true); }}>
              新建产品
            </Button>
          )}
        >
          {tree.length === 0 ? <Empty description="暂无产品" /> : (
            <Tree
              treeData={toTreeData(tree) as never}
              defaultExpandAll
              selectedKeys={selected ? [selected.id] : []}
              onSelect={(keys) => setSelected(keys.length ? findNode(tree, String(keys[0])) : null)}
            />
          )}
        </Card>
      </Col>
      <Col xs={24} xl={11}>
        <Card
          size="small"
          title={selected ? `节点详情：${selected.name}` : "节点详情"}
          extra={selected && canManage && (
            <Space>
              <Button size="small" icon={<PlusOutlined />} onClick={() => { setParentForNew(selected.id); form.setFieldsValue({ nodeType: "ASSEMBLY" }); setFormOpen(true); }}>加子节点</Button>
              <Button size="small" icon={<TagOutlined />} onClick={() => setVersionOpen(true)}>发布版本</Button>
              <Popconfirm title="删除该节点？" onConfirm={() => removeNode(selected.id)}>
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </Space>
          )}
        >
          {!selected ? <Empty description="点击左侧节点查看详情" /> : (
            <>
              <p><Typography.Text type="secondary">编码：</Typography.Text>{selected.code}</p>
              <p><Typography.Text type="secondary">类型：</Typography.Text><Tag color={NODE_COLORS[selected.nodeType]}>{NODE_LABELS[selected.nodeType]}</Tag></p>
              <p><Typography.Text type="secondary">用量：</Typography.Text>{selected.qty}</p>
              <p><Typography.Text type="secondary">当前版本：</Typography.Text>{selected.currentVersion ?? "—"}</p>
              {selected.material && (
                <p><Typography.Text type="secondary">关联物料：</Typography.Text><Typography.Text code>{selected.material.mpn}</Typography.Text> {selected.material.name}</p>
              )}
              <Typography.Title level={5}>版本历史</Typography.Title>
              {selected.versions.length === 0 ? <Typography.Text type="secondary">暂无版本记录</Typography.Text> : (
                <Timeline
                  items={selected.versions.map((v) => ({
                    children: (
                      <Space direction="vertical" size={0}>
                        <Space><Tag color="blue">{v.version}</Tag><Typography.Text type="secondary" style={{ fontSize: 12 }}>{new Date(v.releasedAt).toLocaleDateString("zh-CN")}</Typography.Text></Space>
                        {v.note && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{v.note}</Typography.Text>}
                      </Space>
                    ),
                  }))}
                />
              )}
            </>
          )}
        </Card>
      </Col>

      <Modal title={parentForNew ? "新建子节点" : "新建产品"} open={formOpen} onOk={createNode} onCancel={() => setFormOpen(false)} okText="创建">
        <Form form={form} layout="vertical" initialValues={{ nodeType: parentForNew ? "ASSEMBLY" : "PRODUCT", qty: 1 }}>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="code" label="编码" rules={[{ required: true }]}><Input placeholder="如 TH-100-MB" /></Form.Item>
          <Form.Item name="nodeType" label="节点类型" rules={[{ required: true }]}>
            <Select options={PRODUCT_NODE_TYPES.map((t) => ({ value: t, label: NODE_LABELS[t] }))} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(a, b) => a.nodeType !== b.nodeType}>
            {({ getFieldValue }) =>
              getFieldValue("nodeType") === "MATERIAL" && (
                <Form.Item name="materialId" label="关联物料库物料">
                  <Select showSearch optionFilterProp="label" allowClear
                    options={materials.map((m) => ({ value: m.id, label: `${m.mpn} ${m.name}` }))} />
                </Form.Item>
              )
            }
          </Form.Item>
          <Form.Item name="qty" label="相对父级用量"><InputNumber min={1} style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="currentVersion" label="当前版本"><Input placeholder="如 PCB V1.1" /></Form.Item>
        </Form>
      </Modal>

      <Modal title={`发布新版本：${selected?.name ?? ""}`} open={versionOpen} onOk={releaseVersion} onCancel={() => setVersionOpen(false)} okText="发布">
        <Form form={versionForm} layout="vertical">
          <Form.Item name="releaseVersion" label="版本号" rules={[{ required: true }]}><Input placeholder="如 PCB V1.2" /></Form.Item>
          <Form.Item name="note" label="版本说明"><Input.TextArea rows={2} placeholder="通常注明关联的 ECO 单号" /></Form.Item>
        </Form>
      </Modal>
    </Row>
  );
}
