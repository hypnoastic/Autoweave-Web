import Link from "next/link";
import {
  ArrowRight,
  Check,
  Clock3,
  ExternalLink,
  GitBranchPlus,
  Github,
  Layers3,
  Mail,
  ShieldCheck,
  Waypoints,
  Workflow,
} from "lucide-react";

import { Panel } from "@/components/ui";
import { WebcamPixelGrid } from "@/components/ui/webcam-pixel-grid";
import { publicConfig, toMailto } from "@/lib/public-config";

const navItems = [
  { href: "#hero", label: "Hero" },
  { href: "#proof", label: "Proof" },
  { href: "#features", label: "Features" },
  { href: "#pricing", label: "Pricing" },
  { href: "#contact", label: "Contact" },
];

const proofCards = [
  {
    icon: Workflow,
    title: "Workflow stays first-class",
    body: "Runs, approvals, retries, and environment posture remain visible instead of dissolving into a chat transcript.",
  },
  {
    icon: GitBranchPlus,
    title: "Repo-aware by design",
    body: "GitHub identity, repository scope, branch work, pull requests, and artifacts stay bound to the same operational surface.",
  },
  {
    icon: ShieldCheck,
    title: "Governed change management",
    body: "AutoWeave favors approvals, lineage, and blast-radius clarity over opaque automation theater.",
  },
];

const featureCards = [
  {
    icon: Layers3,
    title: "One shell for planning and runtime state",
    body: "Keep topology, chat, workflow, and artifact visibility in one persistent surface instead of bouncing across detached tools.",
  },
  {
    icon: Waypoints,
    title: "Topology-aware orchestration",
    body: "Workflows read like composed systems: repos, environments, agents, and approvals connected in visible lanes.",
  },
  {
    icon: Clock3,
    title: "Audit continuity",
    body: "Every status change, human checkpoint, and generated artifact can be traced through time without rebuilding context.",
  },
  {
    icon: ShieldCheck,
    title: "Environment-safe rollout",
    body: "Production trust comes from explicit readiness, guarded mutations, and approvals that are attached to the work item itself.",
  },
  {
    icon: Github,
    title: "GitHub-first access model",
    body: "Identity and repository binding begin with GitHub so access decisions stay close to the delivery system operators already trust.",
  },
  {
    icon: Workflow,
    title: "Dense, readable control surfaces",
    body: "Metrics, states, queues, and ownership stay compact and scannable for operators who need signal, not empty marketing space.",
  },
];

const pricingCards = [
  {
    title: "Pilot",
    eyebrow: "For evaluation",
    detail: "Best when you want to validate orchestration fit around one team, one workflow family, and controlled repo scope.",
    features: ["GitHub-first access setup", "Single workflow control-plane review", "Environment and approval model workshop"],
    cta: "Review pilot scope",
  },
  {
    title: "Control Plane",
    eyebrow: "For product teams",
    detail: "Best when multiple repos, artifacts, workspaces, and governed rollout paths need to live in one operational shell.",
    features: ["Multi-repo orchestration model", "Workflow, audit, and artifact visibility", "Shared operational surfaces for builders and reviewers"],
    cta: "Talk through rollout",
  },
  {
    title: "Enterprise",
    eyebrow: "For governed environments",
    detail: "Best when environment policy, audit continuity, and deployment safety need to be first-class from day one.",
    features: ["Approval and environment boundary design", "Operational adoption planning", "Custom delivery and governance mapping"],
    cta: "Contact sales",
  },
];

const contactCards = [
  {
    icon: Mail,
    title: "Contact",
    body: "Use email for early access, pilot planning, or enterprise rollout discussions.",
    href: toMailto(publicConfig.contactEmail),
    label: publicConfig.contactEmail,
  },
  {
    icon: Github,
    title: "GitHub",
    body: "Share repositories, implementation context, or integration details when you are ready to wire the product in.",
    href: publicConfig.githubUrl,
    label: "Open GitHub",
  },
  {
    icon: Layers3,
    title: "Docs",
    body: "Point operators to architecture notes, usage guidance, or setup instructions from the landing surface.",
    href: publicConfig.docsUrl,
    label: "View docs",
  },
];

