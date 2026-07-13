interface Props {
  tone?: "live" | "muted" | "alert";
  title?: string;
}

const map = {
  live: "bg-teal animate-pulse-ring",
  muted: "bg-muted-foreground/60",
  alert: "bg-coral",
};

// The poll heartbeat — a breathing dot marks a sheet as actively watched.
export default function PulseDot({ tone = "live", title }: Props) {
  return (
    <span
      title={title}
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${map[tone]}`}
    />
  );
}
