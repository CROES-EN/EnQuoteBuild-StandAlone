import React from "react";
import {Badge} from "@/components/ui/badge";
import {getRequestRoutingFlags} from "@/features/autoDrafter/requestRoutingFlags";

export default function RequestRoutingBadges({comment, careEligibility, flags, showDetails = false}) {
  const routingFlags = flags ?? getRequestRoutingFlags(comment, careEligibility);
  if (showDetails) return <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
    {routingFlags.map(flag => <li key={flag.code} className="space-y-1">
      <Badge variant="outline" className="text-xs whitespace-normal border-indigo-300 text-indigo-700">{flag.label}</Badge>
      <p className="text-muted-foreground">{flag.reason}</p>
    </li>)}
  </ul>;
  return <div className="flex flex-wrap gap-1">
    {routingFlags.map(flag => <Badge key={flag.code} variant="outline"
      className="text-xs whitespace-normal border-indigo-300 text-indigo-700" title={flag.reason}>{flag.label}</Badge>)}
  </div>;
}
