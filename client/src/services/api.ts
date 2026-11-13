import type { LeaderboardEntry, User } from "../types/game";

const ACCESS_TOKEN_KEY = "pitch_duel_access_token";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function setAccessToken(token: string | null): void {
  if (token) localStorage.setItem(ACCESS_TOKEN_KEY, token);
  else localStorage.removeItem(ACCESS_TOKEN_KEY);
}

type ApiOptions = {
  method?: string;
  body?: unknown;
  auth?: boolean;
  /** Skip automatic refresh retry (used by refresh itself). */
  skipRefresh?: boolean;
};

async function parseError(res: Response): Promise<ApiError> {
  let message = res.statusText || "Request failed";
  try {
    const data = (await res.json()) as { message?: string };
    if (data.message) message = data.message;
  } catch {
    // ignore
  }
  return new ApiError(res.status, message);
}

let refreshInFlight: Promise<string | null> | null = null;

export async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const res = await fetch("/auth/refresh", {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      setAccessToken(null);
      return null;
    }
    const data = (await res.json()) as { accessToken: string };
    setAccessToken(data.accessToken);
    return data.accessToken;
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function request<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (options.auth) {
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(path, {
    method: options.method ?? (options.body ? "POST" : "GET"),
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    credentials: "include",
  });

  if (
    res.status === 401 &&
    options.auth &&
    !options.skipRefresh &&
    path !== "/auth/refresh"
  ) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return request<T>(path, { ...options, skipRefresh: true });
    }
  }

  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  register(input: {
    email: string;
    username: string;
    password: string;
  }): Promise<User> {
    return request<User>("/auth/register", { body: input });
  },

  async login(input: {
    email: string;
    password: string;
  }): Promise<{ accessToken: string; user: User }> {
    const data = await request<{ accessToken: string; user: User }>(
      "/auth/login",
      { body: input },
    );
    setAccessToken(data.accessToken);
    return data;
  },

  async logout(): Promise<void> {
    try {
      await request<void>("/auth/logout", { method: "POST" });
    } finally {
      setAccessToken(null);
    }
  },

  me(): Promise<User> {
    return request<User>("/auth/me", { auth: true });
  },

  async wsTicket(): Promise<string> {
    const data = await request<{ ticket: string }>("/auth/ws-ticket", {
      method: "POST",
      auth: true,
    });
    return data.ticket;
  },

  leaderboard(limit = 10): Promise<{ players: LeaderboardEntry[] }> {
    return request<{ players: LeaderboardEntry[] }>(
      `/leaderboard?limit=${limit}`,
    );
  },
};
