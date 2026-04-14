"use client";

import { useMemo } from "react";

import { SelectInput, cx } from "@/components/ui";
import type { OrbitCycle, OrbitMember } from "@/lib/types";

const ISSUE_STATUS_OPTIONS = [
  "triage",
  "backlog",
  "planned",
  "in_progress",
  "in_review",
  "ready_to_merge",
  "done",
  "canceled",
] as const;

function formatStateLabel(value: string | undefined | null) {
  const normalized = String(value || "").trim().replaceAll("_", " ");
  if (!normalized) {
    return "Unknown";
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

type TriageOwner = Pick<OrbitMember, "user_id" | "display_name" | "is_self">;
type TriageCycle = Pick<OrbitCycle, "id" | "name">;

export function NativeIssueTriageControls({
  status,
  assigneeUserId,
  assigneeDisplayName,
  cycleId,
  cycleName,
  members,
  cycles,
  fallbackOwner,
  membersReady = true,
  cyclesReady = true,
  disabled = false,
  className,
  onUpdate,
}: {
  status: string;
  assigneeUserId?: string | null;
  assigneeDisplayName?: string | null;
  cycleId?: string | null;
  cycleName?: string | null;
  members: OrbitMember[];
  cycles: OrbitCycle[];
  fallbackOwner?: TriageOwner | null;
  membersReady?: boolean;
  cyclesReady?: boolean;
  disabled?: boolean;
  className?: string;
  onUpdate: (payload: { status?: string; assignee_user_id?: string | null; cycle_id?: string | null }) => void;
}) {
  const ownerOptions = useMemo(() => {
    const options: TriageOwner[] = members.map((member) => ({
      user_id: member.user_id,
      display_name: member.display_name,
      is_self: member.is_self,
    }));
    if (fallbackOwner && !options.some((member) => member.user_id === fallbackOwner.user_id)) {
      options.unshift(fallbackOwner);
    }
    if (assigneeUserId && !options.some((member) => member.user_id === assigneeUserId)) {
      options.unshift({
        user_id: assigneeUserId,
        display_name: assigneeDisplayName || "Current owner",
      });
    }
    return options;
  }, [assigneeDisplayName, assigneeUserId, fallbackOwner, members]);

  const cycleOptions = useMemo(() => {
    const options: TriageCycle[] = cycles.map((cycle) => ({ id: cycle.id, name: cycle.name }));
    if (cycleId && !options.some((cycle) => cycle.id === cycleId)) {
      options.unshift({
        id: cycleId,
        name: cycleName || "Current cycle",
      });
    }
    return options;
  }, [cycleId, cycleName, cycles]);

  return (
    <div className={cx("flex flex-wrap items-center gap-2", className)}>
      <SelectInput
        aria-label="Issue status"
        value={status}
        onChange={(event) => onUpdate({ status: event.target.value })}
        disabled={disabled}
        className="min-w-[132px] px-3 py-2 text-[12px]"
      >
        {ISSUE_STATUS_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {formatStateLabel(option)}
          </option>
        ))}
      </SelectInput>
      <SelectInput
        aria-label="Issue owner"
        value={membersReady ? assigneeUserId || "" : ""}
        onChange={(event) => onUpdate({ assignee_user_id: event.target.value || null })}
        disabled={disabled || !membersReady}
        className="min-w-[148px] px-3 py-2 text-[12px]"
      >
        <option value="">{membersReady ? "Unassigned" : "Loading owners"}</option>
        {ownerOptions.map((member) => (
          <option key={member.user_id} value={member.user_id}>
            {member.display_name || "Unknown member"}
            {member.is_self ? " (You)" : ""}
          </option>
        ))}
      </SelectInput>
      <SelectInput
        aria-label="Issue cycle"
        value={cyclesReady ? cycleId || "" : ""}
        onChange={(event) => onUpdate({ cycle_id: event.target.value || null })}
        disabled={disabled || !cyclesReady}
        className="min-w-[148px] px-3 py-2 text-[12px]"
      >
        <option value="">{cyclesReady ? "No cycle" : "Loading cycles"}</option>
        {cycleOptions.map((cycle) => (
          <option key={cycle.id} value={cycle.id}>
            {cycle.name}
          </option>
        ))}
      </SelectInput>
    </div>
  );
}
