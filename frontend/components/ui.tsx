"use client";

import clsx from "clsx";
import type { ButtonHTMLAttributes, PropsWithChildren } from "react";

export function Panel({
  className,
  children,
}: PropsWithChildren<{ className?: string }>) {
  return (
    <div className={clsx("rounded-[24px] border border-line bg-panel shadow-panel", className)}>
      {children}
    </div>
  );
}

export function SectionTitle({
  eyebrow,
  title,
  detail,
}: {
  eyebrow: string;
  title: string;
  detail?: string;
}) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-quiet">{eyebrow}</p>
      <h2 className="text-xl font-semibold tracking-[-0.03em] text-ink">{title}</h2>
      {detail ? <p className="max-w-2xl text-sm text-quiet">{detail}</p> : null}
    </div>
  );
}

export function ActionButton({
  className,
  children,
  ...rest
}: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center rounded-full border border-ink bg-ink px-4 py-2 text-sm font-medium text-white transition hover:bg-[#242424] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  className,
  children,
  ...rest
}: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center rounded-full border border-line bg-white px-4 py-2 text-sm font-medium text-ink transition hover:border-ink",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
