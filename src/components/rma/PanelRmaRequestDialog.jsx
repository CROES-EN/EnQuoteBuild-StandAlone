import {useQuery, useQueryClient} from "@tanstack/react-query";
import {useRef, useState} from "react";
import {createLocalRecord, getUsers, listLocalCollection, updateLocalRecord} from "@/api/dataClient";
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {Button} from "@/components/ui/button";
import {useUserRole} from "@/components/auth/RoleGuard";
import {saveRmaRecord, rmaCaseKey} from "@/features/rma/rmaRecords";
import RMAForm from "./RMAForm";
import {toast} from "sonner";

export default function PanelRmaRequestDialog({target, onClose}) {
  const {user} = useUserRole();
  const cache = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const baseline = useRef(null);
  const initialized = useRef(false);
  const query = useQuery({
    queryKey: ["panel-rma-request", target.caseNumber],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const [rmas, manufacturers, users] = await Promise.all([
        listLocalCollection("rmas"), listLocalCollection("pvManufacturers"), getUsers()
      ]);
      if (![rmas, manufacturers, users].every(Array.isArray)) throw new Error("Could not load the Panel RMA form data.");
      const matches = rmas.filter(record => rmaCaseKey(record.case_id) === rmaCaseKey(target.caseNumber));
      if (matches.length > 1) throw new Error("This case has multiple RMA entries. Resolve them in the PV Panel RMA Tracker before editing.");
      return {existing: matches[0] || null, manufacturers, users};
    }
  });
  if (query.data && !query.isFetching && !query.isError && !initialized.current) {
    baseline.current = query.data.existing;
    initialized.current = true;
  }
  async function save(formData) {
    setSaving(true);
    setError("");
    try {
      const saved = await saveRmaRecord({
        formData, existingRma: baseline.current, email: user?.email,
        source: {source_category: "panel_rma", source_case_number: String(target.caseNumber),
          ...(target.quoteId ? {source_quote_id: target.quoteId, source_quote_number: target.quoteNumber || ""} : {})}
      }, {list: listLocalCollection, create: createLocalRecord, update: updateLocalRecord});
      cache.setQueryData(["panel-rma-request", target.caseNumber], current => ({...current, existing: saved}));
      await Promise.all([cache.invalidateQueries({queryKey: ["pvPanelRMAs"]}),
        cache.invalidateQueries({queryKey: ["pvManufacturers"]})]);
      toast.success("Panel RMA saved; shared after desktop sync. Quote drafting is still available.");
      onClose();
    } catch (failure) {
      setError(failure.message);
      toast.error(failure.message);
    } finally {setSaving(false);}
  }
  const initial = baseline.current || {case_id: String(target.caseNumber), site_id: String(target.siteId || ""),
    case_owner: user?.email || "", current_status: "New", notes: target.notes || ""};
  return <Dialog open onOpenChange={open => {if (!open && !saving) onClose();}}>
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>{baseline.current ? "Edit linked Panel RMA" : "Submit Panel RMA request"}</DialogTitle>
        <DialogDescription>Creates or updates a tracker entry only; it does not submit to the manufacturer. Panel RMA and quote work are separate; this does not block drafting.</DialogDescription>
      </DialogHeader>
      {!initialized.current && (query.isLoading || query.isFetching) ? <p role="status">Loading Panel RMA form...</p> : query.isError ?
        <div role="alert">{query.error.message}<Button variant="outline" onClick={() => query.refetch()}>Retry</Button></div> :
        <RMAForm rma={initial} users={query.data.users} manufacturers={query.data.manufacturers}
          defaultOwner={user?.email} onSave={save} onCancel={onClose} isLoading={saving} />}
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </DialogContent>
  </Dialog>;
}
