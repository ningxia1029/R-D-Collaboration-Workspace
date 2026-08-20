"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Alert, App, Button, Card, Checkbox, Col, Descriptions, Form, Input, Row, Space, Spin, Statistic, Switch, Table, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { get, patch } from "@/lib/api-client";

interface AgentAdminData {
  control: {
    enabled: boolean;
    configurationReady: boolean;
    operational: boolean;
    disabledTools: string[];
    maintenanceMessage: string | null;
    updatedAt: string | null;
  };
  environment: { configurationReady: boolean; missingConfigurationCount: number };
  tools: Array<{ name: string; enabled: boolean }>;
  runsByStatus: Record<string, number>;
  worker: { lastHeartbeatAt: string | null; lastWorkerId: string | null };
  recentFailures: Array<{ id: string; userId: string; failureCode: string | null; completedAt: string | null }>;
}

interface FormValues {
  enabled: boolean;
  disabledTools: string[];
  maintenanceMessage?: string;
}

export default function AgentAdminPage() {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const [form] = Form.useForm<FormValues>();
  const [data, setData] = useState<AgentAdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    get<AgentAdminData>("/api/admin/agent")
      .then((value) => {
        setData(value);
        form.setFieldsValue({
          enabled: value.control.enabled,
          disabledTools: value.control.disabledTools,
          maintenanceMessage: value.control.maintenanceMessage ?? "",
        });
      })
      .catch((error: Error) => message.error(error.message))
      .finally(() => setLoading(false));
  }, [form, message]);

  useEffect(() => {
    if (sessionStatus === "loading") return;
    if (session?.user?.roleName !== "admin") {
      router.replace("/dashboard");
      return;
    }
    load();
  }, [load, router, session?.user?.roleName, sessionStatus]);

  const save = async (values: FormValues) => {
    const execute = async () => {
      setSaving(true);
      try {
        await patch("/api/admin/agent", {
          enabled: values.enabled,
          disabledTools: values.disabledTools ?? [],
          maintenanceMessage: values.maintenanceMessage?.trim() || null,
        });
        message.success("智能体控制策略已更新并写入审计");
        load();
      } catch (error) {
        message.error((error as Error).message);
      } finally {
        setSaving(false);
      }
    };
    if (!values.enabled && data?.control.enabled) {
      modal.confirm({
        title: "确认停用企业智能体？",
        content: "排队中和等待补充的 Run 将立即取消；运行中的 Run 将收到取消请求。PLM 主系统不受影响。",
        okText: "确认停用",
        okButtonProps: { danger: true },
        onOk: execute,
      });
      return;
    }
    await execute();
  };

  if (sessionStatus === "loading" || session?.user?.roleName !== "admin") {
    return <Spin size="large" aria-label="正在校验管理员权限" />;
  }

  return (
    <main aria-labelledby="agent-admin-title">
      <Typography.Title id="agent-admin-title" level={3} style={{ marginTop: 0 }}>企业智能体运维控制台</Typography.Title>
      {!data?.environment.configurationReady && (
        <Alert
          type="error"
          showIcon
          message="运行配置未就绪"
          description={`有 ${data?.environment.missingConfigurationCount ?? "若干"} 项内部密钥缺失或不足 32 字节。即使打开开关也不会领取任务。`}
          style={{ marginBottom: 16 }}
        />
      )}
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}>
          <Card title="总开关与 Tool 策略">
            <Spin spinning={loading}>
              <Form form={form} layout="vertical" onFinish={save} initialValues={{ enabled: false, disabledTools: [] }}>
              <Form.Item name="enabled" label="Agent 总开关" valuePropName="checked">
                <Switch checkedChildren="启用" unCheckedChildren="停用" aria-label="Agent 总开关" />
              </Form.Item>
              <Form.Item name="maintenanceMessage" label="维护提示" rules={[{ max: 500, message: "最多 500 字" }]}>
                <Input.TextArea rows={3} maxLength={500} showCount placeholder="停用时向用户显示，不要填写内部密钥或堆栈" />
              </Form.Item>
              <Form.Item name="disabledTools" label="停用的只读 Tool">
                <Checkbox.Group style={{ width: "100%" }}>
                  <Row gutter={[8, 8]}>
                    {(data?.tools ?? []).map((tool) => (
                      <Col xs={24} md={12} key={tool.name}><Checkbox value={tool.name}>{tool.name}</Checkbox></Col>
                    ))}
                  </Row>
                </Checkbox.Group>
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={saving}>保存并写入审计</Button>
              </Form>
            </Spin>
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Card title="运行状态" loading={loading}>
              <Descriptions column={1} size="small">
                <Descriptions.Item label="服务状态"><Tag color={data?.control.operational ? "green" : "red"}>{data?.control.operational ? "可用" : "不可用"}</Tag></Descriptions.Item>
                <Descriptions.Item label="最近 Worker 心跳">{data?.worker.lastHeartbeatAt ? dayjs(data.worker.lastHeartbeatAt).format("YYYY-MM-DD HH:mm:ss") : "尚无心跳"}</Descriptions.Item>
                <Descriptions.Item label="最后更新">{data?.control.updatedAt ? dayjs(data.control.updatedAt).format("YYYY-MM-DD HH:mm:ss") : "尚未配置"}</Descriptions.Item>
              </Descriptions>
              <Row gutter={[8, 8]} style={{ marginTop: 16 }}>
                {Object.entries(data?.runsByStatus ?? {}).map(([status, count]) => (
                  <Col span={8} key={status}><Statistic title={status} value={count} /></Col>
                ))}
              </Row>
            </Card>
          </Space>
        </Col>
      </Row>
      <Card title="最近失败（不展示问题正文）" style={{ marginTop: 16 }}>
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={data?.recentFailures ?? []}
          scroll={{ x: 720 }}
          columns={[
            { title: "Run ID", dataIndex: "id", width: 220, ellipsis: true, render: (value) => <Typography.Text code>{value}</Typography.Text> },
            { title: "用户 ID", dataIndex: "userId", width: 220, ellipsis: true },
            { title: "错误码", dataIndex: "failureCode", width: 180, render: (value) => value ?? "—" },
            { title: "完成时间", dataIndex: "completedAt", width: 180, render: (value) => value ? dayjs(value).format("YYYY-MM-DD HH:mm:ss") : "—" },
          ]}
        />
      </Card>
    </main>
  );
}
