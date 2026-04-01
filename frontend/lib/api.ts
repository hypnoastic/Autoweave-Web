"use client";

import type {
  AvailableRepository,
  ChannelSummary,
  CodespaceSummary,
  ConversationMessage,
  ConversationSendResult,
  DashboardPayload,
  DemoSummary,
  DmThreadPayload,
  DmThreadSummary,
  HumanLoopItem,
  Orbit,
  OrbitPayload,
  OrbitSearchResult,
  Session,
  UserPreferences,
  WorkflowSnapshot,
} from "@/lib/types";

const SESSION_KEY = "autoweave-web-session";

export class AuthSessionError extends Error {
  constructor(message = "Invalid session token") {
    super(message);
    this.name = "AuthSessionError";
  }
}

export function resolveApiBaseUrl(
  configuredBaseUrl: string | undefined = process.env.NEXT_PUBLIC_API_BASE_URL,
  currentLocation: Pick<Location, "protocol" | "hostname"> | null = typeof window === "undefined" ? null : window.location,
) {
  const configured = configuredBaseUrl?.trim();
  if (configured) {
    const currentHostname = currentLocation?.hostname?.trim().toLowerCase();
    try {
      const parsed = new URL(configured);
      const configuredHostname = parsed.hostname.trim().toLowerCase();
      const loopbackHosts = new Set(["localhost", "127.0.0.1"]);
      if (
        currentHostname &&
        configuredHostname !== currentHostname &&
        loopbackHosts.has(configuredHostname) &&
        loopbackHosts.has(currentHostname)
      ) {
        parsed.hostname = currentHostname;
        parsed.protocol = currentLocation?.protocol ?? parsed.protocol;
        return parsed.toString().replace(/\/$/, "");
      }
    } catch {
      return configured;
    }
    return configured;
  }
  const protocol = currentLocation?.protocol ?? "http:";
  const hostname = currentLocation?.hostname ?? "localhost";
  return `${protocol}//${hostname}:8000`;
}

export function readSession(): Session | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(SESSION_KEY);
  return raw ? (JSON.parse(raw) as Session) : null;
}

