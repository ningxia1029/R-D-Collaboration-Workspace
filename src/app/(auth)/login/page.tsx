"use client";

import { useState, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Card, Form, Input, Typography, Alert, Space, Tag } from "antd";

const DEMO_ACCOUNTS = [
  { email: "admin@demo.com", label: "系统管理员" },
  { email: "pm@demo.com", label: "项目经理" },
  { email: "eng@demo.com", label: "研发工程师" },
  { email: "guest@demo.com", label: "访客" },
];

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFinish = async (values: { email: string; password: string }) => {
    setLoading(true);
    setError(null);
    const res = await signIn("credentials", {
      email: values.email,
      password: values.password,
      redirect: false,
    });
    setLoading(false);
    if (res?.error) {
      setError("邮箱或密码错误，或账号已被停用");
      return;
    }
    router.push(searchParams.get("callbackUrl") || "/dashboard");
    router.refresh();
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #1677ff 0%, #0e3fa8 100%)",
      }}
    >
      <Card style={{ width: 400, boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
        <Typography.Title level={3} style={{ textAlign: "center", marginBottom: 4 }}>
          PLM 研发协同平台
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ textAlign: "center" }}>
          PLM · 项目管理 · 工程知识库 一体化
        </Typography.Paragraph>
        {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
        <Form layout="vertical" onFinish={onFinish} initialValues={{ email: "admin@demo.com", password: "Demo@123456" }}>
          <Form.Item name="email" label="邮箱" rules={[{ required: true, message: "请输入邮箱" }]}>
            <Input size="large" placeholder="email@example.com" autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }]}>
            <Input.Password size="large" placeholder="密码" autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" size="large" block loading={loading}>
            登 录
          </Button>
        </Form>
        <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 8, fontSize: 12 }}>
          演示账号（密码均为 Demo@123456）：
        </Typography.Paragraph>
        <Space wrap size={[4, 4]}>
          {DEMO_ACCOUNTS.map((a) => (
            <Tag key={a.email} style={{ cursor: "pointer" }}
              onClick={() => onFinish({ email: a.email, password: "Demo@123456" })}>
              {a.label} {a.email}
            </Tag>
          ))}
        </Space>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
