import React from "react";
import {Badge} from "@/components/ui/badge";
import {REQUEST_TYPES} from "@/features/autoDrafter/requestClassification";

const tones = {
  amber: "border-amber-300 bg-amber-50 text-amber-900",
  blue: "border-blue-300 bg-blue-50 text-blue-800",
  teal: "border-teal-300 bg-teal-50 text-teal-800",
  violet: "border-violet-300 bg-violet-50 text-violet-800",
  orange: "border-orange-300 bg-orange-50 text-orange-900",
  rose: "border-rose-300 bg-rose-50 text-rose-800",
  green: "border-emerald-300 bg-emerald-50 text-emerald-800",
  neutral: "border-border bg-muted text-muted-foreground"
};

export default function RequestTypeBadge({classification}) {
  if (!classification || classification.type === "no_panel") return null;
  const category = REQUEST_TYPES.find(option => option.value === classification.type);
  if (!category) return null;
  return <Badge variant="outline" title={classification.reason}
    className={`text-xs whitespace-normal ${tones[category.tone]}`}>
    {category.label}
  </Badge>;
}
