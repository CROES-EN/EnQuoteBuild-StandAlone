import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserCircle, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";

export default function EditMyName({ currentUser }) {
  const [editing, setEditing] = useState(false);
  const nameParts = (currentUser?.full_name || "").split(" ");
  const [firstName, setFirstName] = useState(nameParts[0] || "");
  const [lastName, setLastName] = useState(nameParts.slice(1).join(" ") || "");
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: () => base44.auth.updateMe({ full_name: [firstName, lastName].filter(Boolean).join(" ") }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["currentUser"] });
      setEditing(false);
      toast.success("Display name updated!");
    },
    onError: () => toast.error("Failed to update name")
  });

  if (!currentUser) return null;

  return (
    <Card className="p-4 border-slate-200 mb-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <UserCircle className="w-4 h-4 text-slate-500" />
          <span className="text-sm font-medium text-slate-700">Display Name</span>
        </div>
        {!editing && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)} className="h-7 text-xs text-slate-500 hover:text-indigo-600">
            <Pencil className="w-3 h-3 mr-1" /> Edit
          </Button>
        )}
      </div>

      {editing ? (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-slate-500">First Name</Label>
              <Input value={firstName} onChange={e => setFirstName(e.target.value)} className="mt-1 h-8 text-sm" placeholder="First" />
            </div>
            <div>
              <Label className="text-xs text-slate-500">Last Name</Label>
              <Input value={lastName} onChange={e => setLastName(e.target.value)} className="mt-1 h-8 text-sm" placeholder="Last" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="h-7 bg-indigo-600 hover:bg-indigo-700 text-xs" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              <Check className="w-3 h-3 mr-1" /> Save
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(false)}>
              <X className="w-3 h-3 mr-1" /> Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-1 text-slate-900 font-semibold">{currentUser.full_name || <span className="text-slate-400 italic text-sm">No name set</span>}</p>
      )}
    </Card>
  );
}