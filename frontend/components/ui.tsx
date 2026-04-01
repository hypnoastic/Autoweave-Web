"use client";

import clsx from "clsx";
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  PropsWithChildren,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

export function cx(...values: Parameters<typeof clsx>) {
  return clsx(...values);
}

export function AppShell({
  sidebar,
  children,
}: {
  sidebar: ReactNode;
  children: ReactNode;
}) {
  return <div className="flex h-dvh overflow-hidden bg-canvas text-ink">{sidebar}{children}</div>;
}

export function ShellMain({
  className,
  children,
}: PropsWithChildren<{ className?: string }>) {
  return <main className={clsx("relative flex min-w-0 flex-1 overflow-hidden", className)}>{children}</main>;
}

export function Panel({
  className,
  children,
}: PropsWithChildren<{ className?: string }>) {
  return <div className={clsx("rounded-pane border border-line bg-panel shadow-panel backdrop-blur", className)}>{children}</div>;
}

export function SurfaceCard({
  className,
  children,
  ...rest
}: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) {
  return (
    <div className={clsx("rounded-pane border border-line bg-panelMuted p-4", className)} {...rest}>
      {children}
    </div>
  );
}

export function SectionTitle({
  eyebrow,
  title,
  detail,
  dense = false,
}: {
  eyebrow?: string;
  title: string;
  detail?: string;
  dense?: boolean;
}) {
  return (
    <div className={clsx("space-y-1", dense && "space-y-0.5")}>
      {eyebrow ? <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-quiet">{eyebrow}</p> : null}
      <h2 className={clsx("font-semibold tracking-[-0.03em] text-ink", dense ? "text-base" : "text-xl")}>{title}</h2>
      {detail ? <p className={clsx("text-quiet", dense ? "text-xs" : "text-sm")}>{detail}</p> : null}
    </div>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-quiet">{children}</span>;
}

export function ActionButton({
  className,
  children,
  ...rest
}: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-chip border border-accent bg-accent px-4 py-2.5 text-sm font-medium text-accentContrast transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45",
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
        "inline-flex items-center justify-center gap-2 rounded-chip border border-line bg-panelStrong px-4 py-2.5 text-sm font-medium text-ink transition hover:border-lineStrong hover:bg-panelMuted disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function IconButton({
  className,
  active = false,
  children,
  ...rest
}: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }>) {
  return (
    <button
      className={clsx(
        "inline-flex h-10 w-10 items-center justify-center rounded-chip text-quiet transition hover:bg-panelMuted hover:text-ink",
        active && "bg-accent text-accentContrast hover:bg-accent hover:text-accentContrast",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function TextInput({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={clsx(
        "w-full rounded-chip border border-line bg-panelStrong px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-faint focus:border-lineStrong focus:bg-panel",
        className,
      )}
      {...rest}
    />
  );
}

export function TextArea({
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={clsx(
        "min-h-24 w-full resize-none rounded-chip border border-line bg-panelStrong px-3.5 py-3 text-sm text-ink outline-none transition placeholder:text-faint focus:border-lineStrong focus:bg-panel",
        className,
      )}
      {...rest}
    />
  );
}

export function AvatarMark({
  label,
  src,
  className,
}: {
  label: string;
  src?: string | null;
  className?: string;
}) {
  return src ? (
    <img src={src} alt={label} className={clsx("h-9 w-9 rounded-chip object-cover", className)} />
  ) : (
    <div className={clsx("flex h-9 w-9 items-center justify-center rounded-chip bg-panelStrong text-[12px] font-semibold text-ink", className)}>
      {label.slice(0, 2).toUpperCase()}
    </div>
  );
}

export function StatusPill({
  tone = "neutral",
  children,
}: PropsWithChildren<{ tone?: "neutral" | "accent" | "success" | "danger" | "muted" }>) {
  const toneClass =
    tone === "accent"
      ? "border-accent bg-accent text-accentContrast"
      : tone === "success"
        ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
        : tone === "danger"
          ? "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300"
          : tone === "muted"
            ? "border-line bg-panel text-faint"
            : "border-line bg-panelStrong text-quiet";
  return <span className={clsx("inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em]", toneClass)}>{children}</span>;
}

export function SurfaceHeader({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold tracking-[-0.02em] text-ink">{title}</h3>
        {detail ? <p className="mt-1 text-xs leading-5 text-quiet">{detail}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function OverlayBackdrop({
  visible,
  onClick,
  subtle = false,
}: {
  visible: boolean;
  onClick: () => void;
  subtle?: boolean;
}) {
  return (
    <button
      aria-hidden={!visible}
      tabIndex={-1}
      onClick={onClick}
      className={clsx(
        "fixed inset-0 z-30 transition",
        visible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        subtle ? "bg-overlay/40" : "bg-overlay/80 backdrop-blur-[2px]",
      )}
    />
  );
}

export function LeftSlidePanel({
  open,
  onClose,
  offset = 0,
  width = 360,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  offset?: number;
  width?: number | string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <>
      <OverlayBackdrop visible={open} onClick={onClose} />
      <aside
        className="fixed bottom-0 top-0 z-40 border-r border-line bg-panel shadow-soft transition-transform"
        style={{
          left: offset,
          width,
          transform: open ? "translateX(0)" : `translateX(calc(-100% - ${offset}px))`,
        }}
      >
        <SurfaceHeader title={title} detail={description} />
        <div className="scroll-region h-[calc(100dvh-73px)] px-5 py-5">{children}</div>
      </aside>
    </>
  );
}

export function RightDetailPanel({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <>
      <OverlayBackdrop visible={open} onClick={onClose} subtle />
      <aside
        className="fixed bottom-0 right-0 top-0 z-40 w-full max-w-[420px] border-l border-line bg-panel shadow-soft transition-transform"
        style={{ transform: open ? "translateX(0)" : "translateX(100%)" }}
      >
        <SurfaceHeader title={title} detail={description} action={<GhostButton onClick={onClose}>Close</GhostButton>} />
        <div className="scroll-region h-[calc(100dvh-73px)] px-5 py-5">{children}</div>
      </aside>
    </>
  );
}

export function CenteredModal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <>
      <OverlayBackdrop visible={open} onClick={onClose} />
      <div className={clsx("fixed inset-0 z-40 flex items-center justify-center px-4 transition", open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0")}>
        <div className="flex max-h-[88dvh] w-full max-w-[680px] flex-col overflow-hidden rounded-card border border-line bg-panel shadow-soft">
          <SurfaceHeader title={title} detail={description} action={<GhostButton onClick={onClose}>Close</GhostButton>} />
          <div className="scroll-region px-5 py-5">{children}</div>
          {footer ? <div className="border-t border-line px-5 py-4">{footer}</div> : null}
        </div>
      </div>
    </>
  );
}

export function PopoverMenu({
  open,
  className,
  children,
}: PropsWithChildren<{ open: boolean; className?: string }>) {
  return (
    <div
      className={clsx(
        "absolute right-0 top-full z-40 mt-2 min-w-[220px] rounded-pane border border-line bg-panel p-2 shadow-soft transition",
        open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function MenuItem({
  className,
  children,
  ...rest
}: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) {
  return (
    <button
      className={clsx("flex w-full items-center gap-3 rounded-chip px-3 py-2.5 text-left text-sm text-ink transition hover:bg-panelMuted", className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function ScrollPanel({
  className,
  children,
}: PropsWithChildren<{ className?: string }>) {
  return <div className={clsx("scroll-region min-h-0", className)}>{children}</div>;
}

export function Divider({ className }: { className?: string }) {
  return <div className={clsx("h-px bg-line", className)} />;
}
