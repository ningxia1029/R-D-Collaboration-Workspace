"use client";

import { useEffect, useState } from "react";
import { Layout, Menu, Dropdown, Avatar, Space, Typography, theme, Button, Drawer, Grid } from "antd";
import {
  DashboardOutlined,
  ProjectOutlined,
  DeploymentUnitOutlined,
  DatabaseOutlined,
  BookOutlined,
  TeamOutlined,
  SettingOutlined,
  LogoutOutlined,
  UserOutlined,
  AuditOutlined,
  RobotOutlined,
  MenuOutlined,
} from "@ant-design/icons";
import { usePathname, useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import GlobalSearch from "@/components/layout/GlobalSearch";

const { Sider, Header, Content } = Layout;

const ROLE_LABELS: Record<string, string> = {
  admin: "系统管理员",
  pm: "项目经理",
  engineer: "研发工程师",
  viewer: "访客",
};

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.lg;
  const [navigationOpen, setNavigationOpen] = useState(false);
  const {
    token: { colorBgContainer },
  } = theme.useToken();

  const selectedKey = (() => {
    if (pathname.startsWith("/dashboard")) return "/dashboard";
    if (pathname.startsWith("/projects")) return "/projects";
    if (pathname.startsWith("/plm/products")) return "/plm/products";
    if (pathname.startsWith("/plm/materials")) return "/plm/materials";
    if (pathname.startsWith("/knowledge")) return "/knowledge";
    if (pathname.startsWith("/resources")) return "/resources";
    if (pathname === "/agent" || pathname.startsWith("/agent/")) return "/agent";
    if (pathname.startsWith("/admin/agent")) return "/admin/agent";
    if (pathname.startsWith("/admin/organization")) return "/admin/organization";
    if (pathname.startsWith("/admin/users")) return "/admin/users";
    if (pathname.startsWith("/admin/audit")) return "/admin/audit";
    return pathname;
  })();

  const isAdmin = session?.user?.roleName === "admin";

  const menuItems = [
    { key: "/dashboard", icon: <DashboardOutlined />, label: "Dashboard 大盘" },
    { key: "/projects", icon: <ProjectOutlined />, label: "项目与任务" },
    {
      key: "plm",
      icon: <DeploymentUnitOutlined />,
      label: "PLM 产品管理",
      children: [
        { key: "/plm/products", label: "产品结构 (BOM 树)" },
        { key: "/plm/materials", icon: <DatabaseOutlined />, label: "物料库" },
      ],
    },
    { key: "/knowledge", icon: <BookOutlined />, label: "工程知识库" },
    { key: "/resources", icon: <TeamOutlined />, label: "资源与工时" },
    { key: "/agent", icon: <RobotOutlined />, label: "研发智能体" },
    ...(isAdmin
      ? [
          {
            key: "admin",
            icon: <SettingOutlined />,
            label: "系统管理",
            children: [
              { key: "/admin/users", label: "用户与角色" },
              { key: "/admin/organization", icon: <TeamOutlined />, label: "组织与产能" },
              { key: "/admin/audit", icon: <AuditOutlined />, label: "审计日志" },
              { key: "/admin/agent", icon: <RobotOutlined />, label: "智能体运维" },
            ],
          },
        ]
      : []),
  ];

  const navigation = (
    <>
      <div
        style={{
          height: 56,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontWeight: 700,
          fontSize: 16,
          letterSpacing: 1,
        }}
      >
        PLM 研发协同平台
      </div>
      <Menu
        theme="dark"
        mode="inline"
        selectedKeys={[selectedKey]}
        defaultOpenKeys={["plm", "admin"]}
        items={menuItems}
        onClick={({ key }) => {
          router.push(key);
          setNavigationOpen(false);
        }}
      />
    </>
  );

  return (
    <Layout style={{ minHeight: "100vh" }}>
      {!isMobile && <Sider width={220} theme="dark">{navigation}</Sider>}
      <Drawer
        title={null}
        placement="left"
        width={260}
        open={isMobile && navigationOpen}
        onClose={() => setNavigationOpen(false)}
        styles={{ body: { padding: 0, background: "#001529" } }}
        aria-label="主导航"
      >
        {navigation}
      </Drawer>
      <Layout>
        <Header
          style={{
            background: colorBgContainer,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: isMobile ? "0 12px" : "0 24px",
            borderBottom: "1px solid #f0f0f0",
            position: "sticky",
            top: 0,
            zIndex: 10,
          }}
        >
          <Space style={{ minWidth: 0, flex: 1 }}>
            {isMobile && (
              <Button
                type="text"
                icon={<MenuOutlined />}
                aria-label="打开主导航"
                onClick={() => setNavigationOpen(true)}
              />
            )}
            <GlobalSearch />
          </Space>
          <Dropdown
            menu={{
              items: [{ key: "logout", icon: <LogoutOutlined />, label: "退出登录", onClick: () => signOut({ callbackUrl: "/login" }) }],
            }}
          >
            <Space style={{ cursor: "pointer" }}>
              <Avatar icon={<UserOutlined />} />
              <span>
                {!isMobile && (session?.user?.name ?? "…")}
                <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                  {!isMobile && (ROLE_LABELS[session?.user?.roleName ?? ""] ?? "")}
                </Typography.Text>
              </span>
            </Space>
          </Dropdown>
        </Header>
        <Content style={{ padding: isMobile ? 12 : 24, overflow: "auto", minWidth: 0 }}>{children}</Content>
      </Layout>
    </Layout>
  );
}
