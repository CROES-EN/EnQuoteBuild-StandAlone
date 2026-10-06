import {useEffect} from "react";
import {useLocation, useNavigate} from "react-router-dom";
import {useAuth} from "@/lib/AuthContext";
import {createSecretSequence} from "./sequence";

export default function SecretRetroShortcut() {
  const navigate = useNavigate();
  const location = useLocation();
  const {isAuthenticated} = useAuth();
  useEffect(() => {
    if (!isAuthenticated) return undefined;
    const handler = createSecretSequence(() => {
      if (location.pathname === "/Base44_DTO") return;
      navigate("/Base44_DTO", {state: {returnTo: location.pathname + location.search + location.hash}});
    });
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate, location, isAuthenticated]);
  return null;
}
