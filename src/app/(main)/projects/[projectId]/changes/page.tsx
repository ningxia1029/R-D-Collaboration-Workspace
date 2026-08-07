"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Card, Tabs, Timeline, Tag, Button, Space, App, Modal, Form, Input, Select, Table, Popconfirm, Typography, Badge, Tooltip,
} from "antd";
import { PlusOutlined, DownloadOutlined, CheckOutlined, CloseOutlined, SwapOutlined, SendOutlined } from "@ant-design/icons";
import { useParams } from "next/navigation";
import dayjs from "dayjs";
import { useSession } from "next-auth/react";
import { get, post, patch, del } from "@/lib/api-client";
import { CHANGE_TYPES } from "@/lib/constants";
import { StatusTag } from "@/components/common/Tags";

interface Eco {
  id: string; ecoNumber: string; type: string; reason?: string | null; description?: string | null;
  versionFrom?: string | null; versionTo?: string | null; status: string; createdAt: string;
  ecr?: { id: string; ecrNumber: string; title: string } | null;
  impacts: { id: string; entityType: string; entityId: string; note?: string | null }[];
  _count: { tasks: number; bomItems: number };
}

interface Ecr {
  id: string; ecrNumber: string; title: string; type: string; reason?: string | null;
  status: string; createdAt: string;
  eco?: { id: string; ecoNumber: string } | null;
}

const TYPE_COLORS: Record<string, string> = { Hardware: "volcano", Mechanical: "geekblue", Firmware: "green", BOM: "orange" };

const ECO_NEXT: Record<string, { to: string; label: string }[]> = {
  DRAFT: [{ to: "PENDING", label: "提交审批" }],
  PENDING: [{ to: "APPROVED", label: "批准" }, { to: "DRAFT", label: "驳回" }],
  APPROVED: [{ to: "IMPLEMENTED", label: "标记已实施" }],
  IMPLEMENTED: [{ to: "CLOSED", label: "关闭" }],
};

