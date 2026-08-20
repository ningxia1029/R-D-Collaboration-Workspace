"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, Button, Space, Tag, App, Drawer, Timeline, Typography, Input, Select, Popconfirm, Row, Col, Modal } from "antd";
import { EditOutlined, HistoryOutlined, DeleteOutlined, SaveOutlined } from "@ant-design/icons";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import dayjs from "dayjs";
import { get, patch, del } from "@/lib/api-client";
import Markdown from "@/components/common/Markdown";
import CommentsSection from "@/components/common/CommentsSection";
import { DOC_CATEGORIES } from "@/lib/constants";

const MDEditor = dynamic(() => import("@uiw/react-md-editor"), { ssr: false });

interface DocVersion {
  id: string; version: number; contentMd: string; changeNote?: string | null;
  createdAt: string; createdBy?: string | null;
}

interface Doc {
  id: string; title: string; category?: string | null; summary?: string | null;
  createdBy?: string | null; updatedAt: string;
  creator?: { name: string } | null;
  tags: { tag: { id: string; name: string } }[];
  versions: DocVersion[];
  currentUserAccess: { role: string; permissions: string[] };
}

export default function DocumentPage() {
  const { docId } = useParams<{ docId: string }>();
  const router = useRouter();
  const { message } = App.useApp();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [editing, setEditing] = useState(false);
  const [mdValue, setMdValue] = useState("");
  const [meta, setMeta] = useState<{ title: string; category?: string; summary?: string; tags: string[] }>({ title: "", tags: [] });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [previewVersion, setPreviewVersion] = useState<DocVersion | null>(null);

  const load = useCallback(() => {
    get<Doc>(`/api/documents/${docId}`)
      .then((d) => {
        setDoc(d);
        setMdValue(d.versions[0]?.contentMd ?? "");
        setMeta({
          title: d.title,
          category: d.category ?? undefined,
          summary: d.summary ?? undefined,
          tags: d.tags.map((t) => t.tag.name),
        });
      })
      .catch((e) => message.error(e.message));
  }, [docId, message]);

  useEffect(load, [load]);

  const save = async () => {
    try {
      await patch(`/api/documents/${docId}`, { ...meta, contentMd: mdValue });
      message.success("已保存（自动生成新版本）");
      setEditing(false);
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const remove = async () => {
    try {
      await del(`/api/documents/${docId}`);
      message.success("文档已删除");
      router.push("/knowledge");
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  if (!doc) return null;
  const latest = doc.versions[0];
  const canWrite = doc.currentUserAccess.permissions.includes("kb:update");
  const canDelete = doc.currentUserAccess.permissions.includes("kb:delete");
  const canComment = doc.currentUserAccess.role !== "viewer";

  return (
    <Card
      size="small"
      title={
        <Space wrap>
          {editing ? (
            <Input value={meta.title} onChange={(e) => setMeta((m) => ({ ...m, title: e.target.value }))} style={{ width: 320 }} />
          ) : (
            <Typography.Title level={4} style={{ margin: 0 }}>{doc.title}</Typography.Title>
          )}
          {!editing && doc.category && <Tag color="blue">{doc.category}</Tag>}
          {!editing && doc.tags.map((t) => <Tag key={t.tag.id}>{t.tag.name}</Tag>)}
        </Space>
      }
      extra={
        <Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            v{latest?.version ?? 1} · {doc.creator?.name ?? "—"} · {dayjs(doc.updatedAt).format("YYYY-MM-DD HH:mm")}
          </Typography.Text>
          <Button icon={<HistoryOutlined />} onClick={() => setHistoryOpen(true)}>版本历史</Button>
          {canWrite && !editing && <Button type="primary" icon={<EditOutlined />} onClick={() => setEditing(true)}>编辑</Button>}
          {editing && (
            <>
              <Button onClick={() => { setEditing(false); load(); }}>取消</Button>
              <Button type="primary" icon={<SaveOutlined />} onClick={save}>保存</Button>
            </>
          )}
          {canDelete && (
            <Popconfirm title="删除该文档（含全部版本）？" onConfirm={remove}>
              <Button danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      }
    >
      {editing ? (
        <Row gutter={12} style={{ marginBottom: 12 }}>
          <Col span={8}>
            <Select
              style={{ width: "100%" }} allowClear placeholder="分类" value={meta.category}
              onChange={(v) => setMeta((m) => ({ ...m, category: v }))}
              options={DOC_CATEGORIES.map((c) => ({ value: c, label: c }))}
            />
          </Col>
          <Col span={8}>
            <Select
              style={{ width: "100%" }} mode="tags" open={false} suffixIcon={null} placeholder="标签（回车添加）"
              value={meta.tags} onChange={(v) => setMeta((m) => ({ ...m, tags: v }))}
              tokenSeparators={[",", " "]}
            />
          </Col>
          <Col span={8}>
            <Input placeholder="摘要" value={meta.summary} onChange={(e) => setMeta((m) => ({ ...m, summary: e.target.value }))} />
          </Col>
        </Row>
      ) : null}

      {editing ? (
        <div data-color-mode="light">
          <MDEditor value={mdValue} onChange={(v) => setMdValue(v ?? "")} height={520} />
        </div>
      ) : (
        <Markdown content={latest?.contentMd ?? "*暂无内容*"} />
      )}

      {!editing && (
        <Card size="small" title="讨论" style={{ marginTop: 16 }}>
          <CommentsSection entityType="DOCUMENT" entityId={doc.id} readOnly={!canComment} />
        </Card>
      )}

      <Drawer title="版本历史" open={historyOpen} onClose={() => setHistoryOpen(false)} width={420}>
        <Timeline
          items={doc.versions.map((v) => ({
            color: v.version === latest?.version ? "blue" : "gray",
            children: (
              <Space direction="vertical" size={2}>
                <Space>
                  <Tag color={v.version === latest?.version ? "blue" : "default"}>v{v.version}</Tag>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {dayjs(v.createdAt).format("YYYY-MM-DD HH:mm")}
                  </Typography.Text>
                  <Button size="small" type="link" onClick={() => setPreviewVersion(v)}>查看</Button>
                </Space>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{v.changeNote ?? "—"}</Typography.Text>
              </Space>
            ),
          }))}
        />
      </Drawer>

      <Modal
        title={`历史版本 v${previewVersion?.version}（只读）`}
        open={!!previewVersion}
        onCancel={() => setPreviewVersion(null)}
        footer={null}
        width={860}
      >
        {previewVersion && <Markdown content={previewVersion.contentMd} />}
      </Modal>
    </Card>
  );
}
