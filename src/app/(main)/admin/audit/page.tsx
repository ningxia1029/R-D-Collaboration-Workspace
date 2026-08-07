"use client";

import { useEffect, useState } from "react";
import { Card, Table, Tag, Typography, App } from "antd";
import dayjs from "dayjs";
import { get } from "@/lib/api-client";

interface AuditLog {
  id: string; userId?: string | null; action: string; entityType: string; entityId: string;
  diffJson?: string | null; createdAt: string;
}

const ACTION_COLORS: Record<string, string> = {
  CREATE: "green", UPDATE: "blue", DELETE: "red", STATUS_CHANGE: "orange",
  AUTO_BLOCK: "red", AUTO_UNBLOCK: "green", CONVERT: "purple", LIFECYCLE: "geekblue",
  IMPORT: "cyan", RELEASE: "blue", TIME_LOG: "default", ARCHIVE: "default",
};

export default function AdminAuditPage() {
  const { message } = App.useApp();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    get<AuditLog[]>("/api/admin/audit?take=200")
      .then(setLogs)
      .catch((e) => message.error(e.message))
      .finally(() => setLoading(false));
  }, [message]);

  return (
    <Card size="small" title="审计日志（最近 200 条）">
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={logs}
        columns={[
          { title: "时间", dataIndex: "createdAt", width: 160, render: (v) => dayjs(v).format("YYYY-MM-DD HH:mm:ss") },
          { title: "操作", dataIndex: "action", width: 140, render: (v: string) => <Tag color={ACTION_COLORS[v] ?? "default"}>{v}</Tag> },
          { title: "对象类型", dataIndex: "entityType", width: 140 },
          { title: "对象 ID", dataIndex: "entityId", width: 220, ellipsis: true, render: (v) => <Typography.Text code style={{ fontSize: 12 }}>{v}</Typography.Text> },
          {
            title: "变更内容", dataIndex: "diffJson", ellipsis: true,
            render: (v) => <Typography.Text type="secondary" style={{ fontSize: 12 }}>{v ?? "—"}</Typography.Text>,
          },
        ]}
      />
    </Card>
  );
}
