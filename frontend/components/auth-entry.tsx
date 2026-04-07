"use client";

import Link from "next/link";
import { ArrowRight, Github, GitBranchPlus, ShieldCheck, Workflow } from "lucide-react";
import { FormEvent, useMemo, useState, type ReactNode } from "react";

import { getGitHubLoginUrl, loginWithToken, writeSession } from "@/lib/api";
import { ActionButton, GhostButton, Panel } from "@/components/ui";

function AuthFrame({
  eyebrow,
  title,
  detail,
  children,
}: {
  eyebrow: string;
  title: string;
  detail: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-canvas text-ink">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-6 lg:px-10">
        <header className="flex items-center justify-between border-b border-line pb-5">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-[14px] border border-accent bg-accent text-sm font-semibold text-accentContrast">
              AW
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.26em] text-quiet">AutoWeave</p>
              <p className="text-sm font-medium text-ink">Engineering collaboration with a calmer runtime surface</p>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/login" className="inline-flex h-9 items-center justify-center rounded-chip border border-line bg-panel px-3 text-sm font-medium text-ink transition-[background-color,border-color,color] duration-200 ease-productive hover:border-lineStrong hover:bg-panelMuted">
              Log in
            </Link>
            <Link href="/signup" className="inline-flex h-9 items-center justify-center rounded-chip border border-accent bg-accent px-3 text-sm font-medium text-accentContrast transition-opacity duration-200 ease-productive hover:opacity-90">
              Sign up
            </Link>
          </div>
        </header>

        <div className="grid flex-1 gap-8 py-10 lg:grid-cols-[1.1fr_420px] lg:items-center">
          <section className="space-y-7">
            <div className="space-y-3">
              <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-quiet">{eyebrow}</p>
              <h1 className="max-w-[14ch] text-4xl font-semibold tracking-[-0.05em] text-ink sm:text-5xl">{title}</h1>
              <p className="max-w-[58ch] text-base leading-7 text-quiet">{detail}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {[
                {
                  icon: Workflow,
                  title: "Workflow stays visible",
                  body: "Execution detail lives in the board instead of spilling into every conversation.",
                },
                {
                  icon: ShieldCheck,
                  title: "GitHub-native identity",
                  body: "Use GitHub as the trust boundary for access, repo binding, and reviews.",
                },
                {
                  icon: GitBranchPlus,
                  title: "Workspace-aware delivery",
                  body: "Repos, workspaces, and artifacts stay attached to the same orbit context.",
                },
              ].map((item) => (
                <Panel key={item.title} className="p-4">
                  <item.icon className="h-4 w-4 text-quiet" />
                  <p className="mt-3 text-sm font-semibold text-ink">{item.title}</p>
                  <p className="mt-2 text-sm leading-6 text-quiet">{item.body}</p>
                </Panel>
              ))}
            </div>

            <Panel className="overflow-hidden border-lineStrong bg-panelStrong">
              <div className="border-b border-line px-5 py-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-quiet">Product shape</p>
                <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-ink">A stable shell with cleaner inner work surfaces</p>
              </div>
              <div className="grid gap-3 px-5 py-5 sm:grid-cols-[190px_minmax(0,1fr)]">
                <div className="rounded-[18px] bg-shell p-3">
                  <div className="space-y-2">
                    {["Dashboard", "Chat", "Workflow", "PRs", "Issues", "Codespaces", "Artifacts"].map((label, index) => (
                      <div
                        key={label}
                        className={`rounded-[10px] px-3 py-2 text-sm ${index === 1 ? "bg-shellMuted text-white" : "text-[#b8bcc3]"}`}
                      >
                        {label}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-[18px] border border-line bg-panel p-4">
                  <div className="flex items-center justify-between border-b border-line pb-3">
                    <p className="text-sm font-semibold text-ink">Orbit overview</p>
                    <span className="rounded-full border border-line bg-panelStrong px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] text-quiet">
                      Stable shell
                    </span>
                  </div>
                  <div className="mt-4 grid gap-3 lg:grid-cols-2">
                    <div className="rounded-[14px] border border-line bg-panelStrong p-3">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-quiet">Chat</p>
                      <p className="mt-2 text-sm text-ink">Human-facing messages, approvals, and direct responses.</p>
                    </div>
                    <div className="rounded-[14px] border border-line bg-panelStrong p-3">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-quiet">Workflow</p>
                      <p className="mt-2 text-sm text-ink">Low-noise execution lanes with compact detail and review context.</p>
                    </div>
                    <div className="rounded-[14px] border border-line bg-panelStrong p-3 lg:col-span-2">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-quiet">Workspace + artifacts</p>
                      <p className="mt-2 text-sm text-ink">Codespaces and artifact previews stay tied to repo context instead of jumping into disconnected tabs.</p>
                    </div>
                  </div>
                </div>
              </div>
            </Panel>
          </section>

          <div>{children}</div>
        </div>
      </div>
    </main>
  );
}

export function AuthEntryScreen({
  mode,
}: {
  mode: "login" | "signup";
}) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const copy = useMemo(
    () =>
      mode === "signup"
        ? {
            eyebrow: "Create your workspace",
            title: "Start an AutoWeave orbit with GitHub.",
            detail: "Use GitHub to create your identity, connect repositories, and keep the product/runtime boundary clean from the first session.",
            panelTitle: "Create account",
            panelDetail: "GitHub is the primary sign-up path. Local token access remains available only for development.",
            cta: "Continue with GitHub",
          }
        : {
            eyebrow: "Welcome back",
            title: "Log in to the same orbit shell you left.",
            detail: "Jump back into chat, workflow, workspaces, and artifacts without a noisy dashboard layer in front of the work.",
            panelTitle: "Log in",
            panelDetail: "GitHub stays first. Local token access remains a fallback for local development only.",
            cta: "Log in with GitHub",
          },
    [mode],
  );

  async function handleGitHubLogin() {
    setLoading(true);
    setError(null);
    try {
      const payload = await getGitHubLoginUrl();
      if (!payload.url) {
        setError("GitHub OAuth is not configured yet. Use the local development token fallback below.");
        return;
      }
      window.location.href = payload.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start GitHub sign-in.");
    } finally {
      setLoading(false);
    }
  }

  async function handleTokenLogin(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const session = await loginWithToken(token);
      writeSession(session);
      window.location.href = "/app";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create a GitHub session.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthFrame eyebrow={copy.eyebrow} title={copy.title} detail={copy.detail}>
      <Panel className="overflow-hidden border-lineStrong bg-panelStrong">
        <div className="border-b border-line px-6 py-5">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-quiet">GitHub-first access</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-ink">{copy.panelTitle}</h2>
          <p className="mt-2 text-sm leading-6 text-quiet">{copy.panelDetail}</p>
        </div>
        <div className="space-y-4 px-6 py-6">
          <ActionButton className="h-11 w-full justify-between px-4" onClick={handleGitHubLogin} disabled={loading}>
            <span className="inline-flex items-center gap-2">
              <Github className="h-4 w-4" />
              {copy.cta}
            </span>
            <ArrowRight className="h-4 w-4" />
          </ActionButton>

          <div className="rounded-[16px] border border-line bg-panel px-4 py-4">
            <p className="text-sm font-medium text-ink">GitHub app access</p>
            <p className="mt-2 text-sm leading-6 text-quiet">
              The product uses GitHub as the identity and repository layer. Once OAuth is configured, this route hands you directly into the connected product shell.
            </p>
          </div>

          <details className="rounded-[16px] border border-line bg-panel px-4 py-4">
            <summary className="cursor-pointer list-none text-sm font-medium text-ink">Local development token fallback</summary>
            <p className="mt-2 text-sm leading-6 text-quiet">
              Use this only when running locally and GitHub OAuth is not configured yet. The backend will validate the token against GitHub and create the same product session locally.
            </p>
            <form className="mt-4 space-y-3" onSubmit={handleTokenLogin}>
              <label className="block">
                <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.18em] text-quiet">GitHub token</span>
                <input
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="ghp_..."
                  className="w-full rounded-[14px] border border-line bg-panelStrong px-4 py-3 text-sm text-ink outline-none transition focus:border-lineStrong focus:ring-2 focus:ring-focusRing"
                />
              </label>
              <GhostButton className="h-10 w-full" type="submit" disabled={loading || !token.trim()}>
                Start local session
              </GhostButton>
            </form>
          </details>

          {error ? <div className="rounded-[16px] border border-stateDanger/20 bg-stateDanger/10 px-4 py-3 text-sm text-stateDanger">{error}</div> : null}
        </div>
      </Panel>
    </AuthFrame>
  );
}

