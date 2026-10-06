import {useEffect, useRef, useState} from "react";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis
} from "recharts";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {activityChartData, agingChartData, turnaroundChartData} from "@/features/quoteDashboard/quoteChartData";
import {statusLabel} from "@/features/quoteDashboard/quoteLifecycle";

const axis = {fontSize: 11, fill: "hsl(var(--muted-foreground))"};

function CategoryTick({x, y, payload}) {
  const lines = [];
  for (const word of String(payload.value).split(" ")) {
    const last = lines.length - 1;
    if (last >= 0 && `${lines[last]} ${word}`.length <= 16) lines[last] += ` ${word}`;
    else lines.push(word);
  }
  return <text x={x} y={y} textAnchor="middle" style={axis}>
    {lines.map((line, index) => <tspan key={index} x={x} dy={index === 0 ? 14 : 13}>{line}</tspan>)}
  </text>;
}

function PipelineTick({x, y, payload}) {
  const label = String(payload.value);
  return <text x={x} y={y + 8} transform={`rotate(-65, ${x}, ${y + 8})`}
    textAnchor="end" style={{...axis, fontSize: 9}}>
    <title>{label}</title>
    {label.length > 18 ? `${label.slice(0, 17)}…` : label}
  </text>;
}

function ChartHover({active, label, payload, onChange}) {
  useEffect(() => {
    const point = payload?.[0]?.payload;
    const details = active && payload?.length ? {
      title: point?.name || label,
      rows: payload.map(item => ({
        name: item.name,
        value: String(item.dataKey).endsWith("Days") ? `${Number(item.value).toFixed(2)} days` : item.value,
        color: item.color
      })),
      samples: point?.averageDays !== undefined ? point.count : null
    } : null;
    onChange(previous => JSON.stringify(previous) === JSON.stringify(details) ? previous : details);
  }, [active, label, payload, onChange]);
  return null;
}

function HoverDetails({details, label}) {
  return <div className="w-2/5 shrink-0 min-h-16 text-right" aria-label={label}>
    {details && <>
      <p className="break-words text-xs font-medium">{details.title}</p>
      {details.rows.map(row => <p key={row.name} className="text-xs" style={{color: row.color}}>{row.name}: {row.value}</p>)}
      {details.samples !== null && <p className="text-xs text-muted-foreground">{details.samples} quotes</p>}
    </>}
  </div>;
}

function ChartCard({title, subtitle, empty, children, footer, headerAside}) {
  return <Card className="min-w-0">
    <CardHeader className="pb-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><CardTitle><h3>{title}</h3></CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
        </div>
        {headerAside}
      </div>
    </CardHeader>
    <CardContent>
      {empty ? <p className="flex h-64 items-center justify-center text-sm text-muted-foreground">{empty}</p> : children}
      {footer}
    </CardContent>
  </Card>;
}

