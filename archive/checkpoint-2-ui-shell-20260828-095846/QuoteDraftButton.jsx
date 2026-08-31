import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import QuoteDraftModal from "./QuoteDraftModal";

export default function QuoteDraftButton({ quote, onApply }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)} className="border-indigo-300 text-indigo-700 hover:bg-indigo-50">
        <Sparkles className="mr-2 h-4 w-4" /> Draft with AI
      </Button>
      <QuoteDraftModal quote={quote} open={open} onOpenChange={setOpen} onApply={onApply} />
    </>
  );
}

