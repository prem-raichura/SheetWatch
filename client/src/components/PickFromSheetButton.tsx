import { Table2 } from "lucide-react";

interface Props {
  onClick: () => void;
  disabled?: boolean;
  /** Hidden on the "xs" size, which is icon-only. */
  label?: string;
  size?: "xs" | "sm";
  className?: string;
}

// The one affordance that opens SheetPicker, so every cell / range / column
// field advertises itself the same way. Always type="button" — several of these
// live inside <label> or <form> subtrees.
export default function PickFromSheetButton({
  onClick,
  disabled,
  label = "Choose from sheet",
  size = "sm",
  className = "",
}: Props) {
  const base =
    "inline-flex shrink-0 items-center justify-center gap-1 rounded-lg border border-line bg-surface font-semibold text-ink-600 transition-colors hover:border-teal/40 hover:text-teal-600 disabled:cursor-not-allowed disabled:opacity-50";
  const sizing = size === "xs" ? "h-7 w-7" : "px-2.5 py-1 text-[11px]";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`${base} ${sizing} ${className}`}
    >
      <Table2 className="h-3 w-3" />
      {size === "sm" && <span>{label}</span>}
    </button>
  );
}
