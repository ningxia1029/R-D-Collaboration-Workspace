export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

/** 纯密码强度策略：不读取环境、数据库或用户信息。 */
export function validatePassword(password: string): PasswordValidationResult {
  const errors: string[] = [];
  if (password.length < 12) errors.push("密码至少需要 12 位");
  if (password.length > 128) errors.push("密码不能超过 128 位");
  if (!/[a-z]/.test(password)) errors.push("密码必须包含小写字母");
  if (!/[A-Z]/.test(password)) errors.push("密码必须包含大写字母");
  if (!/[0-9]/.test(password)) errors.push("密码必须包含数字");
  if (!/[^\p{L}\p{N}\s]/u.test(password)) errors.push("密码必须包含特殊字符");
  return { valid: errors.length === 0, errors };
}
