"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Form, Input, Typography } from "antd";
import { post } from "@/lib/api-client";
import { validatePassword } from "@/lib/passwordPolicy";

interface ChangePasswordForm {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export default function ChangePasswordPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (values: ChangePasswordForm) => {
    setSubmitting(true);
    setError(null);
    try {
      await post("/api/account/change-password", {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      await signOut({ redirect: false });
      router.replace("/login?passwordChanged=1");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "密码修改失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f5f7fa" }}>
      <Card style={{ width: 440, boxShadow: "0 8px 32px rgba(0,0,0,0.12)" }}>
        <Typography.Title level={3}>修改密码</Typography.Title>
        <Typography.Paragraph type="secondary">
          首次登录必须更换临时密码。新密码至少 12 位，并同时包含大写字母、小写字母、数字和特殊字符。
        </Typography.Paragraph>
        {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
        <Form<ChangePasswordForm> layout="vertical" onFinish={submit}>
          <Form.Item name="currentPassword" label="当前密码" rules={[{ required: true, message: "请输入当前密码" }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item
            name="newPassword"
            label="新密码"
            rules={[
              { required: true, message: "请输入新密码" },
              {
                validator: async (_, value) => {
                  const result = validatePassword(value ?? "");
                  if (!result.valid) throw new Error(result.errors.join("；"));
                },
              },
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="确认新密码"
            dependencies={["newPassword"]}
            rules={[
              { required: true, message: "请再次输入新密码" },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  return !value || getFieldValue("newPassword") === value
                    ? Promise.resolve()
                    : Promise.reject(new Error("两次输入的新密码不一致"));
                },
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={submitting}>修改密码并重新登录</Button>
        </Form>
      </Card>
    </div>
  );
}
