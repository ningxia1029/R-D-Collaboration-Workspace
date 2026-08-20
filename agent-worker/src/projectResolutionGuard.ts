export const PROJECT_RESOLVE_TOOL_NAME = "plm_project_resolve";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

/**
 * 项目解析是进入项目级 Tool 的确定性前置门禁。
 * 返回 undefined 表示已得到唯一候选；返回字符串表示必须停下并向用户澄清。
 */
export function clarificationForProjectResolution(output: unknown): string | undefined {
  const envelope = asRecord(output);
  const data = asRecord(envelope?.data);
  const resolution = data?.resolution;
  const candidates = Array.isArray(data?.candidates) ? data.candidates : undefined;

  if (resolution === "ambiguous" || (resolution === undefined && candidates && candidates.length > 1)) {
    return "找到多个可见项目。请提供准确项目编号，或明确选择其中一个项目。";
  }
  if (resolution === "not_found" || (resolution === undefined && candidates && candidates.length === 0)) {
    return "未找到唯一可见项目。请提供准确项目编号或完整项目名称。";
  }
  if (
    (resolution === "exact" || resolution === "single_candidate" || resolution === undefined) &&
    candidates?.length === 1
  ) {
    return undefined;
  }
  return "项目解析未返回可安全使用的唯一候选。请提供准确项目编号或完整项目名称。";
}
