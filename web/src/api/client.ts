const BASE_PATH = "/api";

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers, ...rest } = options;

  const init: RequestInit = {
    ...rest,
    credentials: "include",
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };

  const response = await fetch(`${BASE_PATH}${path}`, init);

  if (!response.ok) {
    let parsedBody: unknown = null;
    try {
      parsedBody = await response.json();
    } catch {
      // Response had no JSON body; leave parsedBody as null.
    }
    const message =
      (parsedBody && typeof parsedBody === "object" && "detail" in parsedBody
        ? String((parsedBody as { detail: unknown }).detail)
        : undefined) ?? `Request failed with status ${response.status}`;
    throw new ApiError(response.status, message, parsedBody);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export interface LoginResponse {
  status: string;
}

export const client = {
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "POST", body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "PUT", body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "PATCH", body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "DELETE" }),
};

export function login(key: string): Promise<LoginResponse> {
  return client.post<LoginResponse>("/auth/login", { key });
}

/**
 * Probes a protected endpoint (`GET /api/goals`) to determine whether the
 * current session cookie is valid. Resolves true if authenticated, false on
 * a 401. `GET /api/goals` can legitimately 404 (no goal set yet) for an
 * authenticated user, so any non-401 HTTP response (including 404) counts
 * as "authenticated". Non-HTTP failures (network errors, etc.) are
 * rethrown so callers can distinguish "not logged in" from "something is
 * actually broken".
 */
export async function checkAuth(): Promise<boolean> {
  try {
    await client.get("/goals");
    return true;
  } catch (err) {
    if (err instanceof ApiError) {
      return err.status !== 401;
    }
    throw err;
  }
}
