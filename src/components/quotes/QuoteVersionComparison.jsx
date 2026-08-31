import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { getQuotes } from "@/api/dataClient";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GitCompare, XCircle, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

function FieldComparison({ label, oldValue, newValue }) {
  const hasChanged = JSON.stringify(oldValue) !== JSON.stringify(newValue);
  
  if (!hasChanged) return null;
  
  return (
    <div className="border-l-2 border-amber-400 pl-4 py-2">
      <p className="text-sm font-medium text-slate-700 mb-2">{label}</p>
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-rose-50 rounded-lg p-3">
          <p className="text-xs text-rose-600 font-medium mb-1">Previous</p>
          <p className="text-sm text-slate-900">{String(oldValue || '-')}</p>
        </div>
        <div className="bg-emerald-50 rounded-lg p-3">
          <p className="text-xs text-emerald-600 font-medium mb-1">Updated</p>
          <p className="text-sm text-slate-900">{String(newValue || '-')}</p>
        </div>
      </div>
    </div>
  );
}

function ItemsComparison({ oldItems = [], newItems = [] }) {
  const oldItemsStr = JSON.stringify(oldItems);
  const newItemsStr = JSON.stringify(newItems);
  
  if (oldItemsStr === newItemsStr) return null;
  
  return (
    <div className="border-l-2 border-amber-400 pl-4 py-2">
      <p className="text-sm font-medium text-slate-700 mb-2">Line Items</p>
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-rose-50 rounded-lg p-3">
          <p className="text-xs text-rose-600 font-medium mb-2">Previous</p>
          <div className="space-y-1">
            {oldItems.map((item, idx) => (
              <div key={idx} className="text-xs text-slate-700">
                {item.name} - ${item.total?.toFixed(2)}
              </div>
            ))}
          </div>
        </div>
        <div className="bg-emerald-50 rounded-lg p-3">
          <p className="text-xs text-emerald-600 font-medium mb-2">Updated</p>
          <div className="space-y-1">
            {newItems.map((item, idx) => (
              <div key={idx} className="text-xs text-slate-700">
                {item.name} - ${item.total?.toFixed(2)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function QuoteVersionComparison({ quote }) {
  const [showComparison, setShowComparison] = useState(false);
  const [compareVersionId, setCompareVersionId] = useState("");
  
  const parentQuoteId = quote.parent_quote_id || quote.id;
  
  const { data: versions = [] } = useQuery({
    queryKey: ["quote-versions", parentQuoteId],
    queryFn: async () => {
      const allQuotes = await getQuotes();
      const allVersions = allQuotes.filter(q => q.id === parentQuoteId || q.parent_quote_id === parentQuoteId);
      return allVersions.sort((a, b) => (b.version_number || 1) - (a.version_number || 1));
    }
  });
  
  const compareVersion = versions.find(v => v.id === compareVersionId);
  
  if (versions.length <= 1) return null;
  
  return (
    <>
      <Card className="p-6 border-slate-200 mt-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <GitCompare className="w-5 h-5" />
            Compare Versions
          </h3>
          <Button 
            onClick={() => setShowComparison(true)}
            variant="outline"
            size="sm"
          >
            View Changes
          </Button>
        </div>
        
        {/* Show rejection reasons from all versions */}
        <div className="space-y-3">
          {versions.filter(v => v.rejection_reason || v.ho_rejection_reason).map((v) => (
            <div key={v.id} className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className="text-xs">
                      Version {v.version_number}
                    </Badge>
                    {v.rejection_reason && (
                      <span className="text-xs font-medium text-amber-800">Rejection Feedback</span>
                    )}
                    {v.ho_rejection_reason && (
                      <span className="text-xs font-medium text-amber-800">HO Rejection Feedback</span>
                    )}
                  </div>
                  {v.rejection_reason && (
                    <p className="text-sm text-amber-900">{v.rejection_reason}</p>
                  )}
                  {v.ho_rejection_reason && (
                    <p className="text-sm text-amber-900">{v.ho_rejection_reason}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
      
      <Dialog open={showComparison} onOpenChange={setShowComparison}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Compare Quote Versions</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="text-sm text-slate-600 mb-2 block">
                  Compare Current Version with:
                </label>
                <Select value={compareVersionId} onValueChange={setCompareVersionId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a version" />
                  </SelectTrigger>
                  <SelectContent>
                    {versions.filter(v => v.id !== quote.id).map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        Version {v.version_number} - {v.status} - ${v.total?.toFixed(2)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            {compareVersion && (
              <div className="space-y-4 pt-4">
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                  <div className="flex-1">
                    <p className="text-sm text-slate-600">Comparing</p>
                    <p className="font-medium">
                      Version {compareVersion.version_number} → Version {quote.version_number}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Badge variant="outline">{compareVersion.status}</Badge>
                    <span>→</span>
                    <Badge variant="outline">{quote.status}</Badge>
                  </div>
                </div>
                
                {/* Show rejection reasons if they exist */}
                {compareVersion.rejection_reason && (
                  <div className="bg-rose-50 border border-rose-200 rounded-lg p-4">
                    <div className="flex items-start gap-2">
                      <XCircle className="w-5 h-5 text-rose-600 mt-0.5" />
                      <div>
                        <p className="font-medium text-rose-800">Rejection Reason (v{compareVersion.version_number})</p>
                        <p className="text-rose-700 mt-1">{compareVersion.rejection_reason}</p>
                      </div>
                    </div>
                  </div>
                )}
                
                {compareVersion.ho_rejection_reason && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <div className="flex items-start gap-2">
                      <XCircle className="w-5 h-5 text-red-600 mt-0.5" />
                      <div>
                        <p className="font-medium text-red-800">HO Rejection Reason (v{compareVersion.version_number})</p>
                        <p className="text-red-700 mt-1">{compareVersion.ho_rejection_reason}</p>
                      </div>
                    </div>
                  </div>
                )}
                
                <div className="space-y-4">
                  <h4 className="font-semibold text-slate-900">Changes Made</h4>
                  
                  <FieldComparison 
                    label="Site ID"
                    oldValue={compareVersion.site_id}
                    newValue={quote.site_id}
                  />
                  
                  <FieldComparison 
                    label="Case Number"
                    oldValue={compareVersion.case_number}
                    newValue={quote.case_number}
                  />
                  
                  <FieldComparison 
                    label="FST Count"
                    oldValue={compareVersion.fst_count}
                    newValue={quote.fst_count}
                  />
                  
                  <FieldComparison 
                    label="Labor Hours"
                    oldValue={compareVersion.labor_hours}
                    newValue={quote.labor_hours}
                  />
                  
                  <FieldComparison 
                    label="Labor Rate"
                    oldValue={`$${compareVersion.labor_rate || 125}`}
                    newValue={`$${quote.labor_rate || 125}`}
                  />
                  
                  <FieldComparison 
                    label="Travel Hours"
                    oldValue={compareVersion.travel_hours}
                    newValue={quote.travel_hours}
                  />
                  
                  <FieldComparison 
                    label="Miles Traveled"
                    oldValue={compareVersion.miles_traveled}
                    newValue={quote.miles_traveled}
                  />
                  
                  <FieldComparison 
                    label="Scope of Work"
                    oldValue={compareVersion.scope_of_work}
                    newValue={quote.scope_of_work}
                  />
                  
                  <ItemsComparison 
                    oldItems={compareVersion.items}
                    newItems={quote.items}
                  />
                  
                  <FieldComparison 
                    label="Discount %"
                    oldValue={`${compareVersion.discount_percent || 0}%`}
                    newValue={`${quote.discount_percent || 0}%`}
                  />
                  
                  <FieldComparison 
                    label="Federal Tax %"
                    oldValue={`${compareVersion.federal_tax_percent || 0}%`}
                    newValue={`${quote.federal_tax_percent || 0}%`}
                  />
                  
                  <FieldComparison 
                    label="State Tax %"
                    oldValue={`${compareVersion.state_tax_percent || 0}%`}
                    newValue={`${quote.state_tax_percent || 0}%`}
                  />
                  
                  <FieldComparison 
                    label="Local Tax %"
                    oldValue={`${compareVersion.local_tax_percent || 0}%`}
                    newValue={`${quote.local_tax_percent || 0}%`}
                  />
                  
                  <FieldComparison 
                    label="Total"
                    oldValue={`$${compareVersion.total?.toFixed(2)}`}
                    newValue={`$${quote.total?.toFixed(2)}`}
                  />
                  
                  <FieldComparison 
                    label="Notes"
                    oldValue={compareVersion.notes}
                    newValue={quote.notes}
                  />
                  
                  {/* No changes detected */}
                  {!compareVersion.site_id && !compareVersion.case_number && (
                    <div className="text-center py-8 text-slate-500">
                      <p>No significant changes detected between these versions.</p>
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {!compareVersion && (
              <div className="text-center py-12 text-slate-500">
                <GitCompare className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                <p>Select a version to compare changes</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}