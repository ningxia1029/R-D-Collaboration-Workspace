"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, List, Button, Space, Input, Select, Tag, App, Modal, Form, Typography, Row, Col, Empty } from "antd";
import { PlusOutlined, SearchOutlined, FileTextOutlined } from "@ant-design/icons";
import Link from "next/link";
import dynamic from "next/dynamic";
import dayjs from "dayjs";
import { useSession } from "next-auth/react";
import { get, post } from "@/lib/api-client";
import { DOC_CATEGORIES } from "@/lib/constants";

const MDEditor = dynamic(() => import("@uiw/react-md-editor"), { ssr: false });

interface Doc {
  id: string; title: string; category?: string | null; summary?: string | null;
  updatedAt: string; createdAt: string;
  creator?: { name: string } | null;
  tags: { tag: { id: string; name: string } }[];
  _count: { versions: number };
}

interface TagRow { id: string; name: string; _count: { docs: number } }

export default function KnowledgePage() {
  const { message } = App.useApp();
  const { data: session } = useSession();
  const canWrite = ["admin", "pm", "engineer"].includes(session?.user?.roleName ?? "");
  const [docs, setDocs] = useState<Doc[]>([]);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<{ category?: string; tag?: string; q?: string }>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [mdValue, setMdValue] = useState("");
  const [form] = Form.useForm();

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filters.category) params.set("category", filters.category);
    if (filters.tag) params.set("tag", filters.tag);
    if (filters.q) params.set("q", filters.q);
    get<Doc[]>(`/api/documents?${params.toString()}`)
      .then(setDocs)
      .catch((e) => message.error(e.message))
      .finally(() => setLoading(false));
  }, [filters, message]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    get<TagRow[]>("/api/tags").then(setTags).catch(() => undefined);
  }, []);

  const create = async () => {
    const values = await form.validateFields();
    try {
      const doc = await post<Doc>("/api/documents", { ...values, contentMd: mdValue });
      message.success("文档已创建");
      setCreateOpen(false);
      form.resetFields();
      setMdValue("");
      load();
      window.location.href = `/knowledge/${doc.id}`;
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  return (
    <Row gutter={16}>
      <Col xs={24} xl={5}>
        <Card size="small" title="分类">
          <List
            size="small"
            dataSource={["", ...DOC_CATEGORIES]}
            renderItem={(c) => (
              <List.Item
                style={{ cursor: "pointer", background: filters.category === c ? "#e6f4ff" : undefined, padding: "8px 12px" }}
                onClick={() => setFilters((f) => ({ ...f, category: c || undefined }))}
              >
                {c || "全部"}
              </List.Item>
            )}
          />
        </Card>
        <Card size="small" title="标签" style={{ marginTop: 16 }}>
          <Space wrap size={[4, 6]}>
            {tags.map((t) => (
              <Tag
                key={t.id}
                color={filters.tag === t.name ? "blue" : "default"}
                style={{ cursor: "pointer" }}
                onClick={() => setFilters((f) => ({ ...f, tag: f.tag === t.name ? undefined : t.name }))}
              >
                {t.name} ({t._count.docs})
              </Tag>
            ))}
            {tags.length === 0 && <Typography.Text type="secondary">暂无标签</Typography.Text>}
          </Space>
        </Card>
      </Col>
      <Col xs={24} xl={19}>
        <Card
          size="small"
          title="工程知识库"
          extra={
            <Space>
              <Input allowClear prefix={<SearchOutlined />} placeholder="搜索标题 / 摘要" style={{ width: 240 }}
                onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value || undefined }))} />
              {canWrite && <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>沉淀文档</Button>}
            </Space>
          }
        >
          <List
            loading={loading}
            dataSource={docs}
            locale={{ emptyText: <Empty description="暂无文档，点击右上角沉淀第一篇" /> }}
            renderItem={(doc) => (
              <List.Item>
                <List.Item.Meta
                  avatar={<FileTextOutlined style={{ fontSize: 22, color: "#1677ff" }} />}
                  title={
                    <Space>
                      <Link href={`/knowledge/${doc.id}`}><Typography.Text strong>{doc.title}</Typography.Text></Link>
                      {doc.category && <Tag color="blue">{doc.category}</Tag>}
                      {doc.tags.map((t) => <Tag key={t.tag.id}>{t.tag.name}</Tag>)}
                    </Space>
                  }
                  description={
                    <>
                      <div>{doc.summary ?? ""}</div>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {doc.creator?.name ?? "—"} · 更新于 {dayjs(doc.updatedAt).format("YYYY-MM-DD HH:mm")} · {doc._count.versions} 个版本
                      </Typography.Text>
                    </>
                  }
                />
              </List.Item>
            )}
          />
        </Card>
      </Col>

      <Modal title="沉淀新文档" open={createOpen} onOk={create} onCancel={() => setCreateOpen(false)} width={860} okText="创建">
        <Form form={form} layout="vertical">
          <Row gutter={12}>
            <Col span={12}><Form.Item name="title" label="标题" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={6}>
              <Form.Item name="category" label="分类">
                <Select allowClear options={DOC_CATEGORIES.map((c) => ({ value: c, label: c }))} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="tags" label="标签（回车添加）">
                <Select mode="tags" open={false} suffixIcon={null} placeholder="回车添加" tokenSeparators={[",", " "]} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="summary" label="摘要"><Input /></Form.Item>
        </Form>
        <div data-color-mode="light">
          <MDEditor value={mdValue} onChange={(v) => setMdValue(v ?? "")} height={360} />
        </div>
      </Modal>
    </Row>
  );
}
