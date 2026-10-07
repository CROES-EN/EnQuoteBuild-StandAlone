import {useEffect, useState} from "react";
import {createPortal} from "react-dom";
import {useLocation, useNavigate} from "react-router-dom";
import {toast} from "sonner";
import {APP_LINK_QUERY, validAppTarget} from "../../../shared/appLinkRules.js";
import {currentAppLinkRequest, describeAppElement, findAppElement, finishAppLinkSelection, glowSharedElement, onAppLinkPickingChanged, pickAppElement} from "@/features/collab/appLinkSelection";
import {onUserSessionChanged} from "@/lib/userScopedStorage";

export default function AppLinkSharing() {
  const [request, setRequest] = useState(currentAppLinkRequest);
  const [rectangle, setRectangle] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => onAppLinkPickingChanged(setRequest), []);
  useEffect(() => onUserSessionChanged(() => finishAppLinkSelection()), []);
  useEffect(() => {
    if (!request) {setRectangle(null); return undefined;}
    let candidate = null;
    const move = event => {
      const element = document.elementFromPoint(event.clientX, event.clientY);
      candidate = element?.closest("main") ? pickAppElement(element) : null;
      setRectangle(candidate?.getBoundingClientRect() || null);
    };
    const stop = event => {event.preventDefault(); event.stopImmediatePropagation();};
    const click = event => {
      if (event.target.closest("[data-app-link-picker]")) return;
      stop(event);
      const element = event.target.closest("main") ? pickAppElement(event.target) : null;
      if (!element) {toast.error("Select something in the page content, or press Escape to cancel."); return;}
      try {
        const attachment = describeAppElement(element, `${location.pathname}${location.search}`);
        finishAppLinkSelection(attachment);
        toast.success("EnQuote link added to your message.");
      } catch (error) {toast.error(error.message);}
    };
    const key = event => {
      if (event.key === "Escape") {stop(event); finishAppLinkSelection();}
      else if (event.key === "Enter" || event.key === " ") stop(event);
    };
    const pointerDown = event => {
      if (!event.target.closest("[data-app-link-picker]")) stop(event);
    };
    const scroll = () => setRectangle(candidate?.getBoundingClientRect() || null);
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerdown", pointerDown, true);
    document.addEventListener("click", click, true);
    document.addEventListener("keydown", key, true);
    document.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerdown", pointerDown, true);
      document.removeEventListener("click", click, true);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("scroll", scroll, true);
    };
  }, [request, location.pathname, location.search]);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const value = params.get(APP_LINK_QUERY);
    if (!value) return undefined;
    let target;
    try {target = JSON.parse(value);} catch {toast.error("This EnQuote link has an invalid highlight target."); return undefined;}
    if (!validAppTarget(target)) {toast.error("This EnQuote link has an invalid highlight target."); return undefined;}
    let done = false;
    let stopGlow = () => {};
    let timeout;
    const removeQuery = () => {
      params.delete(APP_LINK_QUERY);
      navigate(`${location.pathname}${params.size ? `?${params}` : ""}`, {replace: true});
    };
    const observer = new MutationObserver(() => attempt());
    const attempt = () => {
      if (done) return;
      const main = document.querySelector("main");
      const element = main && findAppElement(main, target);
      if (!element) return;
      done = true;
      observer.disconnect();
      clearTimeout(timeout);
      stopGlow = glowSharedElement(element);
      timeout = setTimeout(removeQuery, 5000);
    };
    observer.observe(document.body, {childList: true, subtree: true, attributes: true});
    timeout = setTimeout(() => {
      done = true;
      observer.disconnect();
      toast.error("The shared item could not be found. It may have changed or you may not have access.");
      removeQuery();
    }, 10000);
    attempt();
    return () => {done = true; observer.disconnect(); clearTimeout(timeout); stopGlow();};
  }, [location.key, location.pathname, location.search, navigate]);
  if (!request) return null;
  return createPortal(<div className="pointer-events-none fixed inset-0 z-[49]">
    <div data-app-link-picker role="status" className="pointer-events-auto absolute left-1/2 top-4 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-lg border border-primary bg-card p-3 text-sm text-card-foreground shadow-lg">
      Pick an item on this page to share. Escape cancels.
      <button type="button" className="shrink-0 underline" onClick={() => finishAppLinkSelection()}>Cancel</button>
    </div>
    {rectangle && <div className="absolute border-2 border-primary bg-primary/10" style={{left: rectangle.left, top: rectangle.top, width: rectangle.width, height: rectangle.height}} />}
  </div>, document.body);
}
