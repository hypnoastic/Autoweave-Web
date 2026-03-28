"use client";

import { ArrowRight, Github, Workflow } from "lucide-react";
import { FormEvent, useState } from "react";

import { getGitHubLoginUrl, loginWithToken, writeSession } from "@/lib/api";
import { ActionButton, GhostButton, Panel, SectionTitle } from "@/components/ui";

export function LandingPage() {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleGitHubLogin() {
    setLoading(true);
    setError(null);
    try {
      const payload = await getGitHubLoginUrl();
      if (!payload.url) {
        setError("GitHub OAuth is not configured yet. Use a GitHub token below for local development.");
        return;
      }
      window.location.href = payload.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start GitHub login.");
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
    <main className="min-h-screen bg-canvas text-ink">
      <section className="mx-auto flex min-h-screen max-w-7xl flex-col justify-between px-6 py-6 lg:px-12">
        <header className="flex items-center justify-between border-b border-black/8 pb-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-ink bg-ink text-sm font-semibold text-white">
              AW
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-quiet">AutoWeave</p>
              <p className="text-sm font-medium">ERGO-powered collaborative engineering</p>
            </div>
          </div>
          <GhostButton onClick={handleGitHubLogin} disabled={loading}>
            <Github className="mr-2 h-4 w-4" />
            Continue with GitHub
          </GhostButton>
        </header>

        <div className="grid gap-8 py-12 lg:grid-cols-[1.5fr_0.95fr] lg:items-end">
          <div className="space-y-8">
            <SectionTitle
              eyebrow="Version One"
              title="The local-first orbit where chat stays calm and the real work stays visible."
              detail="AutoWeave Web pairs a sharp product surface with the AutoWeave runtime under it. ERGO handles the brief, workflows stay in the board, and every orbit maps cleanly to a repository, workspace, and live demo."
            />
            <div className="grid gap-4 md:grid-cols-3">
              {[
                ["Clean chat", "ERGO only returns to chat for human-facing replies, reviews, or approvals."],
                ["Visible workflows", "Kanban execution with right-side detail instead of noisy agent spam."],
                ["Local demos", "Codespaces and demo containers run locally through Docker volumes and service links."],
              ].map(([title, body]) => (
                <Panel key={title} className="p-5">
                  <p className="text-sm font-semibold text-ink">{title}</p>
                  <p className="mt-2 text-sm leading-6 text-quiet">{body}</p>
                </Panel>
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              <ActionButton onClick={handleGitHubLogin} disabled={loading}>
                Open the product
                <ArrowRight className="ml-2 h-4 w-4" />
              </ActionButton>
              <GhostButton>
                <Workflow className="mr-2 h-4 w-4" />
                Built around the installed AutoWeave package
              </GhostButton>
            </div>
          </div>

          <Panel className="overflow-hidden">
            <div className="border-b border-line px-6 py-5">
              <p className="text-xs uppercase tracking-[0.24em] text-quiet">Local Access</p>
              <h3 className="mt-2 text-lg font-semibold tracking-[-0.03em]">GitHub sign-in</h3>
              <p className="mt-2 text-sm leading-6 text-quiet">
                Use OAuth when configured. For local development you can paste a GitHub token and the backend will create a session against the live GitHub API.
              </p>
            </div>
            <form className="space-y-4 p-6" onSubmit={handleTokenLogin}>
              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.24em] text-quiet">GitHub token</span>
                <input
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="ghp_..."
                  className="w-full rounded-2xl border border-line bg-[#fbfbfa] px-4 py-3 text-sm outline-none transition focus:border-ink"
                />
              </label>
              <ActionButton className="w-full" type="submit" disabled={loading || !token.trim()}>
                Start with GitHub
              </ActionButton>
              {error ? <p className="rounded-2xl border border-[#1e1e1e]/12 bg-[#f3f1ec] px-4 py-3 text-sm text-[#1e1e1e]">{error}</p> : null}
            </form>
          </Panel>
        </div>
      </section>
    </main>
  );
}
