import type {
  BoardItem,
  CodespaceSummary,
  MyWorkPayload,
  NotificationItem,
  WorkItemSummary,
} from "@/lib/types";

export type PlanningTone = "accent" | "danger" | "muted" | "success" | "warning";

export type PlanningPreview = {
  id: string;
  kind: string;
  eyebrow: string;
  title: string;
  detail: string;
  supporting?: string;
  status: string;
  tone: PlanningTone;
  href: string;
  timestamp?: string;
};

export type PlanningCycle = {
  id: string;
  label: string;
  detail: string;
  windowLabel: string;
  tone: PlanningTone;
  metrics: {
    count: number;
    review: number;
    blocked: number;
  };
  highlights: PlanningPreview[];
};

export type PlanningView = {
  id: string;
  label: string;
  detail: string;
  tone: PlanningTone;
  count: number;
  href: string;
  preview: PlanningPreview[];
};

function formatStatus(value: string | undefined | null) {
  return String(value || "queued").replaceAll("_", " ");
}

function parseTimestamp(value: string | undefined | null) {
  if (!value) {
    return 0;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function thisWeekLabel(reference = new Date()) {
  const start = new Date(reference);
  const offset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - offset);
  const end = new Date(start);
  end.setDate(start.getDate() + 4);
  const formatter = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  });
  return `${formatter.format(start)} - ${formatter.format(end)}`;
}

function orbitHrefForRepository(payload: MyWorkPayload, repositoryFullName?: string | null) {
  const match = payload.recent_orbits.find((item) => item.repo_full_name === repositoryFullName);
  return match ? `/app/orbits/${match.id}` : "/app/orbits";
}

function issueTone(item: BoardItem): PlanningTone {
  const status = String(item.operational_status || item.state || "").toLowerCase();
  if (["blocked", "changes_requested"].includes(status)) {
    return "danger";
  }
  if (["awaiting_review", "in_review", "ready_for_review"].includes(status)) {
    return "warning";
  }
  if (["done", "closed", "merged", "completed", "resolved"].includes(status)) {
    return "success";
  }
  return "accent";
}

function workTone(item: WorkItemSummary): PlanningTone {
  const status = String(item.status || "").toLowerCase();
  if (["blocked", "failed"].includes(status)) {
    return "danger";
  }
  if (["in_review", "needs_input"].includes(status)) {
    return "warning";
  }
  if (["completed"].includes(status)) {
    return "success";
  }
  return "accent";
}

function notificationTone(item: NotificationItem): PlanningTone {
  if (item.kind === "run_failed") {
    return "danger";
  }
  if (["approval", "clarification"].includes(item.kind)) {
    return "warning";
  }
  return "muted";
}

function codespaceTone(item: CodespaceSummary): PlanningTone {
  return item.status === "running" ? "success" : "muted";
}

function issuePreview(payload: MyWorkPayload, item: BoardItem): PlanningPreview {
  const status = formatStatus(item.operational_status || item.state);
  return {
    id: `issue-${item.id}`,
    kind: "issue",
    eyebrow: item.repository_full_name || "Issue",
    title: item.title,
    detail: `#${item.number} · ${item.repository_full_name || "Project issue"}`,
    supporting: item.branch_name ? `Branch ${item.branch_name}` : undefined,
    status,
    tone: issueTone(item),
    href: orbitHrefForRepository(payload, item.repository_full_name),
  };
}

function workPreview(item: WorkItemSummary): PlanningPreview {
  return {
    id: `work-${item.id}`,
    kind: "work",
    eyebrow: item.agent,
    title: item.title,
    detail: item.summary || "ERGO execution is live for this request.",
    supporting: item.branch_name ? `Branch ${item.branch_name}` : undefined,
    status: formatStatus(item.status),
    tone: workTone(item),
    href: "/app/chat",
    timestamp: item.updated_at,
  };
}

function notificationPreview(item: NotificationItem): PlanningPreview {
  return {
    id: `notification-${item.id}`,
    kind: "notification",
    eyebrow: "Inbox signal",
    title: item.title,
    detail: item.detail,
    status: formatStatus(item.kind),
    tone: notificationTone(item),
    href: "/app/inbox",
    timestamp: item.created_at,
  };
}

function codespacePreview(payload: MyWorkPayload, item: CodespaceSummary): PlanningPreview {
  return {
    id: `codespace-${item.id}`,
    kind: "codespace",
    eyebrow: "Codespace",
    title: item.name,
    detail: item.repository_full_name || item.workspace_path,
    supporting: item.branch_name ? `Branch ${item.branch_name}` : undefined,
    status: formatStatus(item.status),
    tone: codespaceTone(item),
    href: orbitHrefForRepository(payload, item.repository_full_name),
  };
}

function sortPreviews(items: PlanningPreview[]) {
  return [...items].sort((left, right) => parseTimestamp(right.timestamp) - parseTimestamp(left.timestamp));
}

