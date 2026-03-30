"use client";

import {
  ArrowLeft,
  Bell,
  FileCode2,
  GitPullRequest,
  LayoutGrid,
  MessageSquare,
  Search,
  Settings,
  UserRound,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  AuthSessionError,
  answerWorkflowHumanRequest,
  createCodespace,
  fetchDmThread,
  fetchOrbit,
  inviteOrbitMember,
  publishDemo,
  readSession,
  refreshPrsIssues,
  resolveWorkflowApprovalRequest,
  sendDmMessage,
  sendOrbitMessage,
  updateNavigation,
} from "@/lib/api";
import type { DmThreadPayload, OrbitPayload, WorkflowRun, WorkflowTask } from "@/lib/types";
import { ActionButton, GhostButton, Panel, SectionTitle } from "@/components/ui";

const SECTION_ORDER = [
  { key: "chat", label: "Chats", icon: MessageSquare },
  { key: "dm", label: "DM", icon: Users },
  { key: "workflow", label: "Agent workflow", icon: LayoutGrid },
  { key: "prs", label: "PRs and Issues", icon: GitPullRequest },
  { key: "codespaces", label: "Code spaces", icon: FileCode2 },
  { key: "demos", label: "Demos", icon: FileCode2 },
] as const;

function workflowColumns(run: WorkflowRun | null) {
  const tasks = run?.tasks ?? [];
  return {
    Ready: tasks.filter((task) => ["ready", "waiting_for_dependency"].includes(task.state)),
    "In Process": tasks.filter((task) => ["in_progress", "waiting_for_human", "waiting_for_approval", "blocked"].includes(task.state)),
    Completed: tasks.filter((task) => task.state === "completed"),
  };
}

function groupedByPriority<T extends { priority: string }>(items: T[]) {
  return {
    High: items.filter((item) => item.priority === "high"),
    Medium: items.filter((item) => item.priority === "medium"),
    Low: items.filter((item) => item.priority === "low"),
  };
}

