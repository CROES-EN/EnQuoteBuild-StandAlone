import {useEffect, useState} from "react";
import {Receipt} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from "@/components/ui/dialog";

/**
 * mode "mark": HO Approved -> Invoiced (collects the invoice number).
 * mode "edit": correct the recorded invoice number without changing status or Stripe details.
 */
export default function InvoiceNumberDialog({open, mode = "edit", initialValue = "", quoteLabel = "", isSaving = false, onSubmit, onOpenChange}) {
  const [value, setValue] = useState(initialValue);
  useEffect(() => {
    if (open) setValue(initialValue || "");
  }, [open, initialValue]);
  const isEdit = mode === "edit";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Invoice Number" : "Mark as Invoiced"}{quoteLabel ? ` - ${quoteLabel}` : ""}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Correct the invoice number recorded for this quote. Status and Stripe payment details will not be changed."
              : "Enter the invoice number sent to the homeowner. Stripe transaction and invoice IDs are recorded separately when the quote is marked as paid."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (value.trim() && !isSaving) onSubmit?.(value.trim());
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="invoiceNumber">Invoice Number</Label>
            <Input
              id="invoiceNumber"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="e.g., INV-12345"
              autoFocus
              data-invoice-number-input
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange?.(false)}>Cancel</Button>
            <Button
              type="submit"
              disabled={!value.trim() || isSaving}
              className="bg-indigo-600 hover:bg-indigo-700"
              data-invoice-number-submit
            >
              <Receipt className="w-4 h-4 mr-2" />
              {isSaving ? "Saving..." : isEdit ? "Save Invoice Number" : "Mark as Invoiced"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