export default function ChangesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { message, modal } = App.useApp();
  const { data: session } = useSession();
  const role = session?.user?.roleName ?? "";
  const canApprove = ["admin", "pm"].includes(role);
  const canCreate = ["admin", "pm", "engineer"].includes(role);

  const [ecos, setEcos] = useState<Eco[]>([]);
  const [ecrs, setEcrs] = useState<Ecr[]>([]);
  const [ecoFormOpen, setEcoFormOpen] = useState(false);
  const [ecrFormOpen, setEcrFormOpen] = useState(false);
  const [ecoForm] = Form.useForm();
  const [ecrForm] = Form.useForm();

  const load = useCallback(() => {
    get<Eco[]>(`/api/ecos?projectId=${projectId}`).then(setEcos).catch((e) => message.error(e.message));
    get<Ecr[]>(`/api/ecrs?projectId=${projectId}`).then(setEcrs).catch((e) => message.error(e.message));
  }, [projectId, message]);

  useEffect(load, [load]);

  const ecoTransition = (eco: Eco, to: string, label: string) => {
    modal.confirm({
      title: `${label} ${eco.ecoNumber}？`,
      content: <Input.TextArea id="eco-comment" placeholder="审批意见（可选）" rows={2} />,
      onOk: async () => {
        const comment = (document.getElementById("eco-comment") as HTMLTextAreaElement)?.value;
        try {
          await patch(`/api/ecos/${eco.id}`, { transition: to, comment });
          message.success(`${eco.ecoNumber} 已${label}`);
          load();
        } catch (e) {
          message.error((e as Error).message);
        }
      },
    });
  };

  const ecrAction = async (ecr: Ecr, action: string, label: string) => {
    try {
      await post(`/api/ecrs/${ecr.id}/action`, { action });
      message.success(`${ecr.ecrNumber} ${label}成功`);
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const createEco = async () => {
    const values = await ecoForm.validateFields();
    try {
      await post("/api/ecos", { ...values, projectId });
      message.success("ECO 已创建（DRAFT）");
      setEcoFormOpen(false);
      ecoForm.resetFields();
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const createEcr = async () => {
    const values = await ecrForm.validateFields();
    try {
      await post("/api/ecrs", { ...values, projectId });
      message.success("ECR 已创建（DRAFT）");
      setEcrFormOpen(false);
      ecrForm.resetFields();
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const ecoTimeline = (
    <Card
      size="small"
      title="工程变更时间轴（ECO）"
      extra={
        <Space>
          <Button icon={<DownloadOutlined />} href={`/api/ecos/export-report?projectId=${projectId}`}>导出变更报告</Button>
          {canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={() => setEcoFormOpen(true)}>新建 ECO</Button>}
        </Space>
      }
    >
      <Timeline
        style={{ marginTop: 16 }}
        items={ecos.map((eco) => ({
          color: eco.status === "IMPLEMENTED" || eco.status === "CLOSED" ? "green" : eco.status === "APPROVED" ? "blue" : "gray",
          children: (
            <Card size="small" style={{ marginBottom: 8 }}>
              <Space direction="vertical" size={4} style={{ width: "100%" }}>
                <Space wrap>
                  <Typography.Text strong>{eco.ecoNumber}</Typography.Text>
                  <Tag color={TYPE_COLORS[eco.type]}>{eco.type}</Tag>
                  <StatusTag value={eco.status} />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {dayjs(eco.createdAt).format("YYYY-MM-DD HH:mm")}
                  </Typography.Text>
                </Space>
                {(eco.versionFrom || eco.versionTo) && (
                  <Typography.Text>
                    版本演进：<Tag>{eco.versionFrom ?? "—"}</Tag> → <Tag color="blue">{eco.versionTo ?? "—"}</Tag>
                  </Typography.Text>
                )}
                {eco.reason && <Typography.Text type="secondary">起因：{eco.reason}</Typography.Text>}
                {eco.description && <Typography.Paragraph style={{ marginBottom: 0 }} ellipsis={{ rows: 2, expandable: true }}>{eco.description}</Typography.Paragraph>}
                {eco.ecr && <Typography.Text type="secondary">来源：<Tag color="purple">{eco.ecr.ecrNumber}</Tag>{eco.ecr.title}</Typography.Text>}
                {eco.impacts.length > 0 && (
                  <Space wrap size={4}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>影响面：</Typography.Text>
                    {eco.impacts.map((imp) => (
                      <Tooltip key={imp.id} title={imp.note}>
                        <Tag style={{ fontSize: 12 }}>{imp.entityType}: {imp.entityId}</Tag>
                      </Tooltip>
                    ))}
                  </Space>
                )}
                <Space wrap>
                  {(ECO_NEXT[eco.status] ?? []).map((n) => {
                    const needApprove = ["APPROVED", "DRAFT"].includes(n.to) && eco.status === "PENDING";
                    if (needApprove && !canApprove) return null;
                    return (
                      <Button key={n.to} size="small"
                        type={n.to === "APPROVED" || n.to === "IMPLEMENTED" ? "primary" : "default"}
                        danger={n.to === "DRAFT"}
                        onClick={() => ecoTransition(eco, n.to, n.label)}>
                        {n.label}
                      </Button>
                    );
                  })}
                  {eco.status === "DRAFT" && canCreate && (
                    <Popconfirm title="删除该草稿 ECO？" onConfirm={async () => { await del(`/api/ecos/${eco.id}`); load(); }}>
                      <Button size="small" danger type="text">删除</Button>
                    </Popconfirm>
                  )}
                </Space>
              </Space>
            </Card>
          ),
        }))}
      />
      {ecos.length === 0 && <Typography.Text type="secondary">暂无工程变更</Typography.Text>}
    </Card>
  );

  const ecrTable = (
    <Card
      size="small"
      title="变更申请（ECR）"
      extra={canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={() => setEcrFormOpen(true)}>新建 ECR</Button>}
    >
      <Table
        rowKey="id"
        size="small"
        dataSource={ecrs}
        pagination={false}
        columns={[
          { title: "单号", dataIndex: "ecrNumber", width: 140, render: (v) => <Typography.Text code>{v}</Typography.Text> },
          { title: "标题", dataIndex: "title", ellipsis: true },
          { title: "类型", dataIndex: "type", width: 110, render: (v: string) => <Tag color={TYPE_COLORS[v]}>{v}</Tag> },
          { title: "起因", dataIndex: "reason", ellipsis: true, render: (v) => v ?? "—" },
          { title: "状态", dataIndex: "status", width: 110, render: (v) => <StatusTag value={v} /> },
          { title: "申请时间", dataIndex: "createdAt", width: 110, render: (v) => dayjs(v).format("YYYY-MM-DD") },
          {
            title: "关联 ECO", width: 130,
            render: (_, r) => (r.eco ? <Tag color="red">{r.eco.ecoNumber}</Tag> : "—"),
          },
          {
            title: "操作", width: 220,
            render: (_, r) => (
              <Space size={4} wrap>
                {r.status === "DRAFT" && (
                  <Button size="small" icon={<SendOutlined />} onClick={() => ecrAction(r, "submit", "提交")}>提交</Button>
                )}
                {r.status === "SUBMITTED" && canApprove && (
                  <>
                    <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => ecrAction(r, "approve", "批准")}>批准</Button>
                    <Button size="small" danger icon={<CloseOutlined />} onClick={() => ecrAction(r, "reject", "驳回")}>驳回</Button>
                  </>
                )}
                {r.status === "APPROVED" && canCreate && (
                  <Button size="small" type="primary" icon={<SwapOutlined />} onClick={() => ecrAction(r, "convert", "转 ECO")}>转 ECO</Button>
                )}
              </Space>
            ),
          },
        ]}
      />
    </Card>
  );

  return (
    <>
      <Tabs items={[{ key: "eco", label: <Badge count={ecos.length} size="small" offset={[8, 0]}>ECO 变更单</Badge>, children: ecoTimeline }, { key: "ecr", label: <Badge count={ecrs.filter((e) => e.status === "SUBMITTED").length} size="small" offset={[8, 0]}>ECR 变更申请</Badge>, children: ecrTable }]} />

      <Modal title="新建工程变更单 (ECO)" open={ecoFormOpen} onOk={createEco} onCancel={() => setEcoFormOpen(false)} okText="创建">
        <Form form={ecoForm} layout="vertical">
          <Form.Item name="type" label="变更类型" rules={[{ required: true }]}>
            <Select options={CHANGE_TYPES.map((t) => ({ value: t, label: t }))} placeholder="Hardware / Mechanical / Firmware / BOM" />
          </Form.Item>
          <Form.Item name="reason" label="变更起因"><Input /></Form.Item>
          <Form.Item name="description" label="变更说明"><Input.TextArea rows={3} /></Form.Item>
          <Space>
            <Form.Item name="versionFrom" label="变更前版本"><Input placeholder="PCB V1.0" /></Form.Item>
            <Form.Item name="versionTo" label="变更后版本"><Input placeholder="PCB V1.1" /></Form.Item>
          </Space>
        </Form>
      </Modal>

      <Modal title="新建变更申请 (ECR)" open={ecrFormOpen} onOk={createEcr} onCancel={() => setEcrFormOpen(false)} okText="创建">
        <Form form={ecrForm} layout="vertical">
          <Form.Item name="title" label="申请标题" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="type" label="变更类型" rules={[{ required: true }]}>
            <Select options={CHANGE_TYPES.map((t) => ({ value: t, label: t }))} />
          </Form.Item>
          <Form.Item name="reason" label="变更起因"><Input /></Form.Item>
          <Form.Item name="description" label="详细说明"><Input.TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
