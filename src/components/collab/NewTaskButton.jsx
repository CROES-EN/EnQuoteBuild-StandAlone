import {useEffect, useState} from "react";
import {ClipboardList} from "lucide-react";
import {useAuth} from "@/lib/AuthContext";
import {useAccessPolicy} from "@/features/admin/adminApi";
import {canAccessPage} from "@/lib/rolePageAccess";
import {isReadonlyViewing} from "@/features/admin/readonlyViewing";
import TaskDialog from "./TaskDialog";
import {getCurrentUserNamespace, onUserSessionChanged} from "@/lib/userScopedStorage";

export default function NewTaskButton() {
  const {user, isAuthenticated} = useAuth();
  const {policy, loading, error} = useAccessPolicy();
  const [open, setOpen] = useState(false);
  const [owner, setOwner] = useState(getCurrentUserNamespace);
  useEffect(() => onUserSessionChanged(() => {
    setOpen(false);
    setOwner(getCurrentUserNamespace());
  }), []);
  if (isReadonlyViewing() || !isAuthenticated || loading || error || !canAccessPage(user, "Tasks", policy)) return null;
  return (
    <>
      <button
        type="button"
        aria-label="New task"
        title="New task"
        onClick={() => setOpen(true)}
        className="fixed top-16 right-4 z-50 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card shadow-lg transition hover:bg-accent"
      >
        <ClipboardList className="h-5 w-5 text-foreground" />
      </button>
      <TaskDialog key={owner} open={open} onOpenChange={setOpen} presentation="panel"
        allowAssignment={canAccessPage(user, "Messages", policy)} />
    </>
  );
}
