import {createContext, useContext, useEffect} from "react";
import {useAuth} from "@/lib/AuthContext";
import {useAccessPolicy} from "./adminApi";
import {canPreviewUserAccess} from "./accessPreview";
import {isReadonlyViewing} from "./readonlyViewing";
import {toast} from "sonner";
import {startDesktopViewing} from "./viewingAvailability";

const AccessPreviewContext = createContext(null);

export function AccessPreviewProvider({children}) {
  const {user: actor, isAuthenticated} = useAuth();
  const policyState = useAccessPolicy();
  const authorized = !isReadonlyViewing() && isAuthenticated && canPreviewUserAccess(actor, policyState);
  useEffect(() => {
    const subscribe = window.enquoteLocal?.viewing?.onEnded;
    if (isReadonlyViewing() || !subscribe) return undefined;
    return subscribe(({reason}) => toast.error(`Viewing mode ended: ${reason}`));
  }, []);

  async function startPreview(snapshot, targetEmail) {
    if (!authorized) throw new Error("A live, verified Super Admin policy is required.");
    if (snapshot?.ok !== true || snapshot.offline || !Array.isArray(snapshot.users)) {
      throw new Error("A live service account snapshot is required.");
    }
    if (!snapshot.users.some(user => user?.email === targetEmail)) throw new Error("The selected account is no longer available.");
    await startDesktopViewing(targetEmail);
  }

  return (
    <AccessPreviewContext.Provider value={{
      actor, policyState, canPreview: Boolean(authorized),
      startPreview
    }}>
      {children}
    </AccessPreviewContext.Provider>
  );
}

export function useAccessPreview() {
  const context = useContext(AccessPreviewContext);
  if (!context) throw new Error("Access preview requires AccessPreviewProvider.");
  return context;
}
