"use client";

import type { DashboardPayload, DmThreadPayload, OrbitPayload, Session, WorkflowSnapshot } from "@/lib/types";

const SESSION_KEY = "autoweave-web-session";

export function resolveApiBaseUrl(
  configuredBaseUrl: string | undefined = process.env.NEXT_PUBLIC_API_BASE_URL,
  currentLocation: Pick<Location, "protocol" | "hostname"> | null = typeof window === "undefined" ? null : window.location,
) {
  const configured = configuredBaseUrl?.trim();
  if (configured) {
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
  return request("/api/orbits", { method: "POST", body: JSON.stringify(payload) }, token);
}

export async function fetchOrbit(token: string, orbitId: string) {
  return request<OrbitPayload>(`/api/orbits/${orbitId}`, {}, token);
}

export async function sendOrbitMessage(token: string, orbitId: string, body: string) {
  return request(`/api/orbits/${orbitId}/messages`, { method: "POST", body: JSON.stringify({ body }) }, token);
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

export async function sendDmMessage(token: string, orbitId: string, threadId: string, body: string) {
  return request(`/api/orbits/${orbitId}/dms/${threadId}/messages`, { method: "POST", body: JSON.stringify({ body }) }, token);
}

export async function createCodespace(token: string, orbitId: string, payload: Record<string, unknown>) {
  return request(`/api/orbits/${orbitId}/codespaces`, { method: "POST", body: JSON.stringify(payload) }, token);
}

export async function publishDemo(token: string, orbitId: string, payload: Record<string, unknown>) {
  return request(`/api/orbits/${orbitId}/demos`, { method: "POST", body: JSON.stringify(payload) }, token);
}

export async function updateNavigation(token: string, payload: Record<string, unknown>) {
  return request("/api/navigation", { method: "PUT", body: JSON.stringify(payload) }, token);
}

export async function inviteOrbitMember(token: string, orbitId: string, email: string) {
  return request(`/api/orbits/${orbitId}/invites`, { method: "POST", body: JSON.stringify({ email }) }, token);
}