export function derivePlanningCycles(payload: MyWorkPayload): PlanningCycle[] {
  const activeWorkItems = payload.work_items.filter((item) => !["completed", "blocked", "failed"].includes(String(item.status).toLowerCase()));
  const blockedWorkItems = payload.work_items.filter((item) => ["blocked", "failed"].includes(String(item.status).toLowerCase()));
  const reviewWorkItems = payload.work_items.filter((item) => ["in_review", "needs_input"].includes(String(item.status).toLowerCase()));
  const failureSignals = payload.notifications.filter((item) => item.kind === "run_failed");

  const executionHighlights = sortPreviews([
    ...payload.active_issues.map((item) => issuePreview(payload, item)),
    ...activeWorkItems.map((item) => workPreview(item)),
    ...payload.codespaces.filter((item) => item.status === "running").map((item) => codespacePreview(payload, item)),
  ]).slice(0, 6);

  const reviewHighlights = sortPreviews([
    ...payload.review_queue.map((item) => issuePreview(payload, item)),
    ...payload.approvals.map((item) => notificationPreview(item)),
    ...reviewWorkItems.map((item) => workPreview(item)),
  ]).slice(0, 6);

  const riskHighlights = sortPreviews([
    ...payload.blocked_issues.map((item) => issuePreview(payload, item)),
    ...blockedWorkItems.map((item) => workPreview(item)),
    ...failureSignals.map((item) => notificationPreview(item)),
  ]).slice(0, 6);

  return [
    {
      id: "execution-window",
      label: "Execution window",
      detail: "Accepted work that is already moving through ERGO execution, issue delivery, and active workspaces.",
      windowLabel: thisWeekLabel(),
      tone: executionHighlights.length ? "accent" : "muted",
      metrics: {
        count: payload.active_issues.length + activeWorkItems.length,
        review: payload.review_queue.length,
        blocked: payload.blocked_issues.length,
      },
      highlights: executionHighlights,
    },
    {
      id: "review-window",
      label: "Review window",
      detail: "Human checkpoints that can stall throughput if PR review, approval, or clarification waits too long.",
      windowLabel: "human checkpoints",
      tone: reviewHighlights.length ? "warning" : "muted",
      metrics: {
        count: payload.review_queue.length + payload.approvals.length + reviewWorkItems.length,
        review: payload.review_queue.length + payload.approvals.length,
        blocked: 0,
      },
      highlights: reviewHighlights,
    },
    {
      id: "risk-window",
      label: "Risk window",
      detail: "Blocked issues and failing execution signals that need owner attention before the cycle slips.",
      windowLabel: "risk watch",
      tone: riskHighlights.length ? "danger" : "muted",
      metrics: {
        count: payload.blocked_issues.length + blockedWorkItems.length + failureSignals.length,
        review: 0,
        blocked: payload.blocked_issues.length + blockedWorkItems.length,
      },
      highlights: riskHighlights,
    },
  ];
}

export function derivePlanningViews(payload: MyWorkPayload): PlanningView[] {
  const activeWorkItems = payload.work_items.filter((item) => !["completed", "blocked", "failed"].includes(String(item.status).toLowerCase()));
  const blockedWorkItems = payload.work_items.filter((item) => ["blocked", "failed"].includes(String(item.status).toLowerCase()));
  const reviewWorkItems = payload.work_items.filter((item) => ["in_review", "needs_input"].includes(String(item.status).toLowerCase()));

  const recentPreview = sortPreviews([
    ...payload.active_issues.map((item) => issuePreview(payload, item)),
    ...payload.review_queue.map((item) => issuePreview(payload, item)),
    ...payload.blocked_issues.map((item) => issuePreview(payload, item)),
    ...payload.work_items.map((item) => workPreview(item)),
    ...payload.notifications.map((item) => notificationPreview(item)),
  ]).slice(0, 6);

  return [
    {
      id: "assigned",
      label: "Assigned to me",
      detail: "The active issues and teammate work that still belong to your queue right now.",
      tone: payload.active_issues.length || activeWorkItems.length ? "accent" : "muted",
      count: payload.active_issues.length + activeWorkItems.length,
      href: "/app/my-work",
      preview: sortPreviews([
        ...payload.active_issues.map((item) => issuePreview(payload, item)),
        ...activeWorkItems.map((item) => workPreview(item)),
      ]).slice(0, 6),
    },
    {
      id: "needs-review",
      label: "Needs review",
      detail: "PR checkpoints, approvals, and clarifications that need a human answer before delivery can close.",
      tone: payload.review_queue.length || payload.approvals.length ? "warning" : "muted",
      count: payload.review_queue.length + payload.approvals.length + reviewWorkItems.length,
      href: "/app/my-work",
      preview: sortPreviews([
        ...payload.review_queue.map((item) => issuePreview(payload, item)),
        ...payload.approvals.map((item) => notificationPreview(item)),
        ...reviewWorkItems.map((item) => workPreview(item)),
      ]).slice(0, 6),
    },
    {
      id: "blocked",
      label: "Blocked",
      detail: "Blocked issues, failed runs, and stalled teammate work that are currently preventing progress.",
      tone: payload.blocked_issues.length || blockedWorkItems.length ? "danger" : "muted",
      count: payload.blocked_issues.length + blockedWorkItems.length,
      href: "/app/my-work",
      preview: sortPreviews([
        ...payload.blocked_issues.map((item) => issuePreview(payload, item)),
        ...blockedWorkItems.map((item) => workPreview(item)),
      ]).slice(0, 6),
    },
    {
      id: "ergo-active",
      label: "ERGO active",
      detail: "Requests that are currently delegated to the cloud teammate and still require coordination.",
      tone: activeWorkItems.length ? "accent" : "muted",
      count: activeWorkItems.length,
      href: "/app/chat",
      preview: sortPreviews(activeWorkItems.map((item) => workPreview(item))).slice(0, 6),
    },
    {
      id: "recent",
      label: "Recently updated",
      detail: "The freshest planning signals across issues, teammate work, and inbox activity.",
      tone: recentPreview.length ? "success" : "muted",
      count: recentPreview.length,
      href: "/app/inbox",
      preview: recentPreview,
    },
  ];
}
