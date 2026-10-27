import type { ComponentChildren, JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { Source } from "../../core/types";
import type { Explanation } from "../../core/insights";

const PATHS: Record<string, string> = {
  today: "M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  training: "M3 12h3l3-7 4 14 3-7h5",
  recovery: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z",
  body: "M12 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 10h10M12 10v5M12 15l-3 5M12 15l3 5",
  coach: "M4 5h16v11H8l-4 4zM8 9h8M8 12h5",
  settings: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  refresh: "M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4",
  back: "M15 18l-6-6 6-6",
  info: "M12 8h.01M11 12h1v5h1M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
  close: "M6 6l12 12M18 6L6 18",
  chevron: "M9 6l6 6-6 6",
  plus: "M12 5v14M5 12h14",
};

export function Icon({ name, size = 22 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

export function PageHead({ title, sub, actions }: { title: string; sub?: ComponentChildren; actions?: ComponentChildren }) {
  return (
    <header class="page-head">
      <div><h1>{title}</h1>{sub && <p class="sub">{sub}</p>}</div>
      {actions && <div class="row" style="flex-wrap:nowrap">{actions}</div>}
    </header>
  );
}

export function Seg<T extends string | number>({ value, options, onChange, full, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; full?: boolean; label: string;
}) {
  return (
    <div class={`seg${full ? " full" : ""}`} role="group" aria-label={label}>
      {options.map((o) => <button type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ComponentChildren }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open]);
  if (!open) return null;
  return (
    <>
      <div class="sheet-backdrop" onClick={onClose} />
      <div class="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div class="grab" />
        <div class="spread" style="align-items:flex-start;margin-bottom:8px">
          {title ? <h2>{title}</h2> : <span />}
          <button class="icon-btn" onClick={onClose} aria-label="Stäng"><Icon name="close" size={18} /></button>
        </div>
        {children}
      </div>
    </>
  );
}

const SOURCE_LABEL: Record<Source, string> = { garmin: "Garmin", manual: "Manuellt", strengthlog: "StrengthLog", computed: "Beräknat", demo: "Demo" };

export function SourceTag({ source }: { source: Source }) {
  return <span class={`tag${source === "demo" ? " demo" : ""}`}>{SOURCE_LABEL[source]}</span>;
}

export function Notice({ children, kind = "attention" }: { children: ComponentChildren; kind?: "attention" | "info" }) {
  return <div class={`notice${kind === "info" ? " info" : ""}`} role="note"><span class="ico" aria-hidden="true">{kind === "info" ? "i" : "!"}</span><div>{children}</div></div>;
}

export function Empty({ title, children }: { title: string; children?: ComponentChildren }) {
  return <div class="empty"><h3>{title}</h3>{children}</div>;
}

export function Explain({ get, label = "Förklara grafen" }: { get: () => Explanation; label?: string }) {
  const [open, setOpen] = useState(false);
  const e = open ? get() : null;
  return (
    <>
      <button class="link" onClick={() => setOpen(true)}>{label}</button>
      <Sheet open={open} onClose={() => setOpen(false)} title={label}>
        {e && <div class="stack">
          <div><h4 class="section-title" style="margin:0 0 4px">Vad du ser</h4><p class="secondary">{e.what}</p></div>
          <div><h4 class="section-title" style="margin:0 0 4px">Just nu</h4><p>{e.now}</p></div>
          <div><h4 class="section-title" style="margin:0 0 4px">Vad du kan göra</h4><p class="secondary">{e.action}</p></div>
        </div>}
      </Sheet>
    </>
  );
}

export function Card({ title, sub, right, children, class: cls = "" }: { title?: ComponentChildren; sub?: ComponentChildren; right?: ComponentChildren; children: ComponentChildren; class?: string }) {
  return (
    <section class={`card ${cls}`}>
      {(title || right) && <div class="card-head"><div>{title && <h3>{title}</h3>}{sub && <p class="card-sub">{sub}</p>}</div>{right}</div>}
      {children}
    </section>
  );
}

export function useAsync() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); return true; } catch (e) { setError(e instanceof Error ? e.message : "Något gick fel."); return false; } finally { setBusy(false); }
  };
  return { busy, error, run, setError };
}

export const fmt = (v: number | null | undefined, d = 0) =>
  v == null || !Number.isFinite(v) ? "–" : v.toLocaleString("sv-SE", { minimumFractionDigits: d, maximumFractionDigits: d });

export type Click = JSX.TargetedMouseEvent<HTMLElement>;
