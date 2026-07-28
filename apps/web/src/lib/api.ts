export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    }
  });

  const payload = await response.json().catch(() => ({ ok: false, message: "Invalid server response." }));
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.message || `Request failed with status ${response.status}.`);
  }
  return payload as T;
}
