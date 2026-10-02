import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import FstRouteFinder from "@/components/resourcePlanner/FstRouteFinder";

// Drop-in "find the nearest FST" popup for any screen. Pass the site address to prefill
// (and auto-run) the search; the user can still edit it and search again.
export default function FstFinderDialog({ open, onOpenChange, initialAddress = "", title = "Find Nearest FST" }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Ranks field technicians by drive time to the site address.</DialogDescription>
        </DialogHeader>
        {open && <FstRouteFinder initialAddress={initialAddress} autoSearch />}
      </DialogContent>
    </Dialog>
  );
}
