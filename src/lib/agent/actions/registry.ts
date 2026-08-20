export type ActionRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "FORBIDDEN";
export type ActionAvailability = "enabled" | "disabled" | "data_not_ready";

export const ACTION_DEFINITIONS = [
  {
    actionType: "TASK_UPDATE_LOW_RISK",
    label: "更新任务低风险字段",
    riskLevel: "LOW",
    status: "enabled",
    allowedFields: ["description", "priority", "dueDate", "estimatedHours"],
    reason: null,
  },
  {
    actionType: "WEEKLY_REPORT_DRAFT_SAVE",
    label: "保存周报草稿",
    riskLevel: "LOW",
    status: "data_not_ready",
    allowedFields: [],
    reason: "草稿存储与发布边界尚未完成验收",
  },
  {
    actionType: "TASK_DELETE",
    label: "删除任务",
    riskLevel: "HIGH",
    status: "disabled",
    allowedFields: [],
    reason: "删除动作不进入首批 Action Agent",
  },
  {
    actionType: "CHANGE_APPROVE",
    label: "审批 ECR/ECO",
    riskLevel: "HIGH",
    status: "disabled",
    allowedFields: [],
    reason: "审批必须在原业务审批页完成",
  },
  {
    actionType: "PRODUCT_RELEASE",
    label: "发布产品版本",
    riskLevel: "HIGH",
    status: "disabled",
    allowedFields: [],
    reason: "发布动作需要专项 ADR 与双人复核",
  },
  {
    actionType: "ECO_IMPLEMENT",
    label: "实施 ECO",
    riskLevel: "HIGH",
    status: "disabled",
    allowedFields: [],
    reason: "ECO 实施不进入首批 Action Agent",
  },
  {
    actionType: "BULK_IMPORT",
    label: "批量导入",
    riskLevel: "FORBIDDEN",
    status: "disabled",
    allowedFields: [],
    reason: "模型不得触发批量导入",
  },
] as const satisfies ReadonlyArray<{
  actionType: string;
  label: string;
  riskLevel: ActionRiskLevel;
  status: ActionAvailability;
  allowedFields: readonly string[];
  reason: string | null;
}>;

export type ActionType = (typeof ACTION_DEFINITIONS)[number]["actionType"];

export function actionDefinition(actionType: string) {
  return ACTION_DEFINITIONS.find((definition) => definition.actionType === actionType) ?? null;
}
