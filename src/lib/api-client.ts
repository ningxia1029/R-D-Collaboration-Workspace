// 前端 fetch 封装
export async function api<T = unknown>(url: string, options?: RequestInit): Promise<T> {
  const controller = options?.signal ? null : new AbortController();
  const timeout = controller ? window.setTimeout(() => controller.abort(), 20_000) : null;
  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      signal: options?.signal ?? controller?.signal,
      headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw new Error("请求超过 20 秒，请检查网络或服务器连接");
    throw error;
  } finally {
    if (timeout !== null) window.clearTimeout(timeout);
  }
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
