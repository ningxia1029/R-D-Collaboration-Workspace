"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Input, Modal, List, Tag, Empty, Spin } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { get } from "@/lib/api-client";

interface Hit {
  entityType: string;
  entityId: string;
  projectId: string;
  title: string;
  snippet: string;
}

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  TASK: { label: "任务", color: "blue" },
  BOM_ITEM: { label: "物料", color: "orange" },
  TECH_SPEC: { label: "参数", color: "purple" },
  ECO: { label: "ECO", color: "red" },
  DOCUMENT: { label: "文档", color: "green" },
};

/** 仅识别搜索服务生成的 <b> 标记；文本仍由 React 转义，禁止注入任意 HTML。 */
function renderSnippet(snippet: string) {
  return snippet.split(/(<\/?b>)/i).reduce<{ bold: boolean; nodes: React.ReactNode[] }>(
    (state, part, index) => {
      if (/^<b>$/i.test(part)) return { ...state, bold: true };
      if (/^<\/b>$/i.test(part)) return { ...state, bold: false };
      if (part) state.nodes.push(state.bold ? <strong key={index}>{part}</strong> : part);
      return state;
    },
    { bold: false, nodes: [] }
  ).nodes;
}

export default function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ctrl+K / Cmd+K 唤起
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const search = useCallback((kw: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (!kw.trim()) {
      setHits([]);
      return;
    }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        setHits(await get<Hit[]>(`/api/search?q=${encodeURIComponent(kw)}`));
      } catch {
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }, []);

  const go = (hit: Hit) => {
    setOpen(false);
    setQ("");
    setHits([]);
    switch (hit.entityType) {
      case "TASK":
        router.push(`/projects/${hit.projectId}/tasks`);
        break;
      case "BOM_ITEM":
        router.push(`/projects/${hit.projectId}/bom`);
        break;
      case "TECH_SPEC":
        router.push(`/projects/${hit.projectId}/specs`);
        break;
      case "ECO":
        router.push(`/projects/${hit.projectId}/changes`);
        break;
      case "DOCUMENT":
        router.push(`/knowledge/${hit.entityId}`);
        break;
    }
  };

  return (
    <>
      <Input
        prefix={<SearchOutlined />}
        placeholder="全局搜索 (Ctrl+K)"
        style={{ width: 260 }}
        readOnly
        onClick={() => setOpen(true)}
      />
      <Modal open={open} onCancel={() => setOpen(false)} footer={null} closable={false} width={640}>
        <Input
          autoFocus
          size="large"
          prefix={<SearchOutlined />}
          placeholder="搜索任务、BOM MPN、技术参数、ECO 编号、知识库…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            search(e.target.value);
          }}
        />
        <div style={{ maxHeight: 420, overflow: "auto", marginTop: 12 }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: 24 }}><Spin /></div>
          ) : hits.length === 0 ? (
            <Empty description={q ? "无匹配结果" : "输入关键词开始搜索"} />
          ) : (
            <List
              dataSource={hits}
              renderItem={(hit) => (
                <List.Item style={{ cursor: "pointer" }} onClick={() => go(hit)}>
                  <List.Item.Meta
                    title={
                      <>
                        <Tag color={TYPE_LABELS[hit.entityType]?.color}>{TYPE_LABELS[hit.entityType]?.label ?? hit.entityType}</Tag>
                        {hit.title}
                      </>
                    }
                    description={<span>{renderSnippet(hit.snippet ?? "")}</span>}
                  />
                </List.Item>
              )}
            />
          )}
        </div>
      </Modal>
    </>
  );
}
