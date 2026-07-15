import { useId, useState } from "react";
import { Check, Laptop, Moon, Sun, Zap, ZapOff, Waves } from "lucide-react";
import { usePrefs } from "@/providers/PrefsProvider";
import { DASHBOARD_SECTIONS } from "@/lib/prefs";
import type { AppearancePrefs } from "@/lib/appearance";

const ACCENTS: { hex: string; name: string }[] = [
  { hex: "#0FA3A3", name: "Teal" },
  { hex: "#3B82F6", name: "Blue" },
  { hex: "#8B5CF6", name: "Violet" },
  { hex: "#F43F5E", name: "Rose" },
  { hex: "#F59E0B", name: "Amber" },
  { hex: "#22C55E", name: "Green" },
  { hex: "#64748B", name: "Slate" },
];

// Warn when a custom accent is too light/dark to read white/dark text on.
function contrastWarning(hex: string): string | null {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (lum > 0.82) return "Very light accents can be hard to read — consider a darker shade.";
  if (lum < 0.08) return "Very dark accents can be hard to see — consider a lighter shade.";
  return null;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <h2 className="font-display text-sm font-bold text-ink-900">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-ink-400">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: React.ReactNode; aria?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-paper p-0.5" role="group">
      {options.map((o) => (
        <button
          key={o.value}
          aria-label={o.aria}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
            value === o.value
              ? "bg-card text-ink-900 shadow-xs"
              : "text-ink-500 hover:text-ink-900"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function AppearancePage() {
  const { prefs, update } = usePrefs();
  const a = prefs.appearance;
  const customId = useId();
  const [customOpen, setCustomOpen] = useState(!ACCENTS.some((p) => p.hex === a.accent));

  const setAppearance = (patch: Partial<AppearancePrefs>) => update({ appearance: patch });
  const warning = contrastWarning(a.accent);
  const hidden = new Set(prefs.dashboard.hiddenSections);

  return (
    <div className="space-y-5">
      <Section title="Theme" hint="Dark mode follows your system by default.">
        <Segmented
          value={a.theme}
          onChange={(theme) => setAppearance({ theme })}
          options={[
            { value: "light", label: <><Sun className="h-3.5 w-3.5" /> Light</> },
            { value: "dark", label: <><Moon className="h-3.5 w-3.5" /> Dark</> },
            { value: "system", label: <><Laptop className="h-3.5 w-3.5" /> System</> },
          ]}
        />
      </Section>

      <Section title="Accent color" hint="Recolors buttons, links, charts and highlights everywhere.">
        <div className="flex flex-wrap items-center gap-2.5">
          {ACCENTS.map((p) => (
            <button
              key={p.hex}
              title={p.name}
              aria-label={`Accent ${p.name}`}
              onClick={() => {
                setCustomOpen(false);
                setAppearance({ accent: p.hex });
              }}
              className="flex h-8 w-8 items-center justify-center rounded-full transition-transform hover:scale-110 active:scale-95"
              style={{ backgroundColor: p.hex }}
            >
              {a.accent.toLowerCase() === p.hex.toLowerCase() && (
                <Check className="h-4 w-4 text-white drop-shadow" />
              )}
            </button>
          ))}
          <label
            htmlFor={customId}
            className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
              customOpen
                ? "border-teal/50 text-teal-600"
                : "border-line text-ink-500 hover:text-ink-900"
            }`}
          >
            <span
              className="h-4 w-4 rounded-full border border-line"
              style={{
                background:
                  "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)",
              }}
            />
            Custom
            <input
              id={customId}
              type="color"
              value={a.accent}
              onClick={() => setCustomOpen(true)}
              onChange={(e) => setAppearance({ accent: e.target.value })}
              className="h-0 w-0 opacity-0"
            />
          </label>
          <span className="font-mono text-xs text-ink-400">{a.accent.toUpperCase()}</span>
        </div>
        {warning && <p className="mt-3 text-xs text-warning">{warning}</p>}
      </Section>

      <Section title="Density" hint="Compact tightens paddings across the whole app.">
        <Segmented
          value={a.density}
          onChange={(density) => setAppearance({ density })}
          options={[
            { value: "comfortable", label: "Comfortable" },
            { value: "compact", label: "Compact" },
          ]}
        />
      </Section>

      <Section title="Font size">
        <Segmented
          value={a.fontScale}
          onChange={(fontScale) => setAppearance({ fontScale })}
          options={[
            { value: "sm", label: "Small" },
            { value: "md", label: "Default" },
            { value: "lg", label: "Large" },
          ]}
        />
      </Section>

      <Section
        title="Animation"
        hint="Reduced keeps only essential feedback; off disables all motion."
      >
        <Segmented
          value={a.animation}
          onChange={(animation) => setAppearance({ animation })}
          options={[
            { value: "full", label: <><Waves className="h-3.5 w-3.5" /> Full</> },
            { value: "reduced", label: <><Zap className="h-3.5 w-3.5" /> Reduced</> },
            { value: "off", label: <><ZapOff className="h-3.5 w-3.5" /> Off</> },
          ]}
        />
      </Section>

      <Section title="Time & dates">
        <div className="flex flex-wrap gap-6">
          <div>
            <div className="mb-2 text-xs font-medium text-ink-500">Clock</div>
            <Segmented
              value={prefs.time.hour12 ? "12" : "24"}
              onChange={(v) => update({ time: { hour12: v === "12" } })}
              options={[
                { value: "12", label: "12-hour" },
                { value: "24", label: "24-hour" },
              ]}
            />
          </div>
          <div>
            <div className="mb-2 text-xs font-medium text-ink-500">Timestamps</div>
            <Segmented
              value={prefs.time.relative ? "relative" : "absolute"}
              onChange={(v) => update({ time: { relative: v === "relative" } })}
              options={[
                { value: "relative", label: "Relative (3m ago)" },
                { value: "absolute", label: "Absolute" },
              ]}
            />
          </div>
        </div>
      </Section>

      <Section title="Start page" hint="Where SheetWatch opens after sign-in.">
        <Segmented
          value={prefs.landingTab}
          onChange={(landingTab) => update({ landingTab })}
          options={[
            { value: "/overview", label: "Overview" },
            { value: "/sheets", label: "Sheets" },
            { value: "/tracking", label: "Tracking" },
            { value: "/activity", label: "Activity" },
          ]}
        />
      </Section>

      <Section
        title="Overview sections"
        hint="Hide sections you don’t use — reorder them with “Edit layout” on the Overview page."
      >
        <div className="flex flex-wrap gap-2">
          {DASHBOARD_SECTIONS.map((s) => {
            const isHidden = hidden.has(s.id);
            return (
              <button
                key={s.id}
                aria-pressed={!isHidden}
                onClick={() =>
                  update({
                    dashboard: {
                      hiddenSections: isHidden
                        ? prefs.dashboard.hiddenSections.filter((id) => id !== s.id)
                        : [...prefs.dashboard.hiddenSections, s.id],
                    },
                  })
                }
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  isHidden
                    ? "border-line text-ink-300 line-through"
                    : "border-teal/40 bg-teal-soft text-teal-600"
                }`}
              >
                {s.title}
              </button>
            );
          })}
        </div>
      </Section>

      <Section
        title="Layout"
        hint="Each page remembers how you like to see it — switch with the view control in that page's header."
      >
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-xs sm:grid-cols-4">
          {[
            { label: "Tracking", value: prefs.views.tracking },
            { label: "Sheets", value: prefs.views.sheets },
            { label: "Activity", value: prefs.views.activity },
            { label: "KPIs", value: prefs.views.kpis },
          ].map((v) => (
            <div key={v.label} className="flex items-center justify-between gap-2">
              <span className="text-ink-500">{v.label}</span>
              <span className="rounded bg-secondary px-1.5 py-0.5 text-ink-700">{v.value}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
