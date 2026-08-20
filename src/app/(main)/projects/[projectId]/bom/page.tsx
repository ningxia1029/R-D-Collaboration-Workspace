"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Card, Table, Select, Button, Space, Tag, Progress, App, Modal, Form, Input, InputNumber,
  DatePicker, Switch, Popconfirm, Row, Col, Statistic, Typography,
} from "antd";
import { PlusOutlined, UploadOutlined, DownloadOutlined, DeleteOutlined } from "@ant-design/icons";
import { useParams } from "next/navigation";
import dayjs from "dayjs";
import { get, post, patch, del } from "@/lib/api-client";
import { BOM_STATUSES } from "@/lib/constants";
import { StatusTag } from "@/components/common/Tags";
import { useProject } from "../ProjectContext";
import ImportWizard from "@/components/bom/ImportWizard";

interface BomItem {
  id: string; mpn: string; name: string; spec?: string | null; refDes?: string | null;
  qty: number; status: string; supplierUrl?: string | null; eta?: string | null;
  isCritical: boolean; phaseId?: string | null;
  material?: { manufacturer?: string | null } | null;
  eco?: { ecoNumber: string } | null;
}

interface KitRate {
  total: number; arrived: number; rate: number; assemblyReady: boolean;
  byStatus: Record<string, number>;
}

const STATUS_SHORT: Record<string, { label: string; color: string }> = {
  Unordered: { label: "未下单", color: "default" },
  Ordered: { label: "已下单", color: "processing" },
  "In Transit": { label: "运输中", color: "cyan" },
  Arrived: { label: "已到货", color: "success" },
  Delayed: { label: "已延期", color: "error" },
};

