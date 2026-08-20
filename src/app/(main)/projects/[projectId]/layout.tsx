"use client";

import { useEffect, useState } from "react";
import { Tabs, Tag, Typography, Space, Spin, Button, Modal, Input, App, Dropdown } from "antd";
import { RobotOutlined, SwapOutlined } from "@ant-design/icons";
import { usePathname, useRouter, useParams } from "next/navigation";
import { get, post } from "@/lib/api-client";
import { StatusTag } from "@/components/common/Tags";
import { LIFECYCLE_LABELS, LIFECYCLE_STAGES, type LifecycleStage } from "@/lib/constants";
import { ProjectCtx, type ProjectDetail } from "./ProjectContext";

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [transitionOpen, setTransitionOpen] = useState(false);
  const [toStage, setToStage] = useState<LifecycleStage | null>(null);
  const [comment, setComment] = useState("");
  const pathname = usePathname();
  const router = useRouter();
  const { message, modal } = App.useApp();
  const canManage = project?.currentUserAccess.permissions.includes("project:update") ?? false;

  const load = () => {
    get<ProjectDetail>(`/api/projects/${projectId}`)
      .then(setProject)
      .catch((e) => message.error(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [projectId]);

  const tabKey = pathname.split("/")[3] ?? "tasks";

  const doTransition = async (force = false) => {
    try {
      const res = await post<{ warning: boolean; warnings: string[] }>(`/api/projects/${projectId}/lifecycle`, { toStage, comment, force });
      if (res.warning) {
        modal.confirm({
          title: "阶段流转提醒",
          content: res.warnings.join("；") + "。是否仍要流转？",
          onOk: () => doTransition(true),
        });
        return;
      }
      message.success("生命周期阶段已流转");
      setTransitionOpen(false);
      setComment("");
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  if (loading) return <div style={{ textAlign: "center", padding: 80 }}><Spin size="large" /></div>;
  if (!project) return null;

  const currentIdx = LIFECYCLE_STAGES.indexOf(project.lifecycleStage as LifecycleStage);
  const nextStage = LIFECYCLE_STAGES[currentIdx + 1] as LifecycleStage | undefined;
  const prevStage = LIFECYCLE_STAGES[currentIdx - 1] as LifecycleStage | undefined;

  return (
    <ProjectCtx.Provider value={{ project, reload: load }}>
      <div style={{ marginBottom: 8 }}>
        <Space align="center" wrap>
          <Typography.Title level={4} style={{ margin: 0 }}>{project.name}</Typography.Title>
          <Typography.Text type="secondary">{project.code}</Typography.Text>
          <StatusTag value={project.status} />
          <Tag color="geekblue">{LIFECYCLE_LABELS[project.lifecycleStage as LifecycleStage]}</Tag>
          {project.product && <Tag>产品：{project.product.name}</Tag>}
          <Button
            size="small"
            icon={<RobotOutlined />}
            onClick={() => router.push(`/agent?projectId=${encodeURIComponent(projectId)}`)}
          >
            问智能体
          </Button>
          {canManage && (nextStage || prevStage) && (
            <Dropdown
              menu={{
                items: [
                  ...(nextStage ? [{ key: nextStage, label: `推进到「${LIFECYCLE_LABELS[nextStage]}」` }] : []),
                  ...(prevStage ? [{ key: prevStage, label: `回退到「${LIFECYCLE_LABELS[prevStage]}」` }] : []),
                ],
                onClick: ({ key }) => {
                  setToStage(key as LifecycleStage);
                  setTransitionOpen(true);
                },
              }}
            >
              <Button size="small" icon={<SwapOutlined />}>阶段流转</Button>
            </Dropdown>
          )}
        </Space>
      </div>
      <Tabs
        activeKey={tabKey}
        onChange={(key) => router.push(`/projects/${projectId}/${key}`)}
        items={[
          { key: "tasks", label: "任务跟踪" },
          { key: "bom", label: "BOM 物料" },
          { key: "specs", label: "技术参数" },
          { key: "changes", label: "工程变更" },
          { key: "settings", label: "项目设置" },
        ]}
      />
      {children}

      <Modal
        title={`生命周期流转：${LIFECYCLE_LABELS[project.lifecycleStage as LifecycleStage]} → ${toStage ? LIFECYCLE_LABELS[toStage] : ""}`}
        open={transitionOpen}
        onOk={() => doTransition(false)}
        onCancel={() => setTransitionOpen(false)}
        okText="确认流转"
      >
        <Input.TextArea
          rows={3}
          placeholder="流转说明（将记录到审批日志）"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </Modal>
    </ProjectCtx.Provider>
  );
}
