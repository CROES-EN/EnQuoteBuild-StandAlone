import {useEffect, useState} from "react";
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {Button} from "@/components/ui/button";
import DebuggingConsole from "@/components/DebuggingConsole";

export default function ViewingDebuggingConsole() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const handler = event => {
      if (event.code === "Backquote" && event.shiftKey) setOpen(value => !value);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>Debugging Console</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Viewing-session diagnostics</DialogTitle>
            <DialogDescription>Tests this local viewing window with the selected user&apos;s permissions. It cannot access their private messages, tasks, device or installed code.</DialogDescription>
          </DialogHeader>
          <DebuggingConsole />
        </DialogContent>
      </Dialog>
    </>
  );
}
