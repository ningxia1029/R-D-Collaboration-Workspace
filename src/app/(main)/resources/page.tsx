"use client";

import { useEffect, useState } from "react";
import { Card, Table, App, Typography, Select, Space, Progress } from "antd";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { get } from "@/lib/api-client";

interface Workload {
  user: { id: string; name: string; email: string };
  estimatedHours: number;
  loggedHours: number;
  openTasks: number;
}

interface ProjectOption { id: string; name: string; code: string }

export default function ResourcesPage() {
  const { message } = App.useApp();
  const [data, setData] = useState<Workload[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    get<ProjectOption[]>("/api/projects").then(setProjects).catch(() => undefined);
  }, []);

  useEffect(() => {
    setLoading(true);
    get<Workload[]>(`/api/resources/workload${projectId ? `?projectId=${projectId}` : ""}`)
      .then(setData)
      .catch((e) => message.error(e.message))
      .finally(() => setLoading(false));
  }, [projectId, message]);

  const chartData = data.map((w) => ({
    name: w.user.name,
    预估工时: w.estimatedHours,
    已登记工时: w.loggedHours,
  }));

  return (
    <div>
      <Card
        size="small"
        title="成员负载视图"
        extra={
          <Space>
            <Typography.Text type="secondary">项目过滤</Typography.Text>
            <Select
              allowClear
              placeholder="全部项目"
              style={{ width: 220 }}
              value={projectId}
              onChange={setProjectId}
              options={projects.map((p) => ({ value: p.id, label: `${p.code} ${p.name}` }))}
            />
          </Space>
        }
      >
        <div style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <XAxis dataKey="name" />
              <YAxis unit="h" />
              <Tooltip />
              <Legend />
              <Bar dataKey="预估工时" fill="#1677ff" radius={[4, 4, 0, 0]} />
              <Bar dataKey="已登记工时" fill="#52c41a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card size="small" title="工时明细" style={{ marginTop: 16 }}>
        <Table
          rowKey={(r) => r.user.id}
          size="small"
          loading={loading}
          dataSource={data}
          pagination={false}
          columns={[
            { title: "成员", render: (_, r) => <Space direction="vertical" size={0}><span>{r.user.name}</span><Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.user.email}</Typography.Text></Space> },
            { title: "进行中任务", dataIndex: "openTasks", width: 110, align: "right" },
            { title: "预估工时 (h)", dataIndex: "estimatedHours", width: 130, align: "right" },
            { title: "已登记工时 (h)", dataIndex: "loggedHours", width: 140, align: "right" },
            {
              title: "投入度", width: 220,
              render: (_, r) => {
                const pct = r.estimatedHours > 0 ? Math.min(100, Math.round((r.loggedHours / r.estimatedHours) * 100)) : 0;
                return <Progress percent={pct} size="small" />;
              },
            },
          ]}
        />
      </Card>
    </div>
  );
}
