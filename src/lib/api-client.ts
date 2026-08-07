// 前端 fetch 封装
export async function api<T = unknown>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = `请求失败 (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const get = <T = unknown>(url: string) => api<T>(url);
export const post = <T = unknown>(url: string, data?: unknown) =>
  api<T>(url, { method: "POST", body: JSON.stringify(data ?? {}) });
export const patch = <T = unknown>(url: string, data?: unknown) =>
  api<T>(url, { method: "PATCH", body: JSON.stringify(data ?? {}) });
export const del = <T = unknown>(url: string, data?: unknown) =>
  api<T>(url, { method: "DELETE", body: data ? JSON.stringify(data) : undefined });
