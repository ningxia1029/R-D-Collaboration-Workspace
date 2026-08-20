import { expect, request as playwrightRequest, test, type APIRequestContext, type Browser } from "@playwright/test";

/**
 * 此规格只允许在 CI 一次性库，或双确认的本机隔离 PostgreSQL 16 UAT 库中执行。
 * 禁止对任何共享或生产 DATABASE_URL 启用它。
 */
const enabled = process.env.WORKBENCH_RBAC_E2E === "1";
const DEMO_PASSWORD = process.env.DEMO_SEED_PASSWORD ?? "";
const APP_BASE_URL = "http://localhost:3108";
const suffix = `rbac-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const openedContexts = new Set<APIRequestContext>();

if (enabled && !DEMO_PASSWORD) throw new Error("WORKBENCH_RBAC_E2E 要求显式提供 DEMO_SEED_PASSWORD");

type DemoRole = "admin" | "pm" | "engineer" | "viewer";

const accounts: Record<DemoRole, { email: string; password: string }> = {
  admin: { email: "admin@demo.com", password: DEMO_PASSWORD },
  pm: { email: "pm@demo.com", password: DEMO_PASSWORD },
  engineer: { email: "eng@demo.com", password: DEMO_PASSWORD },
  viewer: { email: "guest@demo.com", password: DEMO_PASSWORD },
};

async function signIn(browser: Browser, role: DemoRole | { email: string; password: string }) {
  const account = typeof role === "string" ? accounts[role] : role;
  const context = await browser.newContext({ baseURL: APP_BASE_URL });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(account.email);
  await page.getByLabel("密码").fill(account.password);
  await page.getByRole("button", { name: "登 录" }).click({ noWaitAfter: true });
  try {
    await page.waitForURL(/\/(dashboard|change-password)$/, { waitUntil: "commit", timeout: 30_000 });
  } catch {
    const summary = (await page.locator("body").innerText()).slice(0, 240).replace(/\s+/g, " ");
    const failedUrl = page.url();
    await page.close({ runBeforeUnload: false }).catch(() => undefined);
    await context.close().catch(() => undefined);
    throw new Error(`登录未进入目标页：email=${account.email} url=${failedUrl} page=${summary}`);
  }
  const landingPath = new URL(page.url()).pathname;
  const storageState = await context.storageState();
  await page.close({ runBeforeUnload: false });
  await context.close();
  const apiContext = await playwrightRequest.newContext({ baseURL: APP_BASE_URL, storageState });
  openedContexts.add(apiContext);
  return { context: apiContext, landingPath };
}

async function api(context: APIRequestContext, path: string, options: Parameters<APIRequestContext["fetch"]>[1] = {}) {
  return context.fetch(path, options);
}

async function json<T>(context: APIRequestContext, path: string, options?: Parameters<APIRequestContext["fetch"]>[1]) {
  const response = await api(context, path, options);
  return { response, body: await response.json() as T };
}

test.use({ trace: "off" });
test.afterEach(async () => {
  await Promise.all([...openedContexts].map((context) => context.dispose().catch(() => undefined)));
  openedContexts.clear();
});

test.describe("工作台四角色 RBAC 隔离 UAT", () => {
  test.skip(!enabled, "仅当 WORKBENCH_RBAC_E2E=1 时在 CI 隔离库执行");

  test("真实登录四个 demo 角色，并验证项目可见性、首次改密和写入权限边界", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "此 UAT 仅运行 chromium-desktop");
    test.setTimeout(180_000);

    const admin = (await signIn(browser, "admin")).context;
    const pm = (await signIn(browser, "pm")).context;
    const engineer = (await signIn(browser, "engineer")).context;
    const viewer = (await signIn(browser, "viewer")).context;
    console.log("[workbench-rbac] four-role-login=ok");
    const contexts = [admin, pm, engineer, viewer];

      // 四个 demo 账号都必须能真实建会话；viewer 仅可见其成员项目，后续新项目不可见。
      for (const context of contexts) {
        const projects = await api(context, "/api/projects");
        expect(projects.status()).toBe(200);
      }

      const roles = await json<Array<{ id: string; name: string }>>(admin, "/api/admin/roles");
      expect(roles.response.status()).toBe(200);
      const engineerRole = roles.body.find((role) => role.name === "engineer");
      expect(engineerRole).toBeTruthy();
      const adminUsers = await json<Array<{ id: string; email: string }>>(admin, "/api/admin/users");
      expect(adminUsers.response.status()).toBe(200);
      const engineerId = adminUsers.body.find((user) => user.email === accounts.engineer.email)?.id;
      const viewerId = adminUsers.body.find((user) => user.email === accounts.viewer.email)?.id;
      expect(engineerId).toBeTruthy();
      expect(viewerId).toBeTruthy();

      // admin 创建一次性临时账号；该账号只能改密，改密后需重新认证才能继续。
      const temporaryPassword = `Temp!Pass-${suffix}-A`;
      const newPassword = `Changed!Pass-${suffix}-B`;
      const createdUser = await json<{ id: string; mustChangePassword: boolean }>(admin, "/api/admin/users", {
        method: "POST",
        data: {
          name: `UAT 临时工程师 ${suffix}`,
          email: `uat-${suffix}@example.invalid`,
          roleId: engineerRole!.id,
          password: temporaryPassword,
        },
      });
      expect(createdUser.response.status()).toBe(201);
      expect(createdUser.body.mustChangePassword).toBe(true);
      console.log("[workbench-rbac] admin-account-create=ok");

      const temporaryLogin = await signIn(browser, { email: `uat-${suffix}@example.invalid`, password: temporaryPassword });
      const temporaryUser = temporaryLogin.context;
      contexts.push(temporaryUser);
      expect(temporaryLogin.landingPath).toBe("/change-password");
      expect((await api(temporaryUser, "/api/projects")).status()).toBe(403);
      const passwordChange = await api(temporaryUser, "/api/account/change-password", {
        method: "POST",
        data: { currentPassword: temporaryPassword, newPassword },
      });
      expect(passwordChange.status()).toBe(200);
      expect((await passwordChange.json()).requiresReauthentication).toBe(true);
      expect((await api(temporaryUser, "/api/projects")).status()).toBe(401);
      const changedUser = (await signIn(browser, { email: `uat-${suffix}@example.invalid`, password: newPassword })).context;
      contexts.push(changedUser);
      expect((await api(changedUser, "/api/projects")).status()).toBe(200);
      console.log("[workbench-rbac] first-password-change=ok");

      // PM 创建专属项目和任务。该项目没有 viewer 成员，用于验证可见性和 403 边界。
      const project = await json<{ id: string; name: string }>(pm, "/api/projects", {
        method: "POST",
        data: { code: `UAT-${suffix}`, name: `RBAC 隔离验收 ${suffix}`, description: "仅 CI 隔离数据库" },
      });
      expect(project.response.status()).toBe(201);
      const projectId = project.body.id;
      expect((await api(pm, "/api/projects")).status()).toBe(200);
      const viewerProjectsBefore = await json<Array<{ id: string }>>(viewer, "/api/projects");
      expect(viewerProjectsBefore.response.status()).toBe(200);
      expect(viewerProjectsBefore.body.some((candidate) => candidate.id === projectId)).toBe(false);

      const pmUsers = await json<Array<{ id: string; email: string }>>(pm, "/api/admin/users");
      expect(pmUsers.response.status()).toBe(403);
      const addEngineer = await api(pm, `/api/projects/${projectId}/members`, { method: "POST", data: { userId: engineerId } });
      expect(addEngineer.status()).toBe(201);
      const addViewer = await api(pm, `/api/projects/${projectId}/members`, { method: "POST", data: { userId: viewerId } });
      expect(addViewer.status()).toBe(201);

      const task = await json<{ id: string; title: string }>(pm, "/api/tasks", {
        method: "POST",
        data: { projectId, title: `工程师本人任务 ${suffix}`, assigneeId: engineerId, priority: "P1" },
      });
      expect(task.response.status()).toBe(201);
      expect(task.body.title).toContain(suffix);
      expect((await api(engineer, `/api/tasks/${task.body.id}`, { method: "PATCH", data: { status: "In Progress" } })).status()).toBe(200);
      const otherTask = await json<{ id: string }>(pm, "/api/tasks", {
        method: "POST",
        data: { projectId, title: `非工程师本人任务 ${suffix}`, assigneeId: viewerId, priority: "P2" },
      });
      expect(otherTask.response.status()).toBe(201);
      expect((await api(engineer, `/api/tasks/${otherTask.body.id}`, { method: "PATCH", data: { status: "In Progress" } })).status()).toBe(403);
      expect((await api(engineer, `/api/tasks/${task.body.id}`, { method: "PATCH", data: { assigneeId: viewerId } })).status()).toBe(403);
      console.log("[workbench-rbac] pm-project-task=ok");

      // 工程师可在自己成员项目创建/修改 BOM、创建 ECR/ECO、创建知识库和发表评论。
      const bom = await json<{ item: { id: string; mpn: string } }>(engineer, "/api/bom", {
        method: "POST",
        data: { projectId, mpn: `UAT-MPN-${suffix}`, name: `UAT BOM ${suffix}`, qty: 1 },
      });
      expect(bom.response.status()).toBe(201);
      expect((await api(engineer, `/api/bom/${bom.body.item.id}`, { method: "PATCH", data: { status: "Ordered" } })).status()).toBe(200);

      const ecr = await json<{ id: string; status: string }>(engineer, "/api/ecrs", {
        method: "POST",
        data: { projectId, title: `UAT ECR ${suffix}`, type: "Hardware", reason: "RBAC UAT" },
      });
      expect(ecr.response.status()).toBe(201);
      expect((await api(engineer, `/api/ecrs/${ecr.body.id}/action`, { method: "POST", data: { action: "submit" } })).status()).toBe(200);
      expect((await api(pm, `/api/ecrs/${ecr.body.id}/action`, { method: "POST", data: { action: "approve", comment: `批准 ${suffix}` } })).status()).toBe(200);
      expect((await api(pm, `/api/ecrs/${ecr.body.id}/action`, { method: "POST", data: { action: "convert" } })).status()).toBe(201);

      const eco = await json<{ id: string; status: string }>(engineer, "/api/ecos", {
        method: "POST",
        data: { projectId, type: "BOM", reason: `UAT ECO ${suffix}`, impacts: [{ entityType: "BOM_ITEM", entityId: bom.body.item.id }] },
      });
      expect(eco.response.status()).toBe(201);
      // ECO 的审批状态流转由 PM 执行；此处不把未覆盖的 IMPLEMENTED/CLOSED 当成已验收。
      expect((await api(pm, `/api/ecos/${eco.body.id}`, { method: "PATCH", data: { transition: "PENDING" } })).status()).toBe(200);
      expect((await api(pm, `/api/ecos/${eco.body.id}`, { method: "PATCH", data: { transition: "APPROVED", comment: `批准 ${suffix}` } })).status()).toBe(200);

      const document = await json<{ id: string; title: string }>(engineer, "/api/documents", {
        method: "POST",
        data: { projectId, title: `UAT 知识库 ${suffix}`, category: "调试笔记", contentMd: `# ${suffix}` },
      });
      expect(document.response.status()).toBe(201);
      expect((await api(engineer, "/api/comments", {
        method: "POST",
        data: { entityType: "TASK", entityId: task.body.id, content: `工程师评论 ${suffix}` },
      })).status()).toBe(201);
      console.log("[workbench-rbac] engineer-writes=ok");

      // viewer 成员仍只能只读，评论和全部业务写必须 403；临时工程师作为非成员也必须 403。
      expect((await api(viewer, `/api/projects/${projectId}`)).status()).toBe(200);
      expect((await api(viewer, `/api/tasks?projectId=${projectId}`)).status()).toBe(200);
      expect((await api(viewer, "/api/projects", { method: "POST", data: { code: `DENY-${suffix}`, name: "forbidden" } })).status()).toBe(403);
      expect((await api(viewer, "/api/comments", {
        method: "POST",
        data: { entityType: "TASK", entityId: task.body.id, content: `禁止评论 ${suffix}` },
      })).status()).toBe(403);
      expect((await api(viewer, "/api/documents", {
        method: "POST",
        data: { projectId, title: `禁止知识库 ${suffix}`, contentMd: "forbidden" },
      })).status()).toBe(403);
      expect((await api(viewer, "/api/bom", {
        method: "POST",
        data: { projectId, mpn: `DENY-${suffix}`, name: "forbidden" },
      })).status()).toBe(403);
      expect((await api(viewer, "/api/ecos", {
        method: "POST",
        data: { projectId, type: "BOM" },
      })).status()).toBe(403);
      expect((await api(viewer, "/api/ecrs", {
        method: "POST",
        data: { projectId, title: "forbidden", type: "BOM" },
      })).status()).toBe(403);
      expect((await api(viewer, `/api/tasks/${task.body.id}`, { method: "PATCH", data: { status: "Done" } })).status()).toBe(403);
      expect((await api(viewer, `/api/bom/${bom.body.item.id}`, { method: "PATCH", data: { status: "Received" } })).status()).toBe(403);
      expect((await api(viewer, `/api/ecos/${eco.body.id}`, { method: "PATCH", data: { transition: "IMPLEMENTED" } })).status()).toBe(403);
      expect((await api(viewer, `/api/ecrs/${ecr.body.id}/action`, { method: "POST", data: { action: "approve" } })).status()).toBe(403);
      expect((await api(changedUser, `/api/projects/${projectId}`)).status()).toBe(403);
      expect((await api(changedUser, `/api/tasks?projectId=${projectId}`)).status()).toBe(403);
      console.log("[workbench-rbac] viewer-and-non-member-denials=ok");
  });
});
