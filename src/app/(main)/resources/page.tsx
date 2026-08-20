"use client";

import { useEffect, useState } from "react";
import { Card, Table, App, Typography, Select, Space, Alert } from "antd";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { get } from "@/lib/api-client";

interface Workload {
  user: { id: string; name: string };
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
    开放任务预估存量: w.estimatedHours,
    历史登记工时: w.loggedHours,
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
        <Alert
          type="info"
          showIcon
          message="本页对照开放任务预估存量与历史登记工时，不代表时间窗利用率；缺少发布计划或产能时不得推断利用率。"
          style={{ marginBottom: 12 }}
        />
        <div style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <XAxis dataKey="name" />
              <YAxis unit="h" />
              <Tooltip />
              <Legend />
              <Bar dataKey="开放任务预估存量" fill="#1677ff" radius={[4, 4, 0, 0]} />
              <Bar dataKey="历史登记工时" fill="#52c41a" radius={[4, 4, 0, 0]} />
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
            { title: "成员", render: (_, r) => <span>{r.user.name}</span> },
            { title: "进行中任务", dataIndex: "openTasks", width: 110, align: "right" },
            { title: "开放任务预估存量 (h)", dataIndex: "estimatedHours", width: 190, align: "right" },
            { title: "历史登记工时 (h)", dataIndex: "loggedHours", width: 160, align: "right" },
          ]}
        />
      </Card>
    </div>
  );
}