export function AuthCallbackScreen({
  status,
  message,
}: {
  status: "loading" | "success" | "error";
  message: string;
}) {
  return (
    <AuthFrame
      eyebrow="GitHub connection"
      title={status === "success" ? "Session ready." : status === "error" ? "GitHub sign-in needs attention." : "Completing GitHub sign-in."}
      detail="The callback flow should feel like part of the product, not a detached status page."
    >
      <Panel className="overflow-hidden border-lineStrong bg-panelStrong">
        <div className="space-y-4 px-6 py-6">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-[14px] border border-line bg-panel">
            <Github className="h-5 w-5 text-ink" />
          </div>
          <div>
            <p className="text-sm font-semibold text-ink">{message}</p>
            <p className="mt-2 text-sm leading-6 text-quiet">
              {status === "loading"
                ? "We are exchanging the GitHub code for a local AutoWeave session."
                : status === "success"
                  ? "You will land in the authenticated shell automatically."
                  : "Retry GitHub sign-in or use the local token fallback if you are working in a local development environment."}
            </p>
          </div>
          {status === "error" ? (
            <div className="flex items-center gap-3">
              <ActionButton className="h-10 px-4" onClick={() => (window.location.href = "/login")}>
                Return to login
              </ActionButton>
              <GhostButton className="h-10 px-4" onClick={() => (window.location.href = "/signup")}>
                Go to sign up
              </GhostButton>
            </div>
          ) : null}
        </div>
      </Panel>
    </AuthFrame>
  );
}
