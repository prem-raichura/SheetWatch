import { m } from "motion/react";
import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  delay?: number; // seconds
  className?: string;
  y?: number;
}

// In-view blur+fade entrance. Use with a per-index delay for staggered lists.
export default function BlurFade({ children, delay = 0, className, y = 8 }: Props) {
  return (
    <m.div
      className={className}
      initial={{ opacity: 0, y, filter: "blur(4px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-24px" }}
      transition={{ duration: 0.32, delay, ease: [0.21, 0.47, 0.32, 0.98] }}
    >
      {children}
    </m.div>
  );
}
