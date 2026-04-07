"use client";

import Link from "next/link";
import { ArrowRight, Github, GitBranchPlus, Layers3, Workflow } from "lucide-react";
import { useState } from "react";

import { getGitHubLoginUrl } from "@/lib/api";
import { ActionButton, GhostButton, Panel } from "@/components/ui";

export function LandingPage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleGitHubLogin() {
    setLoading(true);
    setError(null);
    try {
      const payload = await getGitHubLoginUrl();
      if (!payload.url) {
        window.location.href = "/login";
        return;
      }
      window.location.href = payload.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start GitHub sign-in.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <section className="mx-auto flex min-h-screen max-w-7xl flex-col px-6 py-6 lg:px-10">
        <header className="flex items-center justify-between border-b border-line pb-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-[14px] border border-accent bg-accent text-sm font-semibold text-accentContrast">
              AW
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.26em] text-quiet">AutoWeave</p>
              <p className="text-sm font-medium text-ink">Collaborative engineering with calmer runtime surfaces</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/login" className="inline-flex h-9 items-center justify-center rounded-chip border border-line bg-panel px-3 text-sm font-medium text-ink transition-[background-color,border-color,color] duration-200 ease-productive hover:border-lineStrong hover:bg-panelMuted">
              Log in
            </Link>
            <Link href="/signup" className="inline-flex h-9 items-center justify-center rounded-chip border border-accent bg-accent px-3 text-sm font-medium text-accentContrast transition-opacity duration-200 ease-productive hover:opacity-90">
              Sign up
            </Link>
          </div>
        </header>

        <div className="grid flex-1 gap-10 py-10 lg:grid-cols-[1.15fr_0.95fr] lg:items-center">
          <section className="space-y-8">
            <div className="space-y-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-quiet">Product intro</p>
              <h1 className="max-w-[13ch] text-5xl font-semibold tracking-[-0.06em] text-ink">
                Engineering collaboration with chat that stays calm.
              </h1>
              <p className="max-w-[62ch] text-base leading-7 text-quiet">
                AutoWeave keeps human conversation, workflow execution, repositories, workspaces, and artifacts inside one stable product shell.
                ERGO can coordinate work without turning the timeline into a noisy stream of runtime internals.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {[
                {
                  icon: Workflow,
                  title: "Workflow stays visible",
                  body: "Execution detail belongs in board surfaces, not as constant agent chatter inside chat.",
                },
                {
                  icon: GitBranchPlus,
                  title: "Repo and workspace aware",
                  body: "Orbits stay grounded in GitHub repositories, workspaces, and publishable artifacts.",
                },
                {
                  icon: Layers3,
                  title: "Stable product shell",
                  body: "A persistent top bar and sidebar frame the work instead of resetting context on every transition.",
                },
              ].map((item) => (
                <Panel key={item.title} className="p-4">
                  <item.icon className="h-4 w-4 text-quiet" />
                  <p className="mt-3 text-sm font-semibold text-ink">{item.title}</p>
                  <p className="mt-2 text-sm leading-6 text-quiet">{item.body}</p>
                </Panel>
              ))}
            </div>

            <div className="flex flex-wrap gap-3">
              <ActionButton className="h-11 px-4" onClick={handleGitHubLogin} disabled={loading}>
                <Github className="h-4 w-4" />
                Continue with GitHub
                <ArrowRight className="h-4 w-4" />
              </ActionButton>
              <Link
                href="/signup"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-chip border border-line bg-panel px-4 text-sm font-medium text-ink transition-[transform,background-color,border-color,color,box-shadow] duration-200 ease-productive hover:border-lineStrong hover:bg-panelMuted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focusRing focus-visible:ring-offset-0 active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none"
              >
                Create an orbit
              </Link>
            </div>
            {error ? <div className="rounded-[16px] border border-stateDanger/20 bg-stateDanger/10 px-4 py-3 text-sm text-stateDanger">{error}</div> : null}
          </section>

          <Panel className="overflow-hidden border-lineStrong bg-panelStrong">
            <div className="border-b border-line px-5 py-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-quiet">Inside the product</p>
              <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-ink">One shell. Cleaner work surfaces.</p>
            </div>
            <div className="grid gap-4 px-5 py-5">
              <div className="rounded-[20px] bg-shell p-3">
                <div className="grid gap-3 lg:grid-cols-[72px_minmax(0,1fr)]">
                  <div className="rounded-[16px] bg-shellElevated p-2">
                    <div className="space-y-2">
                      {["", "", "", "", "", ""].map((_, index) => (
                        <div key={index} className={`h-8 rounded-[10px] ${index === 1 ? "bg-shellMuted" : "bg-[rgba(255,255,255,0.06)]"}`} />
                      ))}
                    </div>
                  </div>
                  <div className="rounded-[16px] bg-shellElevated p-3">
                    <div className="h-10 rounded-[12px] bg-[rgba(255,255,255,0.06)]" />
                    <div className="mt-3 grid gap-3 xl:grid-cols-[240px_minmax(0,1fr)]">
                      <div className="rounded-[14px] bg-[rgba(255,255,255,0.04)] p-3">
                        <div className="h-3 w-16 rounded-full bg-[rgba(255,255,255,0.12)]" />
                        <div className="mt-3 h-9 rounded-[10px] bg-[rgba(255,255,255,0.08)]" />
                        <div className="mt-2 h-9 rounded-[10px] bg-[rgba(255,255,255,0.08)]" />
                        <div className="mt-2 h-9 rounded-[10px] bg-[rgba(255,255,255,0.08)]" />
                      </div>
                      <div className="rounded-[14px] bg-[rgba(255,255,255,0.04)] p-3">
                        <div className="h-3 w-20 rounded-full bg-[rgba(255,255,255,0.12)]" />
                        <div className="mt-3 space-y-2">
                          <div className="h-14 rounded-[12px] bg-[rgba(255,255,255,0.08)]" />
                          <div className="h-14 rounded-[12px] bg-[rgba(255,255,255,0.08)]" />
                          <div className="h-20 rounded-[14px] bg-[rgba(255,255,255,0.08)]" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Panel className="p-4">
                  <p className="text-sm font-semibold text-ink">GitHub-first access</p>
                  <p className="mt-2 text-sm leading-6 text-quiet">Use GitHub for identity and repository binding while keeping local development flow practical.</p>
                </Panel>
                <Panel className="p-4">
                  <p className="text-sm font-semibold text-ink">Matrix-backed chat</p>
                  <p className="mt-2 text-sm leading-6 text-quiet">Use Matrix underneath the product while keeping AutoWeave’s own conversation model and UI in charge.</p>
                </Panel>
              </div>
            </div>
          </Panel>
        </div>
      </section>
    </main>
  );
}
