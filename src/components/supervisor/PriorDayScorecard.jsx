import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {Badge} from "@/components/ui/badge";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {FileText, Mail, Minus, Phone, TrendingDown, TrendingUp, Users} from "lucide-react";
import {computeDelta, formatDateLabel, formatNumber, formatSecondsAsClock} from "@/features/supervisorDashboard/format";

const SOURCE_LABELS = {
  cxone: "CXONE",
  nice_wfm: "NICE WFM",
  salesforce: "Salesforce",
  incorta: "Incorta",
  care_tracker: "Care Tracker",
  escalations_tracker: "Escalations Tracker",
  other: "Other Report",
  manual: "Manual Entry"
};

// Merged records omit fields no import/edit has ever supplied (see opsMetricsStore's
// withoutBlankValues), so those fields read back as `undefined`, not `null` - a strict
// `!== null` check alone would incorrectly treat that as "has a value".
function hasValue(value) {
  return value !== null && value !== undefined;
}

function DeltaBadge({ delta }) {
  if (!delta) return <span className="text-xs text-muted-foreground">No prior data</span>;
  if (delta.trend === "flat") {
    return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Minus className="w-3 h-3" /> No change</span>;
  }

  const isGood = delta.direction === "neutral" ? null : (delta.direction === "higherIsBetter" ? delta.trend === "up" : delta.trend === "down");
  const colorClass = isGood === null ? "text-muted-foreground" : (isGood ? "text-emerald-600" : "text-rose-600");
  const Icon = delta.trend === "up" ? TrendingUp : TrendingDown;
  const sign = delta.change > 0 ? "+" : "";

  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${colorClass}`}>
      <Icon className="w-3 h-3" />
      {sign}{formatNumber(delta.change)}{delta.percent !== null ? ` (${sign}${delta.percent}%)` : ""} vs prior day
    </span>
  );
}

function MetricRow({ icon: Icon, iconClass, label, value, subLabel, delta, sourceBadges }) {
  return (
    <div className="flex items-start justify-between gap-4 py-4 border-b border-border last:border-0">
      <div className="flex items-start gap-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${iconClass}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold text-foreground mt-0.5">{value}</p>
          {subLabel && <p className="text-xs text-muted-foreground mt-0.5">{subLabel}</p>}
          <div className="mt-1"><DeltaBadge delta={delta} /></div>
        </div>
      </div>
      {sourceBadges?.length > 0 && (
        <div className="flex flex-col gap-1 items-end shrink-0">
          {sourceBadges.map(src => (
            <Badge key={src} variant="outline" className="text-[10px] py-0 px-1.5 text-muted-foreground border-border">
              {SOURCE_LABELS[src] || src}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Renders the supervisor's "Prior Day Results" template:
 *   Calls + AHT / Emails Worked / Quotes Drafted / Staffing
 * with a day-over-day delta against the closest earlier day that has data.
 */
export default function PriorDayScorecard({ records, selectedDate, onSelectedDateChange }) {
  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));
  const currentIndex = selectedDate
    ? sorted.findIndex(r => r.date === selectedDate)
    : sorted.length - 1;
  const current = currentIndex >= 0 ? sorted[currentIndex] : null;
  const previous = currentIndex > 0 ? sorted[currentIndex - 1] : null;

  if (!current) {
    return (
      <Card className="border-border">
        <CardHeader><CardTitle className="text-base">Prior Day Results</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No daily metrics yet. Import a CXONE/Salesforce report or add a day manually to get started.
          </p>
        </CardContent>
      </Card>
    );
  }

  const sources = Object.keys(current.sources || {});
  const callsAhtSources = sources.filter(s => current.sources[s] && (hasValue(current.calls) || hasValue(current.aht_seconds)));

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Prior Day Results</CardTitle>
          <Select value={current.date} onValueChange={onSelectedDateChange}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {sorted.slice().reverse().map(r => (
                <SelectItem key={r.date} value={r.date}>{formatDateLabel(r.date)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-sm text-muted-foreground">{formatDateLabel(current.date)}</p>
      </CardHeader>
      <CardContent className="pt-0">
        <MetricRow
          icon={Phone}
          iconClass="bg-indigo-50 text-indigo-600"
          label="Calls + AHT"
          value={`${formatNumber(current.calls)} calls · ${formatSecondsAsClock(current.aht_seconds)} avg`}
          delta={computeDelta(current.calls, previous?.calls, "higherIsBetter")}
          sourceBadges={callsAhtSources}
        />
        <MetricRow
          icon={Mail}
          iconClass="bg-sky-50 text-sky-600"
          label="Emails Worked"
          value={formatNumber(current.emails_worked)}
          delta={computeDelta(current.emails_worked, previous?.emails_worked, "higherIsBetter")}
          sourceBadges={sources.filter(s => current.sources[s] && hasValue(current.emails_worked))}
        />
        <MetricRow
          icon={FileText}
          iconClass="bg-amber-50 text-amber-600"
          label="Quotes Drafted"
          value={formatNumber(current.quotes_drafted)}
          delta={computeDelta(current.quotes_drafted, previous?.quotes_drafted, "higherIsBetter")}
          sourceBadges={sources.filter(s => current.sources[s] && hasValue(current.quotes_drafted))}
        />
        <MetricRow
          icon={Users}
          iconClass="bg-emerald-50 text-emerald-600"
          label="Staffing"
          value={formatNumber(current.staffing_present)}
          subLabel={current.staffing_scheduled ? `${formatNumber(current.staffing_present)} of ${formatNumber(current.staffing_scheduled)} scheduled` : null}
          delta={computeDelta(current.staffing_present, previous?.staffing_present, "neutral")}
          sourceBadges={sources.filter(s => current.sources[s] && hasValue(current.staffing_present))}
        />
        {current.notes && (
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Notes</p>
            <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{current.notes}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
