import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

// Primary CTA with a slow shimmer sweep. Pure CSS so it costs nothing.
export default function ShimmerButton({ children, className, ...rest }: Props) {
  return (
    <button
      {...rest}
      className={cn(
        "group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-xl bg-foreground px-5 py-2.5 text-sm font-semibold text-background shadow-xs transition-all hover:shadow-md active:scale-[0.98]",
        className
      )}
    >
      <span
        aria-hidden
        className="absolute inset-0 -translate-x-full animate-[shimmer_2.6s_infinite] bg-gradient-to-r from-transparent via-white/15 to-transparent"
      />
      {children}
    </button>
  );
}
