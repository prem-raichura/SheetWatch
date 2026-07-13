import { useEffect, useRef } from "react";
import { m, useMotionValue, useSpring, useReducedMotion } from "motion/react";

interface Props {
  value: number;
  format?: (n: number) => string;
  className?: string;
}

// Springed count-up for KPI values. Falls back to a static render when the
// user prefers reduced motion.
export default function NumberTicker({ value, format, className }: Props) {
  const reduced = useReducedMotion();
  const motionValue = useMotionValue(value);
  const spring = useSpring(motionValue, { stiffness: 90, damping: 22 });
  const ref = useRef<HTMLSpanElement>(null);
  const fmt = useRef(format);
  fmt.current = format;

  useEffect(() => {
    motionValue.set(value);
  }, [value, motionValue]);

  useEffect(() => {
    if (reduced) return;
    return spring.on("change", (v) => {
      if (ref.current) {
        ref.current.textContent = fmt.current ? fmt.current(v) : Math.round(v).toLocaleString();
      }
    });
  }, [spring, reduced]);

  const staticText = format ? format(value) : value.toLocaleString();
  if (reduced) return <span className={className}>{staticText}</span>;

  return (
    <m.span ref={ref} className={className}>
      {staticText}
    </m.span>
  );
}