export function OrbitWorkspace({ orbitId }: { orbitId: string }) {
  const [session, setSession] = useState(readSession());
  const [payload, setPayload] = useState<OrbitPayload | null>(null);
  const [section, setSection] = useState("chat");
  const [messageBody, setMessageBody] = useState("");
  const [workflowTask, setWorkflowTask] = useState<WorkflowTask | null>(null);
  const [selectedDmId, setSelectedDmId] = useState<string | null>(null);
  const [dmPayload, setDmPayload] = useState<DmThreadPayload | null>(null);
  const [dmBody, setDmBody] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [workflowAnswers, setWorkflowAnswers] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  async function reload() {
    const nextSession = readSession();
    setSession(nextSession);
    if (!nextSession) {
      window.location.href = "/";
      return;
    }
    try {
      const nextPayload = await fetchOrbit(nextSession.token, orbitId);
      setPayload(nextPayload);
      const nextSection = nextPayload.navigation?.section || "chat";
      setSection(nextSection);
      const nextDmId = selectedDmId ?? nextPayload.direct_messages[0]?.id ?? null;
      setSelectedDmId(nextDmId);
      if (nextDmId) {
        const thread = await fetchDmThread(nextSession.token, orbitId, nextDmId);
        setDmPayload(thread);
      } else {
        setDmPayload(null);
      }
    } catch (nextError) {
      if (nextError instanceof AuthSessionError) {
        setSession(null);
        setPayload(null);
        setDmPayload(null);
        window.location.href = "/";
        return;
      }
      console.error(nextError);
    }
  }

  useEffect(() => {
    void reload();
  }, [orbitId]);

  useEffect(() => {
    if (!session || !payload) {
      return;
    }
    const activeRun = (payload.workflow.runs ?? []).some((run) => {
      const status = (run.status || "").toLowerCase();
      const operatorStatus = (run.operator_status || "").toLowerCase();
      const executionStatus = (run.execution_status || "").toLowerCase();
      return (
        status === "running" ||
        operatorStatus === "active" ||
        operatorStatus === "waiting_for_human" ||
        operatorStatus === "waiting_for_approval" ||
        executionStatus === "active" ||
        executionStatus === "waiting_for_human" ||
        executionStatus === "waiting_for_approval"
      );
    });
    if (!activeRun) {
      return;
    }
    const handle = window.setInterval(() => {
      void reload();
    }, 5000);
    return () => window.clearInterval(handle);
  }, [payload, session, orbitId, selectedDmId]);

  const selectedRun = payload?.workflow.selected_run ?? payload?.workflow.runs?.[0] ?? null;
  const columns = useMemo(() => workflowColumns(selectedRun), [selectedRun]);
  const openHumanRequests = selectedRun?.human_requests.filter((request) => request.status === "open") ?? [];
  const openApprovalRequests = selectedRun?.approval_requests.filter((request) => request.status === "requested") ?? [];
  const filteredMessages = useMemo(() => {
    if (!payload) {
      return [];
    }
    const term = search.trim().toLowerCase();
    if (!term) {
      return payload.messages;
    }
    return payload.messages.filter((message) => message.body.toLowerCase().includes(term) || message.author_name.toLowerCase().includes(term));
  }, [payload, search]);
  const groupedPrs = groupedByPriority(payload?.prs ?? []);
  const groupedIssues = groupedByPriority(payload?.issues ?? []);

  if (!session || !payload) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-quiet">Loading orbit…</div>;
  }

  async function onSectionChange(nextSection: string) {
    const currentToken = session?.token;
    if (!currentToken) {
      return;
    }
    setSection(nextSection);
    await updateNavigation(currentToken, { orbit_id: orbitId, section: nextSection });
  }

  async function onSendMessage() {
    const currentToken = session?.token;
    if (!currentToken || !messageBody.trim()) {
      return;
    }
    await sendOrbitMessage(currentToken, orbitId, messageBody);
    setMessageBody("");
    await reload();
  }

  async function onSendDmMessage() {
    const currentToken = session?.token;
    if (!currentToken || !selectedDmId || !dmBody.trim()) {
      return;
    }
    await sendDmMessage(currentToken, orbitId, selectedDmId, dmBody);
    setDmBody("");
    await reload();
  }

  async function onOpenDm(threadId: string) {
    const currentToken = session?.token;
    if (!currentToken) {
      return;
    }
    setSelectedDmId(threadId);
    setSection("dm");
    await onSectionChange("dm");
    const thread = await fetchDmThread(currentToken, orbitId, threadId);
    setDmPayload(thread);
  }

  async function onCreateCodespace() {
    const currentToken = session?.token;
    if (!currentToken || !payload) {
      return;
    }
    await createCodespace(currentToken, orbitId, { name: `${payload.orbit.name} workspace` });
    await reload();
  }

  async function onPublishDemo() {
    const currentToken = session?.token;
    if (!payload) {
      return;
    }
    const sourcePath = payload.codespaces[0]?.workspace_path;
    if (!currentToken || !sourcePath) {
      return;
    }
    await publishDemo(currentToken, orbitId, {
      title: `${payload.orbit.name} demo`,
      source_path: sourcePath,
    });
    await reload();
  }

  async function onInvite() {
    const currentToken = session?.token;
    if (!currentToken || !inviteEmail.trim()) {
      return;
    }
    await inviteOrbitMember(currentToken, orbitId, inviteEmail.trim());
    setInviteEmail("");
    await reload();
  }

  async function onAnswerHumanRequest(requestId: string) {
    const currentToken = session?.token;
    const answerText = workflowAnswers[requestId]?.trim();
    if (!currentToken || !selectedRun || !answerText) {
      return;
    }
    await answerWorkflowHumanRequest(currentToken, orbitId, {
      workflow_run_id: selectedRun.id,
      request_id: requestId,
      answer_text: answerText,
    });
    setWorkflowAnswers((current) => ({ ...current, [requestId]: "" }));
    await reload();
  }

  async function onResolveApproval(requestId: string, approved: boolean) {
    const currentToken = session?.token;
    if (!currentToken || !selectedRun) {
      return;
    }
    await resolveWorkflowApprovalRequest(currentToken, orbitId, {
      workflow_run_id: selectedRun.id,
      request_id: requestId,
      approved,
    });
    await reload();
  }

  return (
    <div className="flex min-h-screen bg-canvas">
      <aside className="flex w-[104px] flex-col items-center justify-between border-r border-line bg-panel px-3 py-5">
        <div className="flex flex-col items-center gap-3">
          <Link href="/app" className="flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-[#fbfbfa] text-ink">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex h-14 w-14 items-center justify-center rounded-[20px] border border-ink bg-ink text-sm font-semibold text-white">
            {(payload.orbit.logo || payload.orbit.name).slice(0, 2).toUpperCase()}
          </div>
          <button
            className="flex h-11 w-11 items-center justify-center rounded-2xl border border-line bg-[#fbfbfa] text-quiet"
            onClick={() => setSearchOpen((current) => !current)}
          >
            <Search className="h-4 w-4" />
          </button>
          {SECTION_ORDER.map(({ key, icon: Icon }) => (
            <button
              key={key}
              className={`flex h-11 w-11 items-center justify-center rounded-2xl border ${section === key ? "border-ink bg-ink text-white" : "border-line bg-[#fbfbfa] text-quiet"}`}
              onClick={() => void onSectionChange(key)}
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>
        <div className="flex flex-col items-center gap-3">
          <button
            className={`flex h-11 w-11 items-center justify-center rounded-2xl border ${section === "settings" ? "border-ink bg-ink text-white" : "border-line bg-[#fbfbfa] text-quiet"}`}
            onClick={() => void onSectionChange("settings")}
          >
            <Settings className="h-4 w-4" />
          </button>
          {[Bell, UserRound].map((Icon, index) => (
            <button key={index} className="flex h-11 w-11 items-center justify-center rounded-2xl border border-line bg-[#fbfbfa] text-quiet">
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>
      </aside>

      <main className="flex-1 px-6 py-7 lg:px-9">
        <div className="flex items-start justify-between gap-6">
          <SectionTitle
            eyebrow="Orbit"
            title={payload.orbit.name}
            detail={`${payload.orbit.description || "Single-repository engineering orbit"} · ${payload.orbit.repo_full_name || "Repository pending"}`}
          />
          <div className="flex gap-3">
            <GhostButton onClick={() => void reload()}>Refresh</GhostButton>
            <ActionButton onClick={() => void onSectionChange("workflow")}>Open workflow</ActionButton>
          </div>
        </div>

        {searchOpen ? (
          <div className="mt-6 rounded-[24px] border border-line bg-panel p-4">
            <p className="text-[11px] uppercase tracking-[0.24em] text-quiet">Search</p>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filter messages in this orbit"
              className="mt-3 w-full rounded-2xl border border-line bg-[#fbfbfa] px-4 py-3 text-sm outline-none"
            />
          </div>
        ) : null}

        <div className="mt-8">
          {section === "chat" ? (
            <div className="grid gap-6 xl:grid-cols-[1.45fr_0.85fr]">
              <Panel className="overflow-hidden">
                <div className="border-b border-line px-6 py-4">
                  <p className="text-[11px] uppercase tracking-[0.24em] text-quiet">#general</p>
                  <h3 className="mt-1 text-lg font-semibold">Orbit chat</h3>
                  <p className="mt-1 text-sm text-quiet">ERGO stays calm here. Workflow execution belongs in the workflow board.</p>
                </div>
                <div className="space-y-4 px-6 py-5">
                  {filteredMessages.map((message) => (
                    <div key={message.id} className="rounded-[22px] border border-line bg-[#fbfbfa] p-4">
                      <div className="flex items-center justify-between gap-4">
                        <p className="text-sm font-semibold text-ink">{message.author_name}</p>
                        <span className="text-[11px] uppercase tracking-[0.24em] text-quiet">{message.author_kind}</span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-ink">{message.body}</p>
                    </div>
                  ))}
                </div>
                <div className="border-t border-line px-6 py-5">
                  <div className="rounded-[24px] border border-line bg-white p-3">
                    <textarea
                      value={messageBody}
                      onChange={(event) => setMessageBody(event.target.value)}
                      placeholder="@ERGO build the repo settings flow and a clean review board"
                      className="min-h-24 w-full resize-none border-0 bg-transparent text-sm outline-none"
                    />
                    <div className="mt-3 flex items-center justify-between">
                      <p className="text-xs text-quiet">ERGO only returns here for direct human-facing messages.</p>
                      <ActionButton onClick={onSendMessage}>Send</ActionButton>
                    </div>
                  </div>
                </div>
              </Panel>

              <Panel className="p-6">
                <SectionTitle eyebrow="Orbit side context" title="People, repo, and live run" detail="The product keeps raw truth here while the runtime holds derived execution state." />
                <div className="mt-5 space-y-4 text-sm">
                  <div className="rounded-[22px] border border-line bg-[#fbfbfa] p-4">
                    <p className="font-semibold">{payload.orbit.repo_full_name || "Repo pending"}</p>
                    <p className="mt-1 text-quiet">{payload.orbit.repo_private ? "Private repository" : "Public repository"}</p>
                    {payload.orbit.repo_url ? (
                      <a className="mt-3 inline-flex font-medium underline underline-offset-4" href={payload.orbit.repo_url} target="_blank">
                        Open GitHub repository
                      </a>
                    ) : null}
                  </div>
                  <div className="rounded-[22px] border border-line bg-[#fbfbfa] p-4">
                    <p className="font-semibold">Members</p>
                    <div className="mt-3 space-y-2">
                      {payload.members.map((member) => (
                        <div key={member.user_id} className="flex items-center justify-between">
                          <span>{member.user_id}</span>
                          <span className="text-quiet">{member.role}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {selectedRun ? (
                    <div className="rounded-[22px] border border-line bg-[#fbfbfa] p-4">
                      <p className="font-semibold">Current workflow</p>
                      <p className="mt-2 text-sm text-quiet">{selectedRun.operator_summary}</p>
                      <p className="mt-2 text-xs uppercase tracking-[0.24em] text-quiet">{selectedRun.execution_status}</p>
                    </div>
                  ) : null}
                </div>
              </Panel>
            </div>
          ) : null}

          {section === "dm" ? (
            <div className="grid gap-6 xl:grid-cols-[0.68fr_1.32fr]">
              <Panel className="p-6">
                <SectionTitle eyebrow="Direct messages" title="Slack-style DM list" detail="Focused one-to-one or small-group conversation space." />
                <div className="mt-5 space-y-3">
                  {payload.direct_messages.map((thread) => (
                    <button
                      key={thread.id}
                      className={`block w-full rounded-[22px] border p-4 text-left ${selectedDmId === thread.id ? "border-ink bg-white" : "border-line bg-[#fbfbfa]"}`}
                      onClick={() => void onOpenDm(thread.id)}
                    >
                      <p className="text-sm font-semibold">{thread.title}</p>
                      <p className="mt-1 text-sm text-quiet">Use DMs for tighter coordination without polluting the channel.</p>
                    </button>
                  ))}
                </div>
              </Panel>
              <Panel className="overflow-hidden">
                <div className="border-b border-line px-6 py-4">
                  <p className="text-[11px] uppercase tracking-[0.24em] text-quiet">Direct message</p>
                  <h3 className="mt-1 text-lg font-semibold">{dmPayload?.thread.title || "Select a DM"}</h3>
                </div>
                <div className="space-y-4 px-6 py-5">
                  {(dmPayload?.messages ?? []).map((message) => (
                    <div key={message.id} className="rounded-[22px] border border-line bg-[#fbfbfa] p-4">
                      <div className="flex items-center justify-between gap-4">
                        <p className="text-sm font-semibold text-ink">{message.author_name}</p>
                        <span className="text-[11px] uppercase tracking-[0.24em] text-quiet">{message.author_kind}</span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-ink">{message.body}</p>
                    </div>
                  ))}
                  {!dmPayload?.messages.length ? (
                    <div className="rounded-[22px] border border-dashed border-line bg-[#faf9f6] p-5 text-sm text-quiet">
                      No messages in this DM yet.
                    </div>
                  ) : null}
                </div>
                <div className="border-t border-line px-6 py-5">
                  <div className="rounded-[24px] border border-line bg-white p-3">
                    <textarea
                      value={dmBody}
                      onChange={(event) => setDmBody(event.target.value)}
                      placeholder="Message ERGO or another thread participant"
                      className="min-h-24 w-full resize-none border-0 bg-transparent text-sm outline-none"
                    />
                    <div className="mt-3 flex items-center justify-between">
                      <p className="text-xs text-quiet">The ERGO DM can start work without polluting the main orbit chat.</p>
                      <ActionButton onClick={onSendDmMessage} disabled={!selectedDmId}>
                        Send
                      </ActionButton>
                    </div>
                  </div>
                </div>
              </Panel>
            </div>
          ) : null}

          {section === "workflow" ? (
            <div className="grid gap-6 xl:grid-cols-[1.55fr_0.85fr]">
              <Panel className="p-6">
                <div className="flex items-start justify-between gap-5">
                  <SectionTitle
                    eyebrow="Agent workflow"
                    title="Kanban execution board"
                    detail="Ready, in process, and completed work stay here instead of cluttering the main chat."
                  />
                  <GhostButton onClick={() => void reload()}>Refresh state</GhostButton>
                </div>
                <div className="mt-4 rounded-[22px] border border-line bg-[#fbfbfa] p-4">
                  <p className="text-sm font-semibold">{selectedRun?.title || "No workflow run yet"}</p>
                  <p className="mt-2 text-sm text-quiet">{selectedRun?.operator_summary || "Ask ERGO to build something to populate the board."}</p>
                </div>
                <div className="mt-6 grid gap-4 xl:grid-cols-3">
                  {Object.entries(columns).map(([column, cards]) => (
                    <div key={column} className="rounded-[24px] border border-line bg-[#fbfbfa] p-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold">{column}</p>
                        <span className="rounded-full border border-line px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-quiet">{cards.length}</span>
                      </div>
                      <div className="mt-4 space-y-3">
                        {cards.length ? (
                          cards.map((task) => (
                            <button
                              key={task.id}
                              className="w-full rounded-[20px] border border-line bg-white p-4 text-left"
                              onClick={() => setWorkflowTask(task)}
                            >
                              <p className="text-sm font-semibold">{task.title || task.task_key}</p>
                              <p className="mt-2 text-xs uppercase tracking-[0.24em] text-quiet">{task.assigned_role}</p>
                              <p className="mt-2 text-sm text-quiet">{task.state}</p>
                            </button>
                          ))
                        ) : (
                          <div className="rounded-[20px] border border-dashed border-line bg-white/80 p-4 text-sm text-quiet">
                            Nothing in this column right now.
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel className="p-6">
                <SectionTitle
                  eyebrow="Workflow detail"
                  title={workflowTask?.title || workflowTask?.task_key || "Select a card"}
                  detail="Task detail, open human requests, and release approvals stay in the side panel."
                />

                {openHumanRequests.length ? (
                  <div className="mt-6 space-y-4">
                    {openHumanRequests.map((request) => (
                      <div key={request.id} className="rounded-[22px] border border-line bg-[#fbfbfa] p-4">
                        <p className="text-sm font-semibold">Clarification needed</p>
                        <p className="mt-2 text-sm text-quiet">{request.question}</p>
                        <textarea
                          value={workflowAnswers[request.id] ?? ""}
                          onChange={(event) => setWorkflowAnswers((current) => ({ ...current, [request.id]: event.target.value }))}
                          className="mt-4 min-h-24 w-full rounded-[18px] border border-line bg-white px-3 py-3 text-sm outline-none"
                          placeholder="Answer the manager clearly and concretely."
                        />
                        <div className="mt-3 flex justify-end">
                          <ActionButton onClick={() => void onAnswerHumanRequest(request.id)}>Send answer</ActionButton>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {openApprovalRequests.length ? (
                  <div className="mt-6 space-y-4">
                    {openApprovalRequests.map((request) => (
                      <div key={request.id} className="rounded-[22px] border border-line bg-[#fbfbfa] p-4">
                        <p className="text-sm font-semibold">Approval required</p>
                        <p className="mt-2 text-sm text-quiet">{request.reason}</p>
                        <div className="mt-4 flex gap-3">
                          <GhostButton onClick={() => void onResolveApproval(request.id, false)}>Reject</GhostButton>
                          <ActionButton onClick={() => void onResolveApproval(request.id, true)}>Approve</ActionButton>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {workflowTask ? (
                  <div className="mt-6 space-y-4 text-sm">
                    <div className="rounded-[22px] border border-line bg-[#fbfbfa] p-4">
                      <p className="font-semibold">Status</p>
                      <p className="mt-2 text-quiet">{workflowTask.state}</p>
                    </div>
                    <div className="rounded-[22px] border border-line bg-[#fbfbfa] p-4">
                      <p className="font-semibold">Description</p>
                      <p className="mt-2 whitespace-pre-wrap text-quiet">{workflowTask.description || "No description available."}</p>
                    </div>
                    {workflowTask.worker_summary ? (
                      <div className="rounded-[22px] border border-line bg-[#fbfbfa] p-4">
                        <p className="font-semibold">Current process</p>
                        <p className="mt-2 whitespace-pre-wrap text-quiet">{workflowTask.worker_summary}</p>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-6 rounded-[22px] border border-dashed border-line bg-[#faf9f6] p-5 text-sm text-quiet">
                    Choose a workflow card to inspect its current process and execution context.
                  </div>
                )}

                {selectedRun?.events.length ? (
                  <div className="mt-6 rounded-[22px] border border-line bg-[#fbfbfa] p-4">
                    <p className="text-sm font-semibold">Recent runtime events</p>
                    <div className="mt-3 space-y-3">
                      {selectedRun.events.slice(0, 5).map((event) => (
                        <div key={event.id} className="rounded-[18px] border border-line bg-white px-3 py-3 text-sm">
                          <p className="font-medium">{event.event_type}</p>
                          <p className="mt-1 text-quiet">{event.message || event.source}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </Panel>
            </div>
          ) : null}

          {section === "prs" ? (
            <div className="grid gap-6 xl:grid-cols-2">
              <Panel className="p-6">
                <div className="flex items-center justify-between">
                  <SectionTitle eyebrow="Pull requests" title="Priority board" detail="Draft PRs opened for ERGO work stay visible and actionable." />
                  <GhostButton onClick={() => session?.token ? refreshPrsIssues(session.token, orbitId).then(() => reload()) : Promise.resolve()}>Refresh</GhostButton>
                </div>
                <div className="mt-6 grid gap-4 xl:grid-cols-3">
                  {Object.entries(groupedPrs).map(([label, items]) => (
                    <div key={label} className="rounded-[22px] border border-line bg-[#fbfbfa] p-4">
                      <p className="text-sm font-semibold">{label}</p>
                      <div className="mt-3 space-y-3">
                        {items.length ? (
                          items.map((pr) => (
                            <a key={pr.id} className="block rounded-[18px] border border-line bg-white p-3" href={pr.url} target="_blank">
                              <p className="text-sm font-semibold">{pr.title}</p>
                              <p className="mt-2 text-xs uppercase tracking-[0.24em] text-quiet">#{pr.number}</p>
                            </a>
                          ))
                        ) : (
                          <div className="rounded-[18px] border border-dashed border-line bg-white/80 p-3 text-sm text-quiet">Nothing here.</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
              <Panel className="p-6">
                <SectionTitle eyebrow="Issues" title="Issue queue" detail="Issues stay close to PRs so the orbit can branch work and review cleanly." />
                <div className="mt-6 grid gap-4 xl:grid-cols-3">
                  {Object.entries(groupedIssues).map(([label, items]) => (
                    <div key={label} className="rounded-[22px] border border-line bg-[#fbfbfa] p-4">
                      <p className="text-sm font-semibold">{label}</p>
                      <div className="mt-3 space-y-3">
                        {items.length ? (
                          items.map((issue) => (
                            <a key={issue.id} className="block rounded-[18px] border border-line bg-white p-3" href={issue.url} target="_blank">
                              <p className="text-sm font-semibold">{issue.title}</p>
                              <p className="mt-2 text-xs uppercase tracking-[0.24em] text-quiet">#{issue.number}</p>
                            </a>
                          ))
                        ) : (
                          <div className="rounded-[18px] border border-dashed border-line bg-white/80 p-3 text-sm text-quiet">Nothing here.</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          ) : null}

          {section === "codespaces" ? (
            <Panel className="p-6">
              <div className="flex items-start justify-between gap-5">
                <SectionTitle eyebrow="Codespaces" title="Branch-oriented local workspaces" detail="Each codespace becomes a local Docker-based editor container tied to a branch context." />
                <ActionButton onClick={onCreateCodespace}>Create codespace</ActionButton>
              </div>
              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                {payload.codespaces.length ? (
                  payload.codespaces.map((item) => (
                    <div key={item.id} className="rounded-[24px] border border-line bg-[#fbfbfa] p-5">
                      <p className="text-base font-semibold">{item.name}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.24em] text-quiet">{item.branch_name}</p>
                      <p className="mt-4 text-sm text-quiet">{item.workspace_path}</p>
                      <div className="mt-5 flex items-center justify-between">
                        <span className="rounded-full border border-line px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-quiet">{item.status}</span>
                        {item.editor_url ? (
                          <a className="text-sm font-medium underline underline-offset-4" href={item.editor_url} target="_blank">
                            Open editor
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[24px] border border-dashed border-line bg-[#faf9f6] p-5 text-sm text-quiet">
                    Create the first orbit codespace to spin up a local editor container for a new branch.
                  </div>
                )}
              </div>
            </Panel>
          ) : null}

          {section === "demos" ? (
            <Panel className="p-6">
              <div className="flex items-start justify-between gap-5">
                <SectionTitle eyebrow="Demos" title="Live demo surfaces" detail="Publish a workspace path into a lightweight local demo container and surface it in the dashboard priority stack." />
                <ActionButton onClick={onPublishDemo} disabled={!payload.codespaces.length}>
                  Publish latest codespace
                </ActionButton>
              </div>
              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                {payload.demos.length ? (
                  payload.demos.map((item) => (
                    <div key={item.id} className="rounded-[24px] border border-line bg-[#fbfbfa] p-5">
                      <p className="text-base font-semibold">{item.title}</p>
                      <p className="mt-2 text-sm text-quiet">{item.source_path}</p>
                      <div className="mt-5 flex items-center justify-between">
                        <span className="rounded-full border border-line px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-quiet">{item.status}</span>
                        {item.url ? (
                          <a className="text-sm font-medium underline underline-offset-4" href={item.url} target="_blank">
                            Open demo
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[24px] border border-dashed border-line bg-[#faf9f6] p-5 text-sm text-quiet">
                    No demos published yet. Publish a codespace directory when you have a previewable build.
                  </div>
                )}
              </div>
            </Panel>
          ) : null}

          {section === "settings" ? (
            <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
              <Panel className="p-6">
                <SectionTitle eyebrow="Orbit settings" title="Repository and membership" detail="Invite collaborators, review repository linkage, and keep the orbit cleanly scoped to one repo." />
                <div className="mt-6 grid gap-4">
                  <div className="rounded-[22px] border border-line bg-[#fbfbfa] p-4">
                    <p className="text-sm font-semibold">GitHub repository</p>
                    <p className="mt-2 text-sm text-quiet">{payload.orbit.repo_full_name || "Repository pending"}</p>
                    <p className="mt-2 text-sm text-quiet">{payload.orbit.repo_private ? "Private" : "Public"} · Default branch {payload.orbit.default_branch}</p>
                  </div>
                  <div className="rounded-[22px] border border-line bg-[#fbfbfa] p-4">
                    <p className="text-sm font-semibold">Invite teammate</p>
                    <div className="mt-4 flex gap-3">
                      <input
                        value={inviteEmail}
                        onChange={(event) => setInviteEmail(event.target.value)}
                        placeholder="teammate@example.com"
                        className="flex-1 rounded-2xl border border-line bg-white px-4 py-3 text-sm outline-none"
                      />
                      <ActionButton onClick={onInvite}>Send invite</ActionButton>
                    </div>
                  </div>
                </div>
              </Panel>
              <Panel className="p-6">
                <SectionTitle eyebrow="Workspace memory" title="Product to runtime bridge" detail="Raw product events stay here; only derived execution context is projected into AutoWeave." />
                <div className="mt-6 space-y-4">
                  <div className="rounded-[22px] border border-line bg-[#fbfbfa] p-4 text-sm text-quiet">
                    Channel messages, DM messages, work items, repo metadata, and user actions remain product-owned.
                  </div>
                  <div className="rounded-[22px] border border-line bg-[#fbfbfa] p-4 text-sm text-quiet">
                    Deterministic summaries, referenced files, links, and decision signals are projected into the AutoWeave execution memory layer.
                  </div>
                </div>
              </Panel>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
