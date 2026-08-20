// 全局枚举常量（SQLite 无原生 enum，DB 层存 String，此处统一约束取值）
import { z } from "zod";

export const TASK_STATUSES = ["To Do", "In Progress", "Blocked", "Testing", "Done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PHASE_NAMES = ["POC", "EVT", "DVT", "PVT", "Mass Production"] as const;
export type PhaseName = (typeof PHASE_NAMES)[number];

export const BOM_STATUSES = ["Unordered", "Ordered", "In Transit", "Arrived", "Delayed"] as const;
export type BomStatus = (typeof BOM_STATUSES)[number];

export const CHANGE_TYPES = ["Hardware", "Mechanical", "Firmware", "BOM"] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

export const ECO_STATUSES = ["DRAFT", "PENDING", "APPROVED", "IMPLEMENTED", "CLOSED"] as const;
export type EcoStatus = (typeof ECO_STATUSES)[number];

export const ECR_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "CONVERTED"] as const;
export type EcrStatus = (typeof ECR_STATUSES)[number];

export const LIFECYCLE_STAGES = ["CONCEPT", "RD", "PILOT", "MP", "EOL"] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];
export const LIFECYCLE_LABELS: Record<LifecycleStage, string> = {
  CONCEPT: "概念",
  RD: "研发",
  PILOT: "试产",
  MP: "量产",
  EOL: "停产",
};

export const COMPARE_RULES = ["gte", "lte", "eq"] as const;
export type CompareRule = (typeof COMPARE_RULES)[number];

export const PROJECT_STATUSES = ["active", "completed", "archived"] as const;

export const PRODUCT_NODE_TYPES = ["PRODUCT", "ASSEMBLY", "COMPONENT", "MATERIAL"] as const;

export const DOC_CATEGORIES = ["设计规范", "调试笔记", "失效分析", "经验案例", "工作流", "其他"] as const;

export const ROLE_NAMES = ["admin", "pm", "engineer", "viewer"] as const;
export type RoleName = (typeof ROLE_NAMES)[number];
export const ROLE_LABELS: Record<RoleName, string> = {
  admin: "系统管理员",
  pm: "项目经理",
  engineer: "研发工程师",
  viewer: "访客",
};

// ---- 权限点 ----
export const PERMISSIONS = [
  "dashboard:read",
  "project:read", "project:create", "project:update", "project:archive",
  "task:read", "task:create", "task:update", "task:update_own", "task:delete", "task:assign",
  "bom:read", "bom:create", "bom:update", "bom:delete", "bom:import", "bom:export",
  "spec:read", "spec:create", "spec:update", "spec:delete",
  "eco:read", "eco:create", "eco:update", "eco:approve", "eco:implement",
  "ecr:read", "ecr:create", "ecr:submit", "ecr:approve",
  "plm:read", "plm:manage",
  "org:read", "org:manage",
  "kb:read", "kb:create", "kb:update", "kb:delete",
  "time:read", "time:log", "time:read_all",
  "admin:user_manage", "admin:role_manage", "admin:audit_read",
] as const;
export type PermissionCode = (typeof PERMISSIONS)[number];

// 角色 → 权限矩阵（admin 在代码中短路为全量）
export const ROLE_PERMISSION_MAP: Record<Exclude<RoleName, "admin">, PermissionCode[]> = {
  pm: [
    "dashboard:read",
    "project:read", "project:create", "project:update", "project:archive",
    "task:read", "task:create", "task:update", "task:update_own", "task:delete", "task:assign",
    "bom:read", "bom:create", "bom:update", "bom:delete", "bom:import", "bom:export",
    "spec:read", "spec:create", "spec:update", "spec:delete",
    "eco:read", "eco:create", "eco:update", "eco:approve", "eco:implement",
    "ecr:read", "ecr:create", "ecr:submit", "ecr:approve",
    "plm:read", "plm:manage",
    "org:read",
    "kb:read", "kb:create", "kb:update", "kb:delete",
    "time:read", "time:log", "time:read_all",
  ],
  engineer: [
    "dashboard:read",
    "project:read",
    "task:read", "task:update_own",
    "bom:read", "bom:create", "bom:update", "bom:import", "bom:export",
    "spec:read", "spec:create", "spec:update",
    "eco:read", "eco:create",
    "ecr:read", "ecr:create", "ecr:submit",
    "plm:read",
    "org:read",
    "kb:read", "kb:create", "kb:update",
    "time:read", "time:log",
  ],
  viewer: [
    "dashboard:read",
    "project:read",
    "task:read",
    "bom:read", "bom:export",
    "spec:read",
    "eco:read",
    "ecr:read",
    "plm:read",
    "org:read",
    "kb:read",
    "time:read",
  ],
};

// ---- zod schema ----
export const taskStatusSchema = z.enum(TASK_STATUSES);
export const prioritySchema = z.enum(PRIORITIES);
export const bomStatusSchema = z.enum(BOM_STATUSES);
export const changeTypeSchema = z.enum(CHANGE_TYPES);
export const compareRuleSchema = z.enum(COMPARE_RULES);
export const lifecycleStageSchema = z.enum(LIFECYCLE_STAGES);
