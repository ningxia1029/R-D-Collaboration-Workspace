"use client";

import { useEffect, useState } from "react";
import { Row, Col, Card, Statistic, Progress, Timeline, Tag, Typography, Spin, Empty, Badge } from "antd";
import {
  ProjectOutlined,
  CarryOutOutlined,
  WarningOutlined,
  AlertOutlined,
  FileTextOutlined,
} from "@ant-design/icons";
import Link from "next/link";
import dayjs from "dayjs";
import { get } from "@/lib/api-client";
import { StatusTag } from "@/components/common/Tags";
import { LIFECYCLE_LABELS, type LifecycleStage } from "@/lib/constants";

interface DashboardData {
  cards: {
    activeProjects: number;
    todoTasks: number;
    blockedTasks: number;
    delayedBom: number;
    recentEcos: number;
    docsCount: number;
    docsRecent: number;
  };
  health: {
    id: string; name: string; code: string; lifecycleStage: string;
    progress: number; blocked: number; delayed: number; overdueTasks: number;
    healthLevel: "green" | "yellow" | "red";
    owner?: { name: string } | null;
  }[];
  deadlines: { type: "TASK" | "BOM" | "PHASE"; id: string; title: string; date: string; project: string; status: string }[];
  ecoStats: { byType: Record<string, number>; byStatus: Record<string, number> };
}

const HEALTH = {
  green: { color: "#52c41a", label: "正常" },
  yellow: { color: "#faad14", label: "存疑" },
  red: { color: "#cf1322", label: "延期/阻断" },
} as const;

const DEADLINE_TYPE = {
  TASK: { color: "blue", label: "任务" },
  BOM: { color: "orange", label: "物料" },
  PHASE: { color: "purple", label: "阶段" },
} as const;

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    get<DashboardData>("/api/dashboard/summary")
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ textAlign: "center", padding: 80 }}><Spin size="large" /></div>;
  if (!data) return <Empty description="加载失败" />;

  const { cards } = data;

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>项目大盘</Typography.Title>

      {/* 统计卡片区 */}
      <Row gutter={[16, 16]}>
        <Col xs={12} md={8} xl={4}>
          <Card><Statistic title="在研项目" value={cards.activeProjects} prefix={<ProjectOutlined />} /></Card>
        </Col>
        <Col xs={12} md={8} xl={4}>
          <Card><Statistic title="待办任务" value={cards.todoTasks} prefix={<CarryOutOutlined />} /></Card>
        </Col>
        <Col xs={12} md={8} xl={4}>
          <Card><Statistic title="阻塞任务" value={cards.blockedTasks} valueStyle={{ color: cards.blockedTasks > 0 ? "#cf1322" : undefined }} prefix={<AlertOutlined />} /></Card>
        </Col>
        <Col xs={12} md={8} xl={4}>
          <Card><Statistic title="物料延迟预警" value={cards.delayedBom} valueStyle={{ color: cards.delayedBom > 0 ? "#cf1322" : undefined }} prefix={<WarningOutlined />} /></Card>
        </Col>
        <Col xs={12} md={8} xl={4}>
          <Card><Statistic title="近 7 天工程变更" value={cards.recentEcos} /></Card>
        </Col>
        <Col xs={12} md={8} xl={4}>
          <Card>
            <Statistic title="知识库文档" value={cards.docsCount} prefix={<FileTextOutlined />} suffix={<Typography.Text type="secondary" style={{ fontSize: 12 }}>本周 +{data.cards.docsRecent}</Typography.Text>} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        {/* 项目健康度 */}
        <Col xs={24} xl={14}>
          <Card title="项目健康度" size="small">
            {data.health.length === 0 ? <Empty /> : (
              <Row gutter={[12, 12]}>
                {data.health.map((p) => (
                  <Col xs={24} md={12} key={p.id}>
                    <Card size="small" hoverable>
                      <Link href={`/projects/${p.id}/tasks`}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <Typography.Text strong>{p.name}</Typography.Text>
                          <Badge color={HEALTH[p.healthLevel].color} text={HEALTH[p.healthLevel].label} />
                        </div>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {p.code} · {LIFECYCLE_LABELS[p.lifecycleStage as LifecycleStage] ?? p.lifecycleStage} · 负责人 {p.owner?.name ?? "—"}
                        </Typography.Text>
                        <Progress percent={p.progress} size="small" status={p.healthLevel === "red" ? "exception" : "active"} />
                        <div style={{ fontSize: 12 }}>
                          {p.blocked > 0 && <Tag color="error">阻塞 {p.blocked}</Tag>}
                          {p.delayed > 0 && <Tag color="warning">延迟物料 {p.delayed}</Tag>}
                          {p.overdueTasks > 0 && <Tag color="error">逾期任务 {p.overdueTasks}</Tag>}
                          {p.blocked === 0 && p.delayed === 0 && p.overdueTasks === 0 && <Tag color="success">无风险项</Tag>}
                        </div>
                      </Link>
                    </Card>
                  </Col>
                ))}
              </Row>
            )}
          </Card>

          {/* 变更统计 */}
          <Card title="工程变更统计" size="small" style={{ marginTop: 16 }}>
            <Row gutter={16}>
              <Col span={12}>
                <Typography.Text type="secondary">按类型</Typography.Text>
                <div style={{ marginTop: 8 }}>
                  {Object.entries(data.ecoStats.byType).map(([k, v]) => (
                    <Tag key={k} style={{ marginBottom: 4 }}>{k}: {v}</Tag>
                  ))}
                  {Object.keys(data.ecoStats.byType).length === 0 && <Typography.Text type="secondary">暂无</Typography.Text>}
                </div>
              </Col>
              <Col span={12}>
                <Typography.Text type="secondary">按状态</Typography.Text>
                <div style={{ marginTop: 8 }}>
                  {Object.entries(data.ecoStats.byStatus).map(([k, v]) => (
                    <span key={k} style={{ marginRight: 8, marginBottom: 4, display: "inline-block" }}>
                      <StatusTag value={k} />{v}
                    </span>
                  ))}
                  {Object.keys(data.ecoStats.byStatus).length === 0 && <Typography.Text type="secondary">暂无</Typography.Text>}
                </div>
              </Col>
            </Row>
          </Card>
        </Col>

        {/* 临近 Deadline */}
        <Col xs={24} xl={10}>
          <Card title="临近 Deadline（未来 14 天）" size="small">
            {data.deadlines.length === 0 ? <Empty description="未来 14 天无临近节点" /> : (
              <Timeline
                items={data.deadlines.map((d) => ({
                  color: DEADLINE_TYPE[d.type].color,
                  children: (
                    <div>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {dayjs(d.date).format("MM-DD")}（{dayjs(d.date).diff(dayjs(), "day")} 天后）· {d.project}
                      </Typography.Text>
                      <div>
                        <Tag color={DEADLINE_TYPE[d.type].color}>{DEADLINE_TYPE[d.type].label}</Tag>
                        {d.title} <StatusTag value={d.status} />
                      </div>
                    </div>
                  ),
                }))}
              />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
