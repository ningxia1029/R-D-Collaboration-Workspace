export type RuntimeReadinessIssue =
  | "DATABASE_URL_MISSING"
  | "AUTH_SECRET_WEAK"
  | "AUTH_SECRET_PLACEHOLDER"
  | "DEMO_MODE_ENABLED"
  | "AUTH_RATE_LIMIT_UNSAFE";

export type RuntimeReadiness = {
  ready: boolean;
  issues: RuntimeReadinessIssue[];
};

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

const MIN_AUTH_SECRET_LENGTH = 32;
const SECRET_PLACEHOLDER_PATTERN = /^(REPLACE_|CHANGE_ME|CHANGEME|TODO|EXAMPLE|YOUR_)/i;

/**
 * 检查部署所需的运行配置。结果只包含固定问题码，不包含任何环境变量值。
 */
export function inspectRuntimeReadiness(env: RuntimeEnvironment): RuntimeReadiness {
  const issues: RuntimeReadinessIssue[] = [];

  if (!env.DATABASE_URL?.trim()) issues.push("DATABASE_URL_MISSING");
  const authSecret = env.AUTH_SECRET?.trim() ?? "";
  if (authSecret.length < MIN_AUTH_SECRET_LENGTH) issues.push("AUTH_SECRET_WEAK");
  else if (SECRET_PLACEHOLDER_PATTERN.test(authSecret)) issues.push("AUTH_SECRET_PLACEHOLDER");
  if (env.NODE_ENV === "production" && env.NEXT_PUBLIC_DEMO_MODE === "true") {
    issues.push("DEMO_MODE_ENABLED");
  }
  if (env.NODE_ENV === "production") {
    const deploymentEnv = env.DEPLOYMENT_ENV ?? "production";
    const rateLimitMode = env.AUTH_RATE_LIMIT_MODE ?? "";
    const accepted = deploymentEnv === "uat"
      ? rateLimitMode === "isolated-uat"
      : rateLimitMode === "gateway";
    if (!accepted) issues.push("AUTH_RATE_LIMIT_UNSAFE");
  }

  return { ready: issues.length === 0, issues };
}
