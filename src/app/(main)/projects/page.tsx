"use client";

import { useEffect, useState } from "react";
import { Card, Table, Button, Modal, Form, Input, DatePicker, Select, Progress, Space, Typography, App, Tag } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import Link from "next/link";
import dayjs from "dayjs";
import { get, post } from "@/lib/api-client";
import { StatusTag } from "@/components/common/Tags";
import { LIFECYCLE_LABELS, type LifecycleStage } from "@/lib/constants";
import { useSession } from "next-auth/react";

interface Project {
  id: string; name: string; code: string; status: string; lifecycleStage: string;
  description?: string; progress: number; startDate?: string; endDate?: string;
  owner?: { name: string } | null;
  product?: { name: string } | null;
  _count: { tasks: number; bomItems: number; changeLogs: number; members: number };
}

interface ProductOption { id: string; name: string; code: string }

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const { data: session } = useSession();
  const canCreate = ["admin", "pm"].includes(session?.user?.roleName ?? "");

  const load = () => {
    setLoading(true);
    get<Project[]>("/api/projects").then(setProjects).catch((e) => message.error(e.message)).finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // 产品树根节点作为关联选项
    get<{ id: string; name: string; code: string; nodeType: string }[]>("/api/plm/products")
      .then((tree) => {
        const roots = (tree as unknown as { id: string; name: string; code: string }[]).map((n) => ({ id: n.id, name: n.name, code: n.code }));
        setProducts(roots);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCreate = async () => {
    const values = await form.validateFields();
    try {
      await post("/api/projects", {
        ...values,
        startDate: values.startDate?.toISOString(),
        endDate: values.endDate?.toISOString(),
      });
      message.success("项目已创建");
      setOpen(false);
      form.resetFields();
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  return (
    <Card
      title="项目列表"
      extra={canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>立项</Button>}
    >
      <Table
        rowKey="id"
        loading={loading}
        dataSource={projects}
        pagination={false}
        columns={[
          {
            title: "项目", dataIndex: "name",
            render: (v: string, r) => (
              <Space direction="vertical" size={0}>
                <Link href={`/projects/${r.id}/tasks`}><Typography.Text strong>{v}</Typography.Text></Link>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.code} · {r.description ?? ""}</Typography.Text>
              </Space>
            ),
          },
          { title: "状态", dataIndex: "status", width: 100, render: (v) => <StatusTag value={v} /> },
          {
            title: "生命周期", dataIndex: "lifecycleStage", width: 110,
            render: (v: string) => <Tag color="geekblue">{LIFECYCLE_LABELS[v as LifecycleStage] ?? v}</Tag>,
          },
          { title: "负责人", dataIndex: ["owner", "name"], width: 110, render: (v) => v ?? "—" },
          { title: "关联产品", dataIndex: ["product", "name"], width: 140, render: (v) => v ?? "—" },
          {
            title: "进度", dataIndex: "progress", width: 160,
            render: (v: number, r) => <Progress percent={v} size="small" format={(p) => `${p}% (${r._count.tasks}任务)`} />,
          },
          {
            title: "规模", width: 160,
            render: (_, r) => (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                任务 {r._count.tasks} · 物料 {r._count.bomItems} · ECO {r._count.changeLogs} · 成员 {r._count.members}
              </Typography.Text>
            ),
          },
          {
            title: "周期", width: 190,
            render: (_, r) => (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {r.startDate ? dayjs(r.startDate).format("YYYY-MM-DD") : "—"} ~ {r.endDate ? dayjs(r.endDate).format("YYYY-MM-DD") : "—"}
              </Typography.Text>
            ),
          },
        ]}
      />

      <Modal title="项目立项" open={open} onOk={onCreate} onCancel={() => setOpen(false)} okText="创建">
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="项目名称" rules={[{ required: true, message: "请输入项目名称" }]}>
            <Input placeholder="如：TH-200 智能门锁研发" />
          </Form.Item>
          <Form.Item name="code" label="项目编号" rules={[{ required: true, message: "请输入项目编号" }]}>
            <Input placeholder="如：TH-200" />
          </Form.Item>
          <Form.Item name="description" label="项目描述">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="productId" label="关联产品">
            <Select allowClear placeholder="选择产品树根节点"
              options={products.map((p) => ({ value: p.id, label: `${p.code} ${p.name}` }))} />
          </Form.Item>
          <Space>
            <Form.Item name="startDate" label="开始日期"><DatePicker /></Form.Item>
            <Form.Item name="endDate" label="目标日期"><DatePicker /></Form.Item>
          </Space>
        </Form>
      </Modal>
    </Card>
  );
}
