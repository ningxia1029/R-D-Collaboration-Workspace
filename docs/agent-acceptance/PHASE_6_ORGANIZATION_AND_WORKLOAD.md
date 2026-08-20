# 阶段 6：组织架构与资源负载验收记录

| 属性 | 内容 |
|---|---|
| 状态 | **已通过本地工程与隔离数据库验收** |
| 日期 | 2026-08-13 |
| 基线 | WorkBuddy Pro 1.0.1，`codex/workbuddy-production-hardening` |
| 数据库 | 一次性 PostgreSQL 14.23；未连接或改写业务数据库 |

## 1. 已实现范围

- 组织单元、岗位、主部门、组织负责人、直属经理和周标准产能的管理员维护页与 API。
- 组织父子关系和经理链使用事务级 advisory lock 串行校验；负责人必须是本组织启用成员，岗位必须匹配主部门。
- `org:read` / `org:manage` 权限点；普通成员只看本人主部门基本信息，组织负责人看所负责组织子树，管理员看全量。
- `ResourcePlanWindow` + `ResourcePlanAllocation`：唯一已发布覆盖窗口表示计划数据已提供，因而“无分配”可解释为 0；无覆盖窗口保持未知。
- 启用 `plm_org_get_tree`、`plm_org_list_members`、`plm_member_get_workload`，模型可见只读 Tool 从 9 个增至 12 个。
- `time:read` 仅本人；多人需 `time:read_all` 并叠加项目成员或负责人组织范围。Tool 不返回邮箱、工时备注、工号或手机号。
- 旧资源页移除伪“投入度”，只展示“开放任务预估存量”和“历史登记工时”，并明确二者不等于窗口利用率。

## 2. 确定性计算口径

- 查询窗口是调用方 IANA 时区的闭区间日期；登记工时使用 `[本地 dateFrom 00:00, dateTo 次日 00:00)`。
- `capacityHoursInWindow = weeklyCapacityHours / 5 × 周一至周五天数`。
- `plannedHoursInWindow` 仅来自完整覆盖查询窗的唯一 `published` 计划窗口。
- `utilizationPercent = plannedHoursInWindow / capacityHoursInWindow × 100`；缺产能、产能为 0、无覆盖计划或重叠脏窗口时为 `null`。
- `openEstimatedHours` 是当前未完成任务的预估存量，不是时间窗计划；混合质量结果只允许按该口径排序，不得称为“利用率最高”。
- 当前工作日只识别周一至周五，未扣企业节假日或个人休假，Tool 始终返回结构化 warning。

## 3. 自动化与数据库证据

| 验收层 | 命令/结果 |
|---|---|
| Prisma | `npx prisma validate` 通过；客户端生成成功 |
| 类型 | `npm run typecheck` 通过 |
| 单元/回归 | `npm test` 连续两次 **59/59** 通过 |
| 生产构建 | `npm run build` 通过，45/45 页面生成；新增 `/admin/organization`、`/api/admin/organization`、`/api/resource-plans` |
| 迁移 | 全新隔离库执行 **8/8** migration；`prisma migrate status` 为 up to date |
| 在线索引 | 既有大表运维索引 **5/5** `CONCURRENTLY` 创建并验证有效 |
| 漂移 | 实际隔离数据库 → Prisma schema：`No difference detected.` |
| Tool 审计 | 组织/负载正反调用 **9/9** 写入 `AgentToolExecution`，只读前后业务快照一致 |
| 清理 | `PHASE6_CLEANUP_OK`，所有阶段 6 临时 PostgreSQL 实例已停止并删除 |

隔离数据库固定夹具的精确结果：5 个工作日、40h 产能、30h 计划、6h 窗口登记工时、75% 利用率。缺产能且缺计划的成员返回 `null`；已发布空计划窗口的成员返回计划 0h、利用率 0%，两种状态可区分。

数据库和服务反例覆盖：组织环、自我经理、经理链环、跨部门岗位、发布窗口重叠、窗口外分配、非负责人任务分配、单日超过 24h、普通成员读取同事、负责人跨组织、项目经理跨项目、停用成员状态映射和 Tool 邮箱脱敏。

第一轮隔离验收发现旧资源接口的本人过滤被对象字段覆盖，已改为单一 `assigneeId` 条件并在全新隔离库复验通过。最终回归还消除了委托 token 篡改测试“替换字符恰好相同”的 1/64 随机波动，连续两次通过。

## 4. 浏览器验收

- Edge + Playwright CLI 使用脱敏一次性管理员账号登录成功。
- 桌面端组织、岗位、成员页签，以及组织/成员编辑表单可达；资源页口径提示和列名正确。
- 390×844 移动端首次截图暴露表格逐字换行，随后改为卡片列表并重新验收；主导航按钮、页签和编辑入口可达。
- 最终桌面/移动页面控制台：0 error / 0 warning。
- 截图：`output/playwright/phase6-organization-desktop.png`、`phase6-resources-wording.png`、`phase6-organization-mobile-final.png`。

## 5. 不能证明与后续边界

- 未在生产/业务数据库执行迁移，未导入真实组织、排班、节假日或请假数据。
- 隔离数据库是 PostgreSQL 14.23，不等于项目目标 PostgreSQL 16 的正式验收。
- 尚未完成真实规模下的 P95、并发和大组织分页压测；这些进入阶段 8。
- 资源计划维护 API 已完成，阶段 6 未建设专用排程甘特 UI；当前管理员可维护组织与个人产能，计划窗口可经受控 API 导入。
- 未验证外部 IdP、真实模型、TLS、桌面应用重启和生产部署。
