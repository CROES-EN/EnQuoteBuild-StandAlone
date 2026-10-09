import React, {useMemo} from "react";
import DOMPurify from "dompurify";
import {cn} from "@/lib/utils";

export function sanitizeSopHtml(value) {
  const fragment = DOMPurify.sanitize(value || "", {RETURN_DOM_FRAGMENT: true});
  for (const link of fragment.querySelectorAll("a[href]")) {
    if (link.getAttribute("href").trim().startsWith("#")) {
      link.removeAttribute("target");
    } else {
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
    }
  }
  const container = document.createElement("div");
  container.append(fragment);
  return container.innerHTML;
}

export default function SopRichContent({html, className}) {
  const sanitized = useMemo(() => sanitizeSopHtml(html), [html]);
  function handleClick(event) {
    const link = event.target.closest?.("a[href]");
    if (!link || !event.currentTarget.contains(link)) return;
    const href = link.getAttribute("href").trim();
    if (!href.startsWith("#")) return;
    event.preventDefault();
    const target = [...event.currentTarget.querySelectorAll("[id], a[name]")]
      .find(element => `#${element.id}` === href || `#${element.getAttribute("name")}` === href);
    target?.scrollIntoView({block: "start"});
  }
  return <div className={cn("sop-content", className)} onClick={handleClick} dangerouslySetInnerHTML={{__html: sanitized}} />;
}