export default function QuoteLifecycleCharts({report, range, onInspect}) {
  const [pipelineHover, setPipelineHover] = useState(null);
  const [activityHover, setActivityHover] = useState(null);
  const [turnaroundHover, setTurnaroundHover] = useState(null);
  const [agingHover, setAgingHover] = useState(null);
  const [categoryCount, setCategoryCount] = useState(4);
  const [turnaroundPage, setTurnaroundPage] = useState(0);
  const gridRef = useRef(null);
  useEffect(() => {
    const grid = gridRef.current;
    const measure = () => {
      const width = grid.firstElementChild.getBoundingClientRect().width - 48;
      setCategoryCount(Math.max(1, Math.min(8, Math.floor((width - 50) / 105))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, []);
  const activity = activityChartData(report.daily, range);
  const pipeline = [...report.statuses].sort((a, b) => b.count - a.count)
    .map(row => ({...row, name: statusLabel(row.status)}));
  const allTurnaround = turnaroundChartData(report.durations);
  const turnaroundIndex = Math.min(turnaroundPage, Math.max(0, Math.ceil(allTurnaround.length / categoryCount) - 1));
  const turnaround = allTurnaround.slice(turnaroundIndex * categoryCount, (turnaroundIndex + 1) * categoryCount);
  const agingLabels = ["<1d", "1-3d", "3-7d", "7-14d", "14+d", "?"];
  const aging = agingChartData(report.timelines).map((row, index) => ({...row, axisLabel: agingLabels[index]}));
  function categoryPages(page, total, setter, label) {
    if (total <= categoryCount) return null;
    return <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <Button size="sm" variant="outline" aria-label={`Previous ${label}`} disabled={page === 0} onClick={() => setter(page - 1)}>Previous</Button>
      <span>{page * categoryCount + 1}-{Math.min((page + 1) * categoryCount, total)} of {total}</span>
      <Button size="sm" variant="outline" aria-label={`Next ${label}`} disabled={(page + 1) * categoryCount >= total} onClick={() => setter(page + 1)}>Next</Button>
    </div>;
  }
  return <div ref={gridRef} className="grid grid-cols-1 gap-4 xl:grid-cols-2">
    <ChartCard title="Quote activity over time" subtitle={`New quotes and Status History transitions · ${activity.interval} totals`}
      headerAside={<HoverDetails details={activityHover} label="Activity hover details" />}
      empty={!report.daily.length && "No recorded activity in this period."}>
      <div role="img" aria-label="Quote activity chart: new quotes and status changes over time">
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={activity.data} margin={{top: 8, right: 12, left: -15, bottom: 0}} accessibilityLayer>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tick={axis} minTickGap={35} />
            <YAxis tick={axis} allowDecimals={false} />
            <Tooltip content={<ChartHover onChange={setActivityHover} />} /><Legend wrapperStyle={{fontSize: 12, width: "100%"}} />
            <Line type="linear" dataKey="created" name="New quotes" stroke="#6366f1" strokeWidth={2} dot={false} />
            <Line type="linear" dataKey="transitions" name="Status changes" stroke="#14b8a6" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
    <ChartCard title="Current quote pipeline" subtitle="Live quote counts · hover for details"
      headerAside={<HoverDetails details={pipelineHover} label="Pipeline hover details" />}
      empty={!pipeline.length && "No quotes match these filters."}
      footer={<>
        <Button variant="link" size="sm" onClick={() => onInspect("quotes")}>Explore quotes</Button>
      </>}>
      <div role="img" aria-label="Current quote pipeline chart grouped by status">
        <ResponsiveContainer width="100%" height={360}>
          <BarChart data={pipeline} margin={{top: 5, right: 12, left: 0, bottom: 0}} barCategoryGap="15%" accessibilityLayer>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" tick={<PipelineTick />} interval={0} height={130} />
            <YAxis tick={axis} allowDecimals={false} />
            <Tooltip content={<ChartHover onChange={setPipelineHover} />} />
            <Bar dataKey="count" name="Quotes" fill="#6366f1" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
    <ChartCard title="Status-to-status turnaround" subtitle="Last two statuses per quote · previous-stage days · all filtered quotes"
      headerAside={<HoverDetails details={turnaroundHover} label="Turnaround hover details" />}
      empty={!turnaround.length && "No measurable last-status intervals for these quotes."}
      footer={<>
        {categoryPages(turnaroundIndex, allTurnaround.length, setTurnaroundPage, "turnaround routes")}
        <Button size="sm" variant="link" onClick={() => onInspect("timing")}>Sample counts and exact timings</Button>
      </>}>
      <div role="img" aria-label="Stage turnaround chart comparing average and median days">
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={turnaround} margin={{top: 5, right: 12, left: -15, bottom: 0}} accessibilityLayer>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" tick={<CategoryTick />} interval={0} height={130} />
            <YAxis tick={axis} unit="d" />
            <Tooltip content={<ChartHover onChange={setTurnaroundHover} />} />
            <Legend wrapperStyle={{fontSize: 12, width: "100%"}} />
            <Bar dataKey="averageDays" name="Average" fill="#6366f1" radius={[3, 3, 0, 0]} />
            <Bar dataKey="medianDays" name="Median" fill="#14b8a6" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
    <ChartCard title="Time in current stage" subtitle="Live stage age from Status History · unknown dates remain separate"
      headerAside={<HoverDetails details={agingHover} label="Aging hover details" />}
      empty={!report.timelines.length && "No quotes match these filters."}
      footer={<Button size="sm" variant="link" onClick={() => onInspect("quotes")}>Review oldest quotes</Button>}>
      <div role="img" aria-label="Current stage aging chart including unknown durations">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={aging} margin={{top: 8, right: 20, left: -15, bottom: 0}} accessibilityLayer>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="axisLabel" tick={axis} interval={0} height={40} /><YAxis tick={axis} allowDecimals={false} />
            <Tooltip content={<ChartHover onChange={setAgingHover} />} />
            <Bar dataKey="count" name="Quotes" fill="#14b8a6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  </div>;
}
