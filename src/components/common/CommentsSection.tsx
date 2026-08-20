"use client";

import { useCallback, useEffect, useState } from "react";
import { List, Input, Button, Typography, Space, App, Avatar } from "antd";
import { UserOutlined, SendOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { get, post } from "@/lib/api-client";

interface Comment {
  id: string; content: string; createdAt: string;
  user?: { id: string; name: string } | null;
}

/** 通用评论区（任务 / ECO / ECR / 文档） */
export default function CommentsSection({ entityType, entityId, readOnly = false }: { entityType: string; entityId: string; readOnly?: boolean }) {
  const { message } = App.useApp();
  const [comments, setComments] = useState<Comment[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(() => {
    get<Comment[]>(`/api/comments?entityType=${entityType}&entityId=${entityId}`)
      .then(setComments)
      .catch(() => undefined);
  }, [entityType, entityId]);

  useEffect(load, [load]);

  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      await post("/api/comments", { entityType, entityId, content: text.trim() });
      setText("");
      load();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <List
        size="small"
        dataSource={comments}
        locale={{ emptyText: "暂无评论" }}
        renderItem={(c) => (
          <List.Item style={{ alignItems: "flex-start" }}>
            <Space align="start">
              <Avatar size="small" icon={<UserOutlined />} />
              <div>
                <Space size={8}>
                  <Typography.Text strong style={{ fontSize: 13 }}>{c.user?.name ?? "—"}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>{dayjs(c.createdAt).format("MM-DD HH:mm")}</Typography.Text>
                </Space>
                <div style={{ fontSize: 13 }}>{c.content}</div>
              </div>
            </Space>
          </List.Item>
        )}
      />
      {readOnly ? (
        <Typography.Text type="secondary">当前角色仅可查看评论</Typography.Text>
      ) : (
        <Space.Compact style={{ width: "100%", marginTop: 8 }}>
          <Input placeholder="写下评论…" value={text} onChange={(e) => setText(e.target.value)} onPressEnter={send} />
          <Button type="primary" icon={<SendOutlined />} loading={sending} onClick={send} />
        </Space.Compact>
      )}
    </div>
  );
}
