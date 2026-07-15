import type { LucideIcon } from "lucide-react";

interface Option<T extends string> {
  value: T;
  icon: LucideIcon;
  label: string;
}

interface Props<T extends string> {
  value: T;
  options: [Option<T>, Option<T>];
  onChange: (v: T) => void;
}

// Two-way icon segmented control for switching a surface's layout.
export default function ViewToggle<T extends string>({ value, options, onChange }: Props<T>) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-paper p-0.5" role="group">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            aria-label={o.label}
            title={o.label}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
              active ? "bg-card text-ink-900 shadow-xs" : "text-ink-400 hover:text-ink-900"
            }`}
          >
            <o.icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
