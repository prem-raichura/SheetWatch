import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface ChartWidgetData {
  id: string;
  sheetId: string;
  sheetLabel: string;
  label: string;
  type: "line" | "bar" | "area" | "donut";
  range: string;
  xColumn: string | null;
  dataColumns: string[];
  headerRow: boolean;
  sortOrder: number;
  data: { labels: string[]; series: { name: string; data: (number | null)[] }[] };
}

const PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const tooltipStyle = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  boxShadow: "var(--shadow-pop-value)",
  fontSize: 12,
  color: "var(--text-strong)",
};

function toRows(data: ChartWidgetData["data"]) {
  return data.labels.map((label, i) => {
    const row: Record<string, string | number | null> = { label };
    for (const s of data.series) row[s.name] = s.data[i];
    return row;
  });
}

// Themed Recharts renderer for a chart widget. Colors ride the accent-aware
// --chart-* variables, so theme + accent changes recolor charts live.
export default function ChartCard({ widget }: { widget: ChartWidgetData }) {
  const rows = toRows(widget.data);
  const names = widget.data.series.map((s) => s.name);

  if (rows.length === 0 || names.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center font-mono text-xs text-ink-300">
        no data in {widget.range} yet
      </div>
    );
  }

  const axisProps = {
    stroke: "var(--text-faint)",
    fontSize: 10,
    tickLine: false,
    axisLine: { stroke: "var(--border)" },
  } as const;

  if (widget.type === "donut") {
    const first = widget.data.series[0];
    const donut = widget.data.labels
      .map((label, i) => ({ name: label || `Row ${i + 1}`, value: first.data[i] ?? 0 }))
      .filter((d) => d.value !== 0);
    return (
      <ResponsiveContainer width="100%" height={192}>
        <PieChart>
          <Tooltip contentStyle={tooltipStyle} />
          <Pie
            data={donut}
            dataKey="value"
            nameKey="name"
            innerRadius="55%"
            outerRadius="85%"
            paddingAngle={2}
            stroke="var(--card)"
            isAnimationActive
          >
            {donut.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (widget.type === "bar") {
    return (
      <ResponsiveContainer width="100%" height={192}>
        <BarChart data={rows} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" {...axisProps} />
          <YAxis {...axisProps} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--accent)" }} />
          {names.map((n, i) => (
            <Bar key={n} dataKey={n} fill={PALETTE[i % PALETTE.length]} radius={[3, 3, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (widget.type === "area") {
    return (
      <ResponsiveContainer width="100%" height={192}>
        <AreaChart data={rows} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" {...axisProps} />
          <YAxis {...axisProps} />
          <Tooltip contentStyle={tooltipStyle} />
          {names.map((n, i) => (
            <Area
              key={n}
              dataKey={n}
              stroke={PALETTE[i % PALETTE.length]}
              fill={PALETTE[i % PALETTE.length]}
              fillOpacity={0.14}
              strokeWidth={1.75}
              connectNulls
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={192}>
      <LineChart data={rows} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis {...axisProps} />
        <Tooltip contentStyle={tooltipStyle} />
        {names.map((n, i) => (
          <Line
            key={n}
            dataKey={n}
            stroke={PALETTE[i % PALETTE.length]}
            strokeWidth={1.75}
            dot={false}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
