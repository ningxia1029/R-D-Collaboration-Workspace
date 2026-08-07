"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Card, Table, Button, Space, Tag, App, Modal, Form, Input, Select, Popconfirm, Typography, Row, Col, Statistic,
} from "antd";
import { PlusOutlined, DeleteOutlined } from "@ant-design/icons";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { get, post, patch, del } from "@/lib/api-client";
import { COMPARE_RULES } from "@/lib/constants";
import { VerdictIcon } from "@/components/common/Tags";
import Markdown from "@/components/common/Markdown";
import { useProject } from "../ProjectContext";

const MDEditor = dynamic(() => import("@uiw/react-md-editor"), { ssr: false });

interface Spec {
  id: string; metricName: string; targetValue?: string | null; actualValue?: string | null;
  unit?: string | null; compareRule: string; contentMd?: string | null; firmwareVersion?: string | null;
  verdict: "pass" | "fail" | "unknown";
  phase?: { id: string; phaseName: string } | null;
}

const RULE_LABELS: Record<string, string> = { gte: "≥ 目标", lte: "≤ 目标", eq: "= 目标" };

export default function SpecsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { project } = useProject();
  const { message } = App.useApp();
  const [specs, setSpecs] = useState<Spec[]>([]);
  const [loading, setLoading] = useState(true);
  const [phaseId, setPhaseId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Spec | null>(null);
  const [mdValue, setMdValue] = useState("");
  const [form] = Form.useForm();
  const phases = project?.phases ?? [];

  const load = useCallback(() => {
    setLoading(true);
    get<Spec[]>(`/api/specs?projectId=${projectId}${phaseId ? `&phaseId=${phaseId}` : ""}`)
      .then(setSpecs)
      .catch((e) => message.error(e.message))
      .finally(() => setLoading(false));
  }, [projectId, phaseId, message]);

  useEffect(load, [load]);

  const save = async () => {
    const values = await form.validateFields();
    const payload = { ...values, contentMd: mdValue || undefined, projectId };
    try {
      if (editing) {
        await patch(`/api/specs/${editing.id}`, payload);
        message.success("已更新");
      } else {
        await post("/api/specs", payload);
        message.success("已创建");
      }
      setFormOpen(false);
      setEditing(null);
      form.resetFields();
      setMdValue("");
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const inlineUpdate = async (id: string, field: string, value: unknown) => {
    try {
      await patch(`/api/specs/${id}`, { [field]: value });
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const passCount = specs.filter((s) => s.verdict === "pass").length;
  const failCount = specs.filter((s) => s.verdict === "fail").length;

  return (
    <div>
      <Card size="small" style={{ marginBottom: 12 }}>
        <Row gutter={24} align="middle">
          <Col>
            <Space>
              <Typography.Text type="secondary">试制阶段</Typography.Text>
              <Select
                style={{ width: 160 }} allowClear placeholder="全部阶段" value={phaseId} onChange={(v) => setPhaseId(v ?? null)}
                options={phases.map((p) => ({ value: p.id, label: p.phaseName }))}
              />
            </Space>
          </Col>
          <Col><Statistic title="指标总数" value={specs.length} /></Col>
          <Col><Statistic title="🟢 达标" value={passCount} valueStyle={{ color: "#52c41a" }} /></Col>
          <Col><Statistic title="🔴 未达标" value={failCount} valueStyle={{ color: failCount ? "#cf1322" : undefined }} /></Col>
        </Row>
      </Card>

      <Card
        size="small"
        title="性能参数比对矩阵"
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); form.resetFields(); setMdValue(""); setFormOpen(true); }}>新建指标</Button>}
      >
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={specs}
          pagination={false}
          expandable={{
            expandedRowRender: (r) =>
              r.contentMd ? <Markdown content={r.contentMd} /> : <Typography.Text type="secondary">无附加文档</Typography.Text>,
            rowExpandable: (r) => !!r.contentMd,
          }}
          columns={[
            {
              title: "判定", width: 60, align: "center",
              render: (_, r) => <VerdictIcon verdict={r.verdict} />,
            },
            { title: "指标名称", dataIndex: "metricName", width: 180 },
            {
              title: "设计目标", dataIndex: "targetValue", width: 130,
              render: (v: string, r) => (
                <Input size="small" defaultValue={v ?? ""} style={{ width: 110 }}
                  onBlur={(e) => e.target.value !== (v ?? "") && inlineUpdate(r.id, "targetValue", e.target.value)} />
              ),
            },
            {
              title: "实测值", dataIndex: "actualValue", width: 130,
              render: (v: string, r) => (
                <Input size="small" defaultValue={v ?? ""} style={{ width: 110 }}
                  onBlur={(e) => e.target.value !== (v ?? "") && inlineUpdate(r.id, "actualValue", e.target.value)} />
              ),
            },
            { title: "单位", dataIndex: "unit", width: 80, render: (v) => v ?? "—" },
            { title: "判定规则", dataIndex: "compareRule", width: 100, render: (v: string) => RULE_LABELS[v] ?? v },
            { title: "阶段", width: 90, render: (_, r) => (r.phase ? <Tag color="purple">{r.phase.phaseName}</Tag> : "—") },
            { title: "固件版本", dataIndex: "firmwareVersion", width: 120, render: (v) => (v ? <Tag>{v}</Tag> : "—") },
            {
              title: "操作", width: 130,
              render: (_, r) => (
                <Space size={0}>
                  <Button size="small" type="link" onClick={() => {
                    setEditing(r);
                    form.setFieldsValue(r);
                    setMdValue(r.contentMd ?? "");
                    setFormOpen(true);
                  }}>编辑</Button>
                  <Popconfirm title="删除该指标？" onConfirm={async () => { await del(`/api/specs/${r.id}`); load(); }}>
                    <Button size="small" type="link" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title={editing ? "编辑指标" : "新建指标"}
        open={formOpen}
        onOk={save}
        onCancel={() => { setFormOpen(false); setEditing(null); }}
        width={800}
        okText="保存"
      >
        <Form form={form} layout="vertical" initialValues={{ compareRule: "gte" }}>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="metricName" label="指标名称" rules={[{ required: true }]}><Input placeholder="如：静态功耗" /></Form.Item></Col>
            <Col span={6}>
              <Form.Item name="phaseId" label="试制阶段">
                <Select allowClear options={phases.map((p) => ({ value: p.id, label: p.phaseName }))} />
              </Form.Item>
            </Col>
            <Col span={6}><Form.Item name="firmwareVersion" label="绑定固件版本"><Input placeholder="FW v1.1.0" /></Form.Item></Col>
            <Col span={8}><Form.Item name="targetValue" label="设计目标"><Input /></Form.Item></Col>
            <Col span={8}><Form.Item name="actualValue" label="实测值"><Input /></Form.Item></Col>
            <Col span={4}><Form.Item name="unit" label="单位"><Input /></Form.Item></Col>
            <Col span={4}>
              <Form.Item name="compareRule" label="判定规则">
                <Select options={COMPARE_RULES.map((r) => ({ value: r, label: RULE_LABELS[r] }))} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
        <Typography.Text type="secondary">逻辑与工作流文档（支持 Markdown + mermaid 状态机/流程图）</Typography.Text>
        <div data-color-mode="light" style={{ marginTop: 8 }}>
          <MDEditor value={mdValue} onChange={(v) => setMdValue(v ?? "")} height={300} />
        </div>
      </Modal>
    </div>
  );
}