export function writeSession(session: Session | null) {
  if (typeof window === "undefined") {
    return;
  }
  if (!session) {
    window.localStorage.removeItem(SESSION_KEY);
    return;
  }
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(`${resolveApiBaseUrl()}${path}`, { ...options, headers, cache: "no-store" });
  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 401) {
      writeSession(null);
      throw new AuthSessionError(errorText || "Invalid session token");
    }
    throw new Error(errorText || `Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function getGitHubLoginUrl() {
  return request<{ configured: boolean; url: string | null; state?: string }>("/api/auth/github/url");
}

export async function loginWithToken(token: string) {
  return request<Session>("/api/auth/github-token", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export async function exchangeGitHubCode(code: string) {
  return request<Session>(`/api/auth/github/exchange?code=${encodeURIComponent(code)}`, { method: "POST" });
}

export async function fetchDashboard(token: string) {
  return request<DashboardPayload>("/api/dashboard", {}, token);
}

export async function fetchOrbits(token: string) {
  return request<Array<DashboardPayload["recent_orbits"][number]>>("/api/orbits", {}, token);
}

export async function createOrbit(token: string, payload: Record<string, unknown>) {
  return request<Orbit>("/api/orbits", { method: "POST", body: JSON.stringify(payload) }, token);
}

export async function fetchOrbit(token: string, orbitId: string) {
  return request<OrbitPayload>(`/api/orbits/${orbitId}`, {}, token);
}

export async function fetchAvailableRepositories(token: string, orbitId: string) {
  return request<AvailableRepository[]>(`/api/orbits/${orbitId}/available-repositories`, {}, token);
}

export async function fetchOrbitSearch(token: string, orbitId: string, query: string, limit = 16) {
  return request<OrbitSearchResult[]>(
    `/api/orbits/${orbitId}/search?q=${encodeURIComponent(query)}&limit=${encodeURIComponent(String(limit))}`,
    {},
    token,
  );
}

export async function connectOrbitRepository(token: string, orbitId: string, payload: { repo_full_name: string; make_primary?: boolean }) {
  return request(`/api/orbits/${orbitId}/repositories`, { method: "POST", body: JSON.stringify(payload) }, token);
}

export async function setPrimaryOrbitRepository(token: string, orbitId: string, repositoryId: string) {
  return request(`/api/orbits/${orbitId}/repositories/${repositoryId}/primary`, { method: "POST" }, token);
}

export async function fetchChannelMessages(token: string, orbitId: string, channelId: string) {
  return request<{ channel: ChannelSummary; messages: ConversationMessage[]; human_loop_items: HumanLoopItem[] }>(
    `/api/orbits/${orbitId}/channels/${channelId}/messages`,
    {},
    token,
  );
}

export async function createChannel(token: string, orbitId: string, payload: Record<string, unknown>) {
  return request<ChannelSummary>(`/api/orbits/${orbitId}/channels`, { method: "POST", body: JSON.stringify(payload) }, token);
}

export async function sendChannelMessage(token: string, orbitId: string, channelId: string, body: string) {
  return request<ConversationSendResult>(`/api/orbits/${orbitId}/channels/${channelId}/messages`, { method: "POST", body: JSON.stringify({ body }) }, token);
}

export async function sendOrbitMessage(token: string, orbitId: string, body: string) {
  return request<ConversationSendResult>(`/api/orbits/${orbitId}/messages`, { method: "POST", body: JSON.stringify({ body }) }, token);
}

export async function refreshPrsIssues(token: string, orbitId: string) {
  return request(`/api/orbits/${orbitId}/prs-issues/refresh`, { method: "POST" }, token);
}

export async function fetchWorkflow(token: string, orbitId: string) {
  return request<WorkflowSnapshot>(`/api/orbits/${orbitId}/workflow`, {}, token);
}

export async function answerWorkflowHumanRequest(
  token: string,
  orbitId: string,
  payload: Record<string, unknown>,
) {
  return request(`/api/orbits/${orbitId}/workflow/human-requests/answer`, { method: "POST", body: JSON.stringify(payload) }, token);
}

export async function resolveWorkflowApprovalRequest(
  token: string,
  orbitId: string,
  payload: Record<string, unknown>,
) {
  return request(`/api/orbits/${orbitId}/workflow/approval-requests/resolve`, { method: "POST", body: JSON.stringify(payload) }, token);
}

export async function fetchDmThread(token: string, orbitId: string, threadId: string) {
  return request<DmThreadPayload>(`/api/orbits/${orbitId}/dms/${threadId}`, {}, token);
}

export async function createDmThread(token: string, orbitId: string, payload: Record<string, unknown>) {
  return request<DmThreadSummary>(`/api/orbits/${orbitId}/dms`, { method: "POST", body: JSON.stringify(payload) }, token);
}

export async function sendDmMessage(token: string, orbitId: string, threadId: string, body: string) {
  return request<ConversationSendResult>(`/api/orbits/${orbitId}/dms/${threadId}/messages`, { method: "POST", body: JSON.stringify({ body }) }, token);
}

export async function createCodespace(token: string, orbitId: string, payload: Record<string, unknown>) {
  return request<CodespaceSummary>(`/api/orbits/${orbitId}/codespaces`, { method: "POST", body: JSON.stringify(payload) }, token);
}

export async function publishDemo(token: string, orbitId: string, payload: Record<string, unknown>) {
  return request<DemoSummary>(`/api/orbits/${orbitId}/demos`, { method: "POST", body: JSON.stringify(payload) }, token);
}

export async function updateNavigation(token: string, payload: Record<string, unknown>) {
  return request("/api/navigation", { method: "PUT", body: JSON.stringify(payload) }, token);
}

export async function fetchPreferences(token: string) {
  return request<UserPreferences>("/api/preferences", {}, token);
}

export async function updatePreferences(token: string, payload: UserPreferences) {
  return request<UserPreferences>("/api/preferences", { method: "PUT", body: JSON.stringify(payload) }, token);
}

export async function inviteOrbitMember(token: string, orbitId: string, email: string) {
  return request(`/api/orbits/${orbitId}/invites`, { method: "POST", body: JSON.stringify({ email }) }, token);
}

export async function updateOrbitMemberRole(token: string, orbitId: string, memberUserId: string, role: string) {
  return request(`/api/orbits/${orbitId}/members/${memberUserId}/role`, { method: "PUT", body: JSON.stringify({ role }) }, token);
}
