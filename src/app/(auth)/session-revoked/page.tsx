"use client";

import { useEffect, useRef } from "react";
import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Alert, Card, Spin, Typography } from "antd";

export default function SessionRevokedPage() {
  const router = useRouter();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const clearSession = async () => {
      await signOut({ redirect: false });
      router.replace("/login?sessionRevoked=1");
      router.refresh();
    };
    void clearSession();
  }, [router]);

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f5f7fa" }}>
      <Card style={{ width: 420, textAlign: "center" }}>
        <Spin />
        <Typography.Title level={4} style={{ marginTop: 16 }}>会话已失效</Typography.Title>
        <Alert type="warning" showIcon message="账号状态或权限已变化，正在安全退出，请重新登录。" />
      </Card>
    </div>
  );
}