const primaryLinkClassName =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-chip border border-landingVerdigris bg-landingVerdigris px-4 py-2.5 text-sm font-medium text-slate-950 transition-[transform,opacity,background-color,border-color,box-shadow] duration-200 ease-productive hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focusRing focus-visible:ring-offset-0 active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none";

const secondaryLinkClassName =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-chip border border-shellLineStrong bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-landingGridLight transition-[transform,background-color,border-color,box-shadow] duration-200 ease-productive hover:border-landingGlassLine hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focusRing focus-visible:ring-offset-0 active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none";

function ExternalAnchor({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  const external = /^https?:\/\//.test(href) || href.startsWith("mailto:");

  return (
    <a
      href={href}
      className={className}
      target={external && !href.startsWith("mailto:") ? "_blank" : undefined}
      rel={external && !href.startsWith("mailto:") ? "noreferrer" : undefined}
    >
      {children}
    </a>
  );
}

export function LandingPage() {
  return (
    <main className="h-dvh overflow-y-auto scroll-smooth bg-landingShell text-landingGridLight">
      <div className="relative isolate min-h-full overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[32rem] bg-landingHeroGlow blur-3xl" />
        <div className="pointer-events-none absolute left-[-10rem] top-[22rem] h-[24rem] w-[24rem] rounded-full bg-landingVerdigrisSoft blur-3xl" />

        <header className="sticky top-0 z-40 px-4 pt-4 sm:px-6 lg:px-10">
          <div className="mx-auto max-w-7xl rounded-full border border-landingGlassLine bg-landingGlass shadow-soft backdrop-blur-xl">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
              <a href="#hero" className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-[14px] border border-landingVerdigris bg-landingVerdigris text-sm font-semibold text-slate-950">
                  AW
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.26em] text-slate-600 dark:text-landingGridFaint">AutoWeave</p>
                  <p className="text-sm font-medium text-slate-900 dark:text-landingGridLight">Orchestration control plane</p>
                </div>
              </a>

              <nav className="hidden items-center gap-5 lg:flex">
                {navItems.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    className="text-sm font-medium text-slate-700 transition-colors duration-200 hover:text-slate-950 dark:text-landingGridQuiet dark:hover:text-landingGridLight"
                  >
                    {item.label}
                  </a>
                ))}
              </nav>

              <div className="flex items-center gap-2">
                <Link
                  href="/login"
                  className="inline-flex h-10 items-center justify-center rounded-chip border border-landingGlassLine bg-white/[0.5] px-3.5 text-sm font-medium text-slate-900 transition-[background-color,border-color,color] duration-200 ease-productive hover:bg-white/[0.72] dark:border-shellLineStrong dark:bg-white/[0.05] dark:text-landingGridLight dark:hover:bg-white/[0.08]"
                >
                  Login
                </Link>
                <Link href="/signup" className="inline-flex h-10 items-center justify-center rounded-chip border border-landingVerdigris bg-landingVerdigris px-3.5 text-sm font-medium text-slate-950 transition-opacity duration-200 ease-productive hover:opacity-90">
                  Sign up
                </Link>
              </div>
            </div>
          </div>
        </header>

        <section id="hero" className="scroll-mt-28 px-4 pb-20 pt-12 sm:px-6 lg:px-10">
          <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div className="space-y-8">
              <div className="space-y-5">
                <p className="text-[11px] font-medium uppercase tracking-[0.26em] text-landingGridFaint">
                  Production orchestration for intelligent workflows
                </p>
                <h1 className="max-w-[12ch] text-5xl font-semibold tracking-[-0.07em] text-landingGridLight sm:text-6xl">
                  Operate software delivery with a real control plane.
                </h1>
                <p className="max-w-[64ch] text-base leading-7 text-landingGridQuiet sm:text-lg">
                  AutoWeave keeps repositories, environments, approvals, workflow state, and generated artifacts inside one governed shell so
                  teams can ship faster without surrendering auditability.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Link href="/signup" className={primaryLinkClassName}>
                  Create your orbit
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link href="/login" className={secondaryLinkClassName}>
                  Review GitHub access
                </Link>
                <ExternalAnchor href={publicConfig.docsUrl} className={secondaryLinkClassName}>
                  View docs
                  <ExternalLink className="h-4 w-4" />
                </ExternalAnchor>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {proofCards.map((item) => (
                  <Panel key={item.title} className="border-shellLine bg-landingShellMuted p-4 shadow-[0_18px_36px_rgba(0,0,0,0.18)]">
                    <item.icon className="h-4 w-4 text-landingVerdigris" />
                    <p className="mt-3 text-sm font-semibold text-landingGridLight">{item.title}</p>
                    <p className="mt-2 text-sm leading-6 text-landingGridQuiet">{item.body}</p>
                  </Panel>
                ))}
              </div>
            </div>

            <Panel className="relative overflow-hidden border-shellLineStrong bg-landingShellMuted shadow-[0_24px_60px_rgba(0,0,0,0.28)]">
              <div
                className="pointer-events-none absolute inset-0 opacity-95"
                style={{ background: "radial-gradient(circle at top right, var(--aw-landing-hero-glow), transparent 46%)" }}
              />
              <div className="absolute inset-0">
                <WebcamPixelGrid className="opacity-90" />
              </div>
              <div className="relative z-10 space-y-5 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-shellLine pb-4">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-landingGridFaint">Operational proof</p>
                    <p className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-landingGridLight">One shell. Explicit state.</p>
                  </div>
                  <span className="rounded-full border border-landingVerdigrisSoft bg-landingVerdigrisSoft px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-landingVerdigris">
                    Live posture
                  </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    { label: "Connected repos", value: "08" },
                    { label: "Approval gates", value: "04" },
                    { label: "Runtime health", value: "98.4%" },
                  ].map((item) => (
                    <div key={item.label} className="rounded-[18px] border border-shellLine bg-black/35 p-4 backdrop-blur-sm">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-landingGridFaint">{item.label}</p>
                      <p className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-landingGridLight">{item.value}</p>
                    </div>
                  ))}
                </div>

                <div className="grid gap-3 lg:grid-cols-[88px_minmax(0,1fr)]">
                  <div className="rounded-[18px] border border-shellLine bg-black/35 p-3 backdrop-blur-sm">
                    <div className="space-y-2">
                      {["Overview", "Workflow", "Audit", "Artifacts", "Policy"].map((item, index) => (
                        <div
                          key={item}
                          className={`rounded-[12px] px-3 py-2 text-xs font-medium ${index === 1 ? "bg-landingVerdigris text-slate-950" : "bg-white/[0.04] text-landingGridQuiet"}`}
                        >
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[18px] border border-shellLine bg-black/40 p-4 backdrop-blur-sm">
                    <div className="grid gap-3 xl:grid-cols-[1.25fr_0.95fr]">
                      <div className="space-y-3">
                        {[
                          {
                            lane: "Promote",
                            detail: "Release approval bound to production environment policy.",
                          },
                          {
                            lane: "Review",
                            detail: "Draft PR, issue sync, and repo workspace remain linked to the same orbit.",
                          },
                          {
                            lane: "Execute",
                            detail: "Runtime actions, retries, and artifact output stay visible without flooding chat.",
                          },
                        ].map((item) => (
                          <div key={item.lane} className="rounded-[16px] border border-shellLine bg-white/[0.04] p-3">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-semibold text-landingGridLight">{item.lane}</p>
                              <span className="rounded-full border border-shellLine bg-white/[0.04] px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] text-landingGridFaint">
                                tracked
                              </span>
                            </div>
                            <p className="mt-2 text-sm leading-6 text-landingGridQuiet">{item.detail}</p>
                          </div>
                        ))}
                      </div>

                      <div className="rounded-[16px] border border-shellLine bg-white/[0.04] p-3">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-landingGridFaint">Recent audit</p>
                        <div className="mt-4 space-y-3">
                          {[
                            "Schema proposal opened for release workflow",
                            "Environment gate accepted by production approver",
                            "Artifact bundle attached to governed rollout",
                          ].map((item) => (
                            <div key={item} className="flex gap-3">
                              <div className="mt-1 h-2 w-2 rounded-full bg-landingVerdigris" />
                              <p className="text-sm leading-6 text-landingGridQuiet">{item}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Panel>
          </div>
        </section>

        <section id="proof" className="scroll-mt-28 px-4 py-6 sm:px-6 lg:px-10">
          <div className="mx-auto max-w-7xl">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-landingGridFaint">Operational proof</p>
                <h2 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-landingGridLight">Built for delivery systems that need visible governance.</h2>
              </div>
              <p className="max-w-[58ch] text-sm leading-6 text-landingGridQuiet">
                The landing surface should prove that AutoWeave understands environments, workflow lineage, repo boundaries, and review state before the user ever signs in.
              </p>
            </div>

            <div className="mt-8 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <Panel className="border-shellLine bg-landingShellMuted p-5">
                <div className="grid gap-4 md:grid-cols-3">
                  {[
                    {
                      title: "Environment posture",
                      value: "Ready",
                      detail: "Bound to explicit rollout gates, not ad hoc deploy clicks.",
                    },
                    {
                      title: "Approval flow",
                      value: "Structured",
                      detail: "Review boundaries remain attached to the workflow state machine.",
                    },
                    {
                      title: "Artifact trace",
                      value: "Linked",
                      detail: "Generated outputs stay tied to repos, runs, and audit history.",
                    },
                  ].map((item) => (
                    <div key={item.title} className="rounded-[18px] border border-shellLine bg-black/30 p-4">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-landingGridFaint">{item.title}</p>
                      <p className="mt-3 text-xl font-semibold tracking-[-0.04em] text-landingGridLight">{item.value}</p>
                      <p className="mt-2 text-sm leading-6 text-landingGridQuiet">{item.detail}</p>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel className="border-shellLine bg-landingShellMuted p-5">
                <p className="text-[11px] uppercase tracking-[0.16em] text-landingGridFaint">What operators care about</p>
                <div className="mt-4 space-y-3">
                  {[
                    "Which repository and branch is this action touching?",
                    "What environment policy must clear before rollout?",
                    "Who approved the last state transition and why?",
                    "Where is the artifact, preview, or generated result attached?",
                  ].map((item) => (
                    <div key={item} className="flex items-start gap-3 rounded-[16px] border border-shellLine bg-black/26 px-4 py-3">
                      <Check className="mt-0.5 h-4 w-4 text-landingVerdigris" />
                        <p className="text-sm leading-6 text-landingGridQuiet">{item}</p>
                      </div>
                    ))}
                  </div>
              </Panel>
            </div>
          </div>
        </section>

        <section id="features" className="scroll-mt-28 px-4 py-20 sm:px-6 lg:px-10">
          <div className="mx-auto max-w-7xl">
            <div className="max-w-3xl">
              <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-landingGridFaint">Control surfaces</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-landingGridLight">The product is organized around governed execution, not assistant theater.</h2>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {featureCards.map((item) => (
                <Panel key={item.title} className="border-shellLine bg-landingShellMuted p-5">
                  <item.icon className="h-5 w-5 text-landingVerdigris" />
                  <p className="mt-4 text-lg font-semibold tracking-[-0.03em] text-landingGridLight">{item.title}</p>
                  <p className="mt-3 text-sm leading-6 text-landingGridQuiet">{item.body}</p>
                </Panel>
              ))}
            </div>
          </div>
        </section>

        <section id="pricing" className="scroll-mt-28 px-4 py-20 sm:px-6 lg:px-10">
          <div className="mx-auto max-w-7xl">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-landingGridFaint">Pricing</p>
                <h2 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-landingGridLight">Structured around rollout shape, repository scope, and approval depth.</h2>
              </div>
              <p className="max-w-[56ch] text-sm leading-6 text-landingGridQuiet">
                AutoWeave pricing is intentionally consultative in this version. The right plan depends on how many repos, environments, operators, and governed changes you need to carry.
              </p>
            </div>

            <div className="mt-8 grid gap-4 xl:grid-cols-3">
              {pricingCards.map((item, index) => (
                <Panel
                  key={item.title}
                  className={`flex h-full flex-col border p-5 ${index === 1 ? "border-landingVerdigris bg-landingVerdigrisSoft" : "border-shellLine bg-landingShellMuted"}`}
                >
                  <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-landingGridFaint">{item.eyebrow}</p>
                  <h3 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-landingGridLight">{item.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-landingGridQuiet">{item.detail}</p>
                  <div className="mt-6 flex-1 space-y-3">
                    {item.features.map((feature) => (
                      <div key={feature} className="flex items-start gap-3 rounded-[14px] border border-shellLine bg-black/24 px-3.5 py-3">
                        <Check className="mt-0.5 h-4 w-4 text-landingVerdigris" />
                        <p className="text-sm leading-6 text-landingGridQuiet">{feature}</p>
                      </div>
                    ))}
                  </div>
                  <ExternalAnchor href={publicConfig.salesUrl} className={`${index === 1 ? primaryLinkClassName : secondaryLinkClassName} mt-6`}>
                    {item.cta}
                    <ArrowRight className="h-4 w-4" />
                  </ExternalAnchor>
                </Panel>
              ))}
            </div>
          </div>
        </section>

        <section id="contact" className="scroll-mt-28 px-4 pb-24 pt-12 sm:px-6 lg:px-10">
          <div className="mx-auto max-w-7xl">
            <Panel className="border-shellLine bg-landingShellMuted p-6 sm:p-8">
              <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-landingGridFaint">Contact</p>
                  <h2 className="mt-3 max-w-[12ch] text-3xl font-semibold tracking-[-0.05em] text-landingGridLight">
                    Bring your repos, environments, and rollout constraints.
                  </h2>
                  <p className="mt-4 max-w-[54ch] text-sm leading-6 text-landingGridQuiet">
                    AutoWeave is strongest when the public entry tells the same story as the product itself: governed workflow execution, repository-aware access, and operational clarity from first contact.
                  </p>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <Link href="/signup" className={primaryLinkClassName}>
                      Start with GitHub
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                    <Link href="/login" className={secondaryLinkClassName}>
                      Login
                    </Link>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  {contactCards.map((item) => (
                    <ExternalAnchor key={item.title} href={item.href} className="block h-full">
                      <Panel className="h-full border-shellLine bg-black/26 p-5 transition-[border-color,transform,background-color] duration-200 ease-productive hover:-translate-y-0.5 hover:border-landingGlassLine hover:bg-black/32">
                        <item.icon className="h-5 w-5 text-landingVerdigris" />
                        <p className="mt-4 text-lg font-semibold tracking-[-0.03em] text-landingGridLight">{item.title}</p>
                        <p className="mt-3 text-sm leading-6 text-landingGridQuiet">{item.body}</p>
                        <p className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-landingVerdigris">
                          {item.label}
                          <ExternalLink className="h-4 w-4" />
                        </p>
                      </Panel>
                    </ExternalAnchor>
                  ))}
                </div>
              </div>
            </Panel>
          </div>
        </section>
      </div>
    </main>
  );
}
