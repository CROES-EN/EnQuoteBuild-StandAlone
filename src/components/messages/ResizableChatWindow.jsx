import {useEffect, useRef, useState} from "react";
import {clampChatWindowSize} from "@/features/collab/chatWindowSize";
import {cn} from "@/lib/utils";
import {motion, useReducedMotion} from "framer-motion";

const viewport = () => ({width: window.innerWidth, height: window.innerHeight});

export default function ResizableChatWindow({title, visible, children, sharedSize, onResizeAll}) {
  const reducedMotion = useReducedMotion();
  const [size, setSize] = useState(() => clampChatWindowSize({width: 380, height: 540}, viewport()));
  const drag = useRef(null);
  useEffect(() => {
    const resize = () => setSize(current => clampChatWindowSize(current, viewport()));
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => { if (!visible) drag.current = null; }, [visible]);
  useEffect(() => {
    if (sharedSize) setSize(clampChatWindowSize(sharedSize, viewport()));
  }, [sharedSize]);
  return (
    <motion.section aria-label={`Chat with ${title}`} style={{...size, display: visible ? undefined : "none"}}
      aria-hidden={!visible} inert={visible ? undefined : ""}
      initial={{opacity: 0, x: reducedMotion ? 0 : 16}}
      animate={visible ? {opacity: 1, x: 0, display: "flex"} : {opacity: 0, x: 0, display: "none"}}
      exit={{opacity: 0, x: reducedMotion ? 0 : 16, pointerEvents: "none"}}
      transition={{duration: reducedMotion ? 0 : 0.16, ease: "easeOut"}}
      className={cn("flex shrink-0 flex-col overflow-hidden border border-border bg-card text-card-foreground shadow-lg",
        visible ? "pointer-events-auto relative" : "pointer-events-none absolute bottom-0 right-0")}>
      <button type="button" aria-label={`Resize chat with ${title}`} title="Drag to resize; hold Shift to resize all chats. Arrow keys also resize."
        className="absolute left-0 top-0 z-10 h-4 w-4 touch-none cursor-nwse-resize rounded-tl border-l-2 border-t-2 border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {x: event.clientX, y: event.clientY, ...size};
        }}
        onPointerMove={event => {
          if (!drag.current) return;
          const next = clampChatWindowSize({
            width: drag.current.width + drag.current.x - event.clientX,
            height: drag.current.height + drag.current.y - event.clientY
          }, viewport());
          setSize(next);
          if (event.shiftKey) onResizeAll?.(next);
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        onLostPointerCapture={() => { drag.current = null; }}
        onKeyDown={event => {
          const change = {ArrowLeft: [20, 0], ArrowRight: [-20, 0], ArrowUp: [0, 20], ArrowDown: [0, -20]}[event.key];
          if (!change) return;
          event.preventDefault();
          setSize(current => clampChatWindowSize({width: current.width + change[0], height: current.height + change[1]}, viewport()));
        }} />
      {children}
    </motion.section>
  );
}