export default function BomPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { project } = useProject();
  const { message } = App.useApp();
  const permissions = project?.currentUserAccess.permissions ?? [];
  const canCreate = permissions.includes("bom:create");
  const canUpdate = permissions.includes("bom:update");
  const canDelete = permissions.includes("bom:delete");
  const canImport = permissions.includes("bom:import");
  const canExport = permissions.includes("bom:export");
  const [phaseId, setPhaseId] = useState<string | null>(null);
  const [items, setItems] = useState<BomItem[]>([]);
  const [kitRate, setKitRate] = useState<KitRate | null>(null);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<BomItem | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [form] = Form.useForm();

  const phases = project?.phases ?? [];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = phaseId ? `&phaseId=${phaseId}` : "";
      const [list, kit] = await Promise.all([
        get<BomItem[]>(`/api/bom?projectId=${projectId}${qs}`),
        get<KitRate>(`/api/bom/kit-rate?projectId=${projectId}${qs}`),
      ]);
      setItems(list);
      setKitRate(kit);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId, phaseId, message]);

  useEffect(() => {
    load();
  }, [load]);

  // 默认选中 active 阶段
  useEffect(() => {
    if (!phaseId && phases.length) {
      setPhaseId(phases.find((p) => p.status === "active")?.id ?? phases[0].id);
    }
  }, [phases, phaseId]);

  // Ctrl+N 新建物料
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (canCreate && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setEditing(null);
        form.resetFields();
        setFormOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [form, canCreate]);

  const saveItem = async () => {
    const values = await form.validateFields();
    const payload = { ...values, eta: values.eta?.toISOString() ?? null, phaseId: values.phaseId ?? phaseId, projectId };
    try {
      if (editing) {
        const res = await patch<{ kitRate: KitRate }>(`/api/bom/${editing.id}`, payload);
        if (res.kitRate) setKitRate(res.kitRate);
        message.success("物料已更新");
      } else {
        const res = await post<{ kitRate: KitRate }>("/api/bom", payload);
        if (res.kitRate) setKitRate(res.kitRate);
        message.success("物料已添加");
      }
      setFormOpen(false);
      setEditing(null);
      form.resetFields();
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const quickStatus = async (id: string, status: string) => {
    try {
      const res = await patch<{ kitRate: KitRate; blockResult?: { blocked: number; delayed: string[] } }>(`/api/bom/${id}`, { status });
      if (res.kitRate) setKitRate(res.kitRate);
      if (res.blockResult?.blocked) message.warning(`已自动阻塞 ${res.blockResult.blocked} 个组装任务（卡脖子物料延迟）`);
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const remove = async (id: string) => {
    try {
      await del(`/api/bom/${id}`);
      message.success("已删除");
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const batchStatus = async (status: string) => {
    try {
      await patch("/api/bom/batch", { ids: selectedKeys, patch: { status }, projectId });
      message.success(`已批量更新 ${selectedKeys.length} 条`);
      setSelectedKeys([]);
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  return (
    <div>
      {/* 控制与统计头栏 */}
      <Card size="small" style={{ marginBottom: 12 }}>
        <Row align="middle" gutter={24}>
          <Col>
            <Space>
              <Typography.Text type="secondary">试制阶段</Typography.Text>
              <Select
                style={{ width: 180 }}
                value={phaseId}
                onChange={setPhaseId}
                options={phases.map((p) => ({
                  value: p.id,
                  label: `${p.phaseName}${p.status === "active" ? "（进行中）" : ""}`,
                }))}
              />
            </Space>
          </Col>
          <Col flex="auto">
            {kitRate?.assemblyReady && <Tag color="success" style={{ fontSize: 14, padding: "4px 12px" }}>✅ 具备装配条件</Tag>}
            {(kitRate?.byStatus?.Delayed ?? 0) > 0 && <Tag color="error" style={{ fontSize: 14, padding: "4px 12px" }}>⚠ {kitRate!.byStatus.Delayed} 项延期</Tag>}
          </Col>
          <Col>
            <Space size="large" align="center">
              <Progress
                type="dashboard"
                size={80}
                percent={kitRate?.rate ?? 0}
                status={kitRate?.assemblyReady ? "success" : "active"}
                format={(p) => `${p}%`}
              />
              <Statistic title="齐套率（已到货/总数）" value={`${kitRate?.arrived ?? 0} / ${kitRate?.total ?? 0}`} />
              <Space>
                {BOM_STATUSES.map((s) => (
                  <Tag key={s} color={STATUS_SHORT[s].color}>{STATUS_SHORT[s].label} {kitRate?.byStatus?.[s] ?? 0}</Tag>
                ))}
              </Space>
            </Space>
          </Col>
        </Row>
      </Card>

      <Card
        size="small"
        title="物料清单"
        extra={
          <Space>
            {canUpdate && selectedKeys.length > 0 && (
              <Select
                placeholder={`批量改状态 (${selectedKeys.length})`}
                style={{ width: 180 }}
                onChange={batchStatus}
                options={BOM_STATUSES.map((s) => ({ value: s, label: `→ ${STATUS_SHORT[s].label}` }))}
              />
            )}
            {canImport && <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>导入</Button>}
            {canExport && <Button icon={<DownloadOutlined />} href={`/api/bom/export?projectId=${projectId}${phaseId ? `&phaseId=${phaseId}` : ""}`}>导出</Button>}
            {canCreate && (
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
          dataSource={items}
          pagination={false}
          rowSelection={canUpdate ? { selectedRowKeys: selectedKeys, onChange: setSelectedKeys } : undefined}
          columns={[
            {
              title: "MPN", dataIndex: "mpn", width: 170,
              render: (v: string, r) => (
                <Space size={4}>
                  <Typography.Text code>{v}</Typography.Text>
                  {r.isCritical && <Tag color="red" style={{ marginRight: 0 }}>关键</Tag>}
                </Space>
              ),
            },
            {
              title: "名称 & 规格", dataIndex: "name", ellipsis: true,
              render: (v: string, r) => (
                <Space direction="vertical" size={0}>
                  <span>{v}</span>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.spec ?? ""}</Typography.Text>
                </Space>
              ),
            },
            { title: "位号", dataIndex: "refDes", width: 110, render: (v) => v ?? "—" },
            { title: "数量", dataIndex: "qty", width: 70, align: "right" },
            {
              title: "状态", dataIndex: "status", width: 140,
              render: (v: string, r) => (
                <Select
                  size="small"
                  value={v}
                  style={{ width: 110 }}
                  variant="borderless"
                  disabled={!canUpdate}
                  onChange={(nv) => quickStatus(r.id, nv)}
                  options={BOM_STATUSES.map((s) => ({ value: s, label: STATUS_SHORT[s].label }))}
                />
              ),
            },
            {
              title: "供应商", dataIndex: "supplierUrl", width: 110, ellipsis: true,
              render: (v: string) => (v ? <a href={v} target="_blank" rel="noreferrer">链接</a> : "—"),
            },
            {
              title: "ETA", dataIndex: "eta", width: 115,
              sorter: (a, b) => dayjs(a.eta).unix() - dayjs(b.eta).unix(),
              render: (v: string, r) => {
                if (!v) return "—";
                const overdue = r.status !== "Arrived" && dayjs(v).isBefore(dayjs(), "day");
                return <span className={overdue || r.status === "Delayed" ? "eta-overdue" : undefined}>{dayjs(v).format("YYYY-MM-DD")}</span>;
              },
            },
            {
              title: "ECO", width: 110,
              render: (_, r) => (r.eco ? <Tag color="red">{r.eco.ecoNumber}</Tag> : "—"),
            },
            ...((canUpdate || canDelete) ? [{
              title: "操作", width: 130,
              render: (_: unknown, r: BomItem) => (
                <Space size={0}>
                  {canUpdate && <Button size="small" type="link" onClick={() => {
                    setEditing(r);
                    form.setFieldsValue({ ...r, eta: r.eta ? dayjs(r.eta) : null });
                    setFormOpen(true);
                  }}>编辑</Button>}
                  {canCreate && <Button size="small" type="link" onClick={() => {
                    form.setFieldsValue({ ...r, mpn: r.mpn + "-COPY", eta: r.eta ? dayjs(r.eta) : null });
                    setEditing(null);
                    setFormOpen(true);
                  }}>复制</Button>}
                  {canDelete && <Popconfirm title="删除该物料？" onConfirm={() => remove(r.id)}>
                    <Button size="small" type="link" danger icon={<DeleteOutlined />} />
                  </Popconfirm>}
                </Space>
              ),
            }] : []),
          ]}
        />
      </Card>

      <Modal
        title={editing ? "编辑物料" : "新建物料"}
        open={formOpen}
        onOk={saveItem}
        onCancel={() => { setFormOpen(false); setEditing(null); }}
        width={640}
        okText="保存"
      >
        <Form form={form} layout="vertical" initialValues={{ status: "Unordered", qty: 1 }}>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="mpn" label="MPN 物料编码" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="spec" label="规格"><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="refDes" label="位号 RefDes"><Input placeholder="如 R1, C2, U3" /></Form.Item></Col>
            <Col span={8}><Form.Item name="qty" label="数量"><InputNumber min={1} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={8}>
              <Form.Item name="status" label="状态">
                <Select options={BOM_STATUSES.map((s) => ({ value: s, label: STATUS_SHORT[s].label }))} />
              </Form.Item>
            </Col>
            <Col span={8}><Form.Item name="eta" label="预计到货日"><DatePicker style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="supplierUrl" label="供应商链接"><Input /></Form.Item></Col>
            <Col span={6}>
              <Form.Item name="phaseId" label="所属阶段">
                <Select allowClear options={phases.map((p) => ({ value: p.id, label: p.phaseName }))} />
              </Form.Item>
            </Col>
            <Col span={6}><Form.Item name="isCritical" label="卡脖子物料" valuePropName="checked"><Switch /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>

      <ImportWizard open={importOpen} projectId={projectId} phaseId={phaseId} onClose={(imported) => { setImportOpen(false); if (imported) load(); }} />
    </div>
  );
}
