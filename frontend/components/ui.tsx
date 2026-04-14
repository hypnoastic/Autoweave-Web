"use client";

import clsx from "clsx";
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  ForwardedRef,
  HTMLAttributes,
  InputHTMLAttributes,
  PropsWithChildren,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { forwardRef, useEffect, useId, useRef } from "react";

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
  return <div className={clsx("rounded-pane border border-line bg-panelStrong shadow-panel", className)}>{children}</div>;
}

export function SurfaceCard({
  className,
  children,
  ...rest
}: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) {
  return (
    <div className={clsx("rounded-pane border border-line bg-panel p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]", className)} {...rest}>
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
    <div className={clsx("flex flex-col gap-1", dense && "gap-0.5")}>
      {eyebrow ? <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-quiet">{eyebrow}</p> : null}
      <h2 className={clsx("font-semibold tracking-[-0.03em] text-ink", dense ? "text-base" : "text-xl")}>{title}</h2>
      {detail ? <p className={clsx("text-quiet", dense ? "text-xs" : "text-sm")}>{detail}</p> : null}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  detail,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  detail?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("flex items-start justify-between gap-6", className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="text-sm text-quiet">{eyebrow}</p> : null}
        <h1 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-ink">{title}</h1>
        {detail ? <p className="mt-2 max-w-[64ch] text-sm leading-6 text-quiet">{detail}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-quiet">{children}</span>;
}

export function FieldHint({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-5 text-quiet">{children}</p>;
}

export function FieldError({ children }: { children: ReactNode }) {
  return <p role="alert" className="text-xs leading-5 text-stateDanger">{children}</p>;
}

export function ActionButton({
  className,
  children,
  ...rest
}: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) {
  const buttonType = rest.type ?? "button";
  return (
    <button
      type={buttonType}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-chip border border-accent bg-accent px-4 py-2.5 text-sm font-medium text-accentContrast transition-[transform,opacity,background-color,border-color,color,box-shadow] duration-200 ease-productive hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focusRing focus-visible:ring-offset-0 active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-45",
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
  const buttonType = rest.type ?? "button";
  return (
    <button
      type={buttonType}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-chip border border-line bg-panel px-4 py-2.5 text-sm font-medium text-ink transition-[transform,background-color,border-color,color,box-shadow] duration-200 ease-productive hover:border-lineStrong hover:bg-panelMuted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focusRing focus-visible:ring-offset-0 active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50",
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
  const buttonType = rest.type ?? "button";
  return (
    <button
      type={buttonType}
      className={clsx(
        "inline-flex h-10 w-10 items-center justify-center rounded-chip text-quiet transition-[transform,background-color,color,box-shadow] duration-200 ease-productive hover:bg-panelMuted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focusRing focus-visible:ring-offset-0 active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none",
        active && "bg-accent text-accentContrast hover:bg-accent hover:text-accentContrast",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export const TextInput = forwardRef(function TextInput(
  {
    className,
    ...rest
  }: InputHTMLAttributes<HTMLInputElement>,
  ref: ForwardedRef<HTMLInputElement>,
) {
  return (
    <input
      ref={ref}
      className={clsx(
        "w-full rounded-chip border border-line bg-panel px-3.5 py-2.5 text-sm text-ink outline-none transition-[background-color,border-color,box-shadow] duration-200 ease-out placeholder:text-faint focus:border-lineStrong focus:bg-panelStrong focus-visible:ring-2 focus-visible:ring-focusRing focus-visible:ring-offset-0 motion-reduce:transition-none",
        className,
      )}
      {...rest}
    />
  );
});

export const SelectInput = forwardRef(function SelectInput(
  {
    className,
    children,
    ...rest
  }: PropsWithChildren<SelectHTMLAttributes<HTMLSelectElement>>,
  ref: ForwardedRef<HTMLSelectElement>,
) {
  return (
    <select
      ref={ref}
      className={clsx(
        "w-full rounded-chip border border-line bg-panel px-3.5 py-2.5 text-sm text-ink outline-none transition-[background-color,border-color,box-shadow] duration-200 ease-out focus:border-lineStrong focus:bg-panelStrong focus-visible:ring-2 focus-visible:ring-focusRing focus-visible:ring-offset-0 motion-reduce:transition-none",
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
});

export const TextArea = forwardRef(function TextArea(
  {
    className,
    ...rest
  }: TextareaHTMLAttributes<HTMLTextAreaElement>,
  ref: ForwardedRef<HTMLTextAreaElement>,
) {
  return (
    <textarea
      ref={ref}
      className={clsx(
        "min-h-24 w-full resize-none rounded-chip border border-line bg-panel px-3.5 py-3 text-sm text-ink outline-none transition-[background-color,border-color,box-shadow] duration-200 ease-out placeholder:text-faint focus:border-lineStrong focus:bg-panelStrong focus-visible:ring-2 focus-visible:ring-focusRing focus-visible:ring-offset-0 motion-reduce:transition-none",
        className,
      )}
      {...rest}
    />
  );
});

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
}: PropsWithChildren<{ tone?: "neutral" | "accent" | "success" | "danger" | "muted" | "warning" }>) {
  const toneClass =
    tone === "accent"
      ? "border-accent bg-accent text-accentContrast"
      : tone === "success"
        ? "border-stateSuccess/20 bg-stateSuccess/10 text-stateSuccess"
        : tone === "danger"
          ? "border-stateDanger/20 bg-stateDanger/10 text-stateDanger"
          : tone === "warning"
            ? "border-stateWarning/20 bg-stateWarning/10 text-stateWarning"
          : tone === "muted"
            ? "border-line bg-panel text-faint"
            : "border-line bg-panelStrong text-quiet";
  return <span className={clsx("inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em]", toneClass)}>{children}</span>;
}

export function SurfaceHeader({
  title,
  detail,
  action,
  titleId,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
  titleId?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h3 id={titleId} className="text-sm font-semibold tracking-[-0.02em] text-ink">{title}</h3>
        {detail ? <p className="mt-1 text-xs leading-5 text-quiet">{detail}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function InlineNotice({
  tone = "neutral",
  title,
  detail,
  className,
}: {
  tone?: "neutral" | "success" | "danger" | "warning";
  title?: string;
  detail: string;
  className?: string;
}) {
  const toneClass =
    tone === "success"
      ? "border-stateSuccess/20 bg-stateSuccess/10 text-stateSuccess"
      : tone === "danger"
        ? "border-stateDanger/20 bg-stateDanger/10 text-stateDanger"
        : tone === "warning"
          ? "border-stateWarning/20 bg-stateWarning/10 text-stateWarning"
          : "border-line bg-panelStrong text-quiet";
  return (
    <div
      role={tone === "danger" || tone === "warning" ? "alert" : "status"}
      aria-live={tone === "danger" || tone === "warning" ? "assertive" : "polite"}
      className={clsx("rounded-pane border px-4 py-3 text-sm", toneClass, className)}
    >
      {title ? <p className="font-medium">{title}</p> : null}
      <p className={clsx(title ? "mt-1" : undefined)}>{detail}</p>
    </div>
  );
}

export function EmptyState({
  title,
  detail,
  action,
  className,
}: {
  title?: string;
  detail?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("rounded-pane border border-dashed border-line bg-panel px-4 py-4 text-sm text-quiet", className)}>
      {title ? <p className="font-medium text-ink">{title}</p> : null}
      {detail ? <p className={clsx(title ? "mt-1" : "", "leading-6")}>{detail}</p> : null}
      {action ? <div className="mt-3 flex items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function SkeletonBlock({
  className,
}: {
  className?: string;
}) {
  return <div aria-hidden="true" className={clsx("animate-pulse rounded-pane bg-panelMuted motion-reduce:animate-none", className)} />;
}

export function PageLoader({
  label = "Loading…",
  fullscreen = true,
  className,
}: {
  label?: string;
  fullscreen?: boolean;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={clsx(
        "flex items-center justify-center px-6",
        fullscreen ? "min-h-dvh" : "h-full min-h-0 flex-1",
        className,
      )}
    >
      <div className="flex items-center gap-3 rounded-pane border border-line bg-panel px-4 py-3 text-sm text-quiet shadow-soft">
        <span className="h-2.5 w-2.5 rounded-full bg-accent animate-pulse motion-reduce:animate-none" />
        {label}
      </div>
    </div>
  );
}

export function ShellPage({
  className,
  children,
}: PropsWithChildren<{ className?: string }>) {
  return <main className={clsx("flex h-full min-w-0 flex-1 flex-col overflow-hidden px-4 py-4 sm:px-5 sm:py-5 lg:px-6", className)}>{children}</main>;
}

export function ShellPageSkeleton({
  mode = "dashboard",
}: {
  mode?: "dashboard" | "inbox" | "orbit";
}) {
  return (
    <ShellPage>
      <div role="status" aria-live="polite" className="flex min-h-0 flex-1 flex-col gap-5">
        <div className="space-y-3 pb-2">
          <SkeletonBlock className="h-3 w-28 rounded-full" />
          <SkeletonBlock className="h-10 w-[min(420px,72%)]" />
          <SkeletonBlock className="h-4 w-[min(620px,88%)] rounded-full" />
          <SkeletonBlock className="h-4 w-[min(540px,74%)] rounded-full" />
        </div>

        {mode === "dashboard" ? (
          <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
            <Panel className="flex min-h-[320px] flex-col overflow-hidden">
              <div className="border-b border-line px-5 py-4">
                <SkeletonBlock className="h-3 w-20 rounded-full" />
                <SkeletonBlock className="mt-3 h-6 w-56" />
                <SkeletonBlock className="mt-2 h-4 w-[75%] rounded-full" />
              </div>
              <div className="flex-1 space-y-3 px-4 py-4">
                <SkeletonBlock className="h-28" />
                <SkeletonBlock className="h-28" />
                <SkeletonBlock className="h-28" />
              </div>
            </Panel>
            <Panel className="flex min-h-[320px] flex-col overflow-hidden">
              <div className="border-b border-line px-5 py-4">
                <SkeletonBlock className="h-3 w-24 rounded-full" />
                <SkeletonBlock className="mt-3 h-6 w-60" />
                <SkeletonBlock className="mt-2 h-4 w-[70%] rounded-full" />
              </div>
              <div className="flex-1 space-y-3 px-4 py-4">
                <SkeletonBlock className="h-24" />
                <SkeletonBlock className="h-24" />
              </div>
            </Panel>
          </div>
        ) : mode === "inbox" ? (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <Panel className="overflow-hidden">
              <div className="space-y-3 border-b border-line px-5 py-5">
                <SkeletonBlock className="h-3 w-20 rounded-full" />
                <SkeletonBlock className="h-9 w-[min(460px,72%)]" />
                <SkeletonBlock className="h-14 w-full rounded-[18px]" />
                <div className="flex gap-2">
                  <SkeletonBlock className="h-8 w-20 rounded-full" />
                  <SkeletonBlock className="h-8 w-20 rounded-full" />
                  <SkeletonBlock className="h-8 w-20 rounded-full" />
                </div>
              </div>
            </Panel>
            <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(320px,0.82fr)_minmax(0,1.18fr)]">
              <Panel className="flex min-h-[360px] flex-col overflow-hidden">
                <div className="border-b border-line px-5 py-4">
                  <SkeletonBlock className="h-6 w-44" />
                  <SkeletonBlock className="mt-2 h-4 w-[70%] rounded-full" />
                </div>
                <div className="space-y-3 px-4 py-4">
                  <SkeletonBlock className="h-20" />
                  <SkeletonBlock className="h-20" />
                  <SkeletonBlock className="h-20" />
                  <SkeletonBlock className="h-20" />
                </div>
              </Panel>
              <Panel className="flex min-h-[360px] flex-col overflow-hidden">
                <div className="border-b border-line px-5 py-4">
                  <SkeletonBlock className="h-6 w-52" />
                  <SkeletonBlock className="mt-2 h-4 w-[62%] rounded-full" />
                </div>
                <div className="flex-1 space-y-4 px-5 py-5">
                  <SkeletonBlock className="h-20" />
                  <SkeletonBlock className="h-14" />
                  <SkeletonBlock className="h-24" />
                  <SkeletonBlock className="h-24" />
                </div>
              </Panel>
            </div>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
            <Panel className="flex min-h-[360px] flex-col overflow-hidden">
              <div className="border-b border-line px-5 py-4">
                <SkeletonBlock className="h-3 w-16 rounded-full" />
                <SkeletonBlock className="mt-3 h-6 w-40" />
                <SkeletonBlock className="mt-2 h-4 w-[80%] rounded-full" />
              </div>
              <div className="space-y-3 px-4 py-4">
                <SkeletonBlock className="h-16" />
                <SkeletonBlock className="h-16" />
                <SkeletonBlock className="h-16" />
                <SkeletonBlock className="h-16" />
              </div>
            </Panel>
            <Panel className="flex min-h-[360px] flex-col overflow-hidden">
              <div className="border-b border-line px-5 py-4">
                <SkeletonBlock className="h-6 w-48" />
                <SkeletonBlock className="mt-2 h-4 w-[65%] rounded-full" />
              </div>
              <div className="flex-1 space-y-4 px-5 py-5">
                <SkeletonBlock className="h-20" />
                <SkeletonBlock className="h-20" />
                <SkeletonBlock className="h-20" />
                <div className="pt-2">
                  <SkeletonBlock className="h-12 w-full rounded-[16px]" />
                </div>
              </div>
            </Panel>
          </div>
        )}
      </div>
    </ShellPage>
  );
}

export function RailSidebar({
  className,
  children,
}: PropsWithChildren<{ className?: string }>) {
  return (
    <aside
      className={clsx(
        "flex h-dvh w-[76px] shrink-0 flex-col justify-between border-r border-line bg-panel px-3 py-4 md:w-[88px]",
        className,
      )}
    >
      {children}
    </aside>
  );
}

export function RailCluster({
  className,
  children,
}: PropsWithChildren<{ className?: string }>) {
  return <div className={clsx("flex flex-col items-center gap-3", className)}>{children}</div>;
}

export function RailButton({
  active = false,
  title,
  onClick,
  children,
  className,
}: PropsWithChildren<{ active?: boolean; title: string; onClick: () => void; className?: string }>) {
  return (
    <IconButton aria-label={title} title={title} active={active} className={clsx("h-10 w-10 rounded-[11px]", className)} onClick={onClick}>
      {children}
    </IconButton>
  );
}

export function ContextSidebar({
  eyebrow,
  title,
  detail,
  action,
  className,
  children,
}: PropsWithChildren<{
  eyebrow?: string;
  title: string;
  detail?: string;
  action?: ReactNode;
  className?: string;
}>) {
  return (
    <aside className={clsx("hidden h-dvh w-[264px] shrink-0 flex-col border-r border-line bg-panelMuted/40 lg:flex", className)}>
      <div className="border-b border-line px-4 py-4">
        <SectionTitle eyebrow={eyebrow} title={title} detail={detail} dense />
        {action ? <div className="mt-4">{action}</div> : null}
      </div>
      <ScrollPanel className="flex-1 px-3 py-3">{children}</ScrollPanel>
    </aside>
  );
}

export function ListRow({
  title,
  detail,
  eyebrow,
  leading,
  trailing,
  supporting,
  onClick,
  active = false,
  className,
}: {
  title: string;
  detail?: string;
  eyebrow?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  supporting?: ReactNode;
  onClick?: () => void;
  active?: boolean;
  className?: string;
}) {
  const eyebrowClassName = active ? "text-accentContrast/75" : "text-quiet";
  const titleClassName = active ? "text-accentContrast" : "text-ink";
  const detailClassName = active ? "text-accentContrast/80" : "text-quiet";
  const leadingClassName = active ? "text-accentContrast/80" : "text-quiet";
  const content = (
    <div className="flex w-full items-start gap-3">
      {leading ? <div className={clsx("mt-0.5 shrink-0", leadingClassName)}>{leading}</div> : null}
      <div className="min-w-0 flex-1">
        {eyebrow ? <p className={clsx("text-[11px] font-medium uppercase tracking-[0.14em]", eyebrowClassName)}>{eyebrow}</p> : null}
        <p className={clsx("truncate text-sm font-medium", titleClassName)}>{title}</p>
        {detail ? <p className={clsx("mt-1 text-xs leading-5", detailClassName)}>{detail}</p> : null}
        {supporting ? <div className={clsx("mt-2 flex flex-wrap items-center gap-2 text-xs", detailClassName)}>{supporting}</div> : null}
      </div>
      {trailing ? <div className="shrink-0 pt-0.5">{trailing}</div> : null}
    </div>
  );
  const sharedClassName = clsx(
    "rounded-pane border px-4 py-3 transition-[background-color,border-color,transform,box-shadow] duration-200 ease-productive motion-reduce:transform-none motion-reduce:transition-none",
    active
      ? "border-lineStrong bg-panel text-ink shadow-[inset_0_0_0_1px_var(--aw-border-strong)]"
      : "border-line bg-panelStrong",
    className,
  );
  if (onClick) {
    return (
      <button
        type="button"
        className={clsx(
          "w-full text-left hover:bg-panelMuted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focusRing focus-visible:ring-offset-0 active:scale-[0.99]",
          sharedClassName,
        )}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }
  return <div className={sharedClassName}>{content}</div>;
}

export function SelectionChip({
  active = false,
  className,
  children,
  ...rest
}: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }>) {
  const buttonType = rest.type ?? "button";
  return (
    <button
      type={buttonType}
      className={clsx(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-[background-color,border-color,color,transform,box-shadow] duration-200 ease-productive hover:bg-panelMuted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focusRing focus-visible:ring-offset-0 active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50",
        active ? "border-accent bg-accent text-accentContrast hover:bg-accent hover:text-accentContrast" : "border-line bg-panelStrong text-ink",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

function useOverlaySurface<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const surfaceRef = useRef<T | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const surface = surfaceRef.current;
      if (!surface) {
        return;
      }
      const firstFocusable = surface.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (firstFocusable ?? surface).focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (!surfaceRef.current) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const focusable = Array.from(surfaceRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (node) => !node.hasAttribute("disabled") && node.getAttribute("aria-hidden") !== "true",
      );
      if (!focusable.length) {
        event.preventDefault();
        surfaceRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      previousActiveElement?.focus();
    };
  }, [open, onClose]);

  return { surfaceRef, titleId };
}

export function OverlayBackdrop({
  visible,
  onClick,
  subtle = false,
  offsetLeft,
}: {
  visible: boolean;
  onClick: () => void;
  subtle?: boolean;
  offsetLeft?: number | string;
}) {
  if (!visible) {
    return null;
  }
  return (
    <button
      type="button"
      aria-label="Close overlay"
      tabIndex={-1}
      onClick={onClick}
      style={offsetLeft == null ? undefined : ({ left: offsetLeft } satisfies CSSProperties)}
      className={clsx(
        "aw-motion-fade fixed inset-0 z-30 transition-[opacity] duration-200 ease-productive-out motion-reduce:transition-none",
        subtle ? "bg-overlay/50 backdrop-blur-sm" : "bg-overlay/90 backdrop-blur-md",
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
  const { surfaceRef, titleId } = useOverlaySurface<HTMLElement>(open, onClose);
  if (!open) {
    return null;
  }
  return (
    <>
      <OverlayBackdrop visible={open} onClick={onClose} offsetLeft={offset} />
      <aside
        ref={surfaceRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="aw-motion-slide-left fixed bottom-0 top-0 z-40 border-r border-line bg-panelStrong shadow-soft transition-[transform,opacity] duration-200 ease-productive motion-reduce:transition-none"
        style={{
          left: offset,
          width,
          transform: "translateX(0)",
        }}
      >
        <SurfaceHeader title={title} detail={description} titleId={titleId} />
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
  const { surfaceRef, titleId } = useOverlaySurface<HTMLElement>(open, onClose);
  if (!open) {
    return null;
  }
  return (
    <>
      <OverlayBackdrop visible={open} onClick={onClose} subtle />
      <aside
        ref={surfaceRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="aw-motion-slide-right fixed bottom-0 right-0 top-0 z-40 w-full max-w-[420px] border-l border-line bg-panelStrong shadow-soft transition-[transform,opacity] duration-200 ease-productive motion-reduce:transition-none"
      >
        <SurfaceHeader title={title} detail={description} titleId={titleId} action={<GhostButton onClick={onClose}>Close</GhostButton>} />
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
  panelClassName,
  bodyClassName,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  panelClassName?: string;
  bodyClassName?: string;
}) {
  const { surfaceRef, titleId } = useOverlaySurface<HTMLDivElement>(open, onClose);
  if (!open) {
    return null;
  }
  return (
    <>
      <OverlayBackdrop visible={open} onClick={onClose} />
      <div className="fixed inset-0 z-40 flex items-center justify-center px-4 transition-[opacity] duration-200 ease-productive-out motion-reduce:transition-none">
        <div
          ref={surfaceRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={clsx(
            "aw-motion-pop flex max-h-[88dvh] w-full max-w-[680px] flex-col overflow-hidden rounded-card border border-line bg-panelStrong shadow-soft backdrop-blur-2xl transition-[transform,opacity] duration-200 ease-productive motion-reduce:transition-none",
            panelClassName,
          )}
        >
          <SurfaceHeader title={title} detail={description} titleId={titleId} action={<GhostButton onClick={onClose}>Close</GhostButton>} />
          <div className={clsx("scroll-region px-5 py-5", bodyClassName)}>{children}</div>
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
  if (!open) {
    return null;
  }
  return (
    <div
      role="menu"
      className={clsx(
        "aw-motion-pop absolute right-0 top-full z-40 mt-2 min-w-[220px] rounded-pane border border-line bg-panelStrong p-2 shadow-soft backdrop-blur-xl transition-[opacity,transform] duration-200 ease-productive motion-reduce:transition-none",
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
  const buttonType = rest.type ?? "button";
  return (
    <button
      role="menuitem"
      type={buttonType}
      className={clsx("flex w-full items-center gap-3 rounded-chip px-3 py-2.5 text-left text-sm text-ink transition-[background-color,color,box-shadow] duration-200 ease-productive hover:bg-panelMuted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focusRing focus-visible:ring-offset-0", className)}
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
