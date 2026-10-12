import { reportNetworkFailure, reportNetworkSuccess } from "../native/connectivity";
import { isNative } from "../native/platform";
import { clearPersistedQueryCache } from "../native/queryPersistence";
import { clearToken, getChallenge, getToken } from "../native/session";

// Nella build nativa VITE_API_BASE_URL è un URL assoluto; nella PWA resta /api (stesso origin).
function basePath(): string {
  return import.meta.env.VITE_API_BASE_URL || "/api";
}

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

// Errore di rete: fetch non ha ricevuto nessuna risposta. Non è un ApiError.
export class NetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "NetworkError";
  }
}

// Nativo: un rifiuto di fetch è un errore di rete; ogni risposta, qualunque sia lo status, dice che la rete c'è.
async function fetchNative(url: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    reportNetworkFailure();
    throw new NetworkError("network", { cause: error });
  }
  reportNetworkSuccess();
  return response;
}

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers, ...rest } = options;

  const native = isNative();
  const token = getToken();
  const challenge = getChallenge();
  const nativeHeaders: Record<string, string> = native
    ? {
        "X-YFP-Client": "native",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(challenge && path.startsWith("/auth/") ? { "X-YFP-Challenge": challenge } : {}),
      }
    : {};

  const init: RequestInit = {
    ...rest,
    credentials: native ? "omit" : "include",
    headers: {
      "X-Requested-With": "yfp",
      ...nativeHeaders,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };

  const response = native
    ? await fetchNative(`${basePath()}${path}`, init)
    : await fetch(`${basePath()}${path}`, init);

  if (!response.ok) {
    let parsedBody: unknown = null;
    try {
      parsedBody = await response.json();
    } catch {
      // Response had no JSON body; leave parsedBody as null.
    }
    if (
      native &&
      response.status === 401 &&
      (parsedBody as { detail?: unknown } | null)?.detail === "unauthorized" &&
      getToken() === token
    ) {
      // Token scaduto o revocato. Un errore di rimozione non deve nascondere il 401.
      // Se nel frattempo è arrivato un token nuovo, il 401 riguarda quello vecchio: non si tocca nulla.
      await clearToken().catch(() => undefined);
      await clearPersistedQueryCache().catch(() => undefined);
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


