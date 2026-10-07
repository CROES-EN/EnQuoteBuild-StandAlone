import {cn} from "@/lib/utils";

export function GifAttachment({attachment, edgeToEdge = false}) {
  const ratio = attachment.width && attachment.height ? attachment.height / attachment.width : 0.75;
  return (
    <a href={attachment.url} target="_blank" rel="noreferrer"
      className={cn("block w-[260px] max-w-full overflow-hidden",
        !edgeToEdge && "rounded-xl border border-white/20 bg-black/5")}>
      <img src={attachment.url} alt={attachment.title || "GIF"} loading="lazy"
        className="block w-full object-cover"
        style={{aspectRatio: ratio ? `${attachment.width || 1} / ${attachment.height || Math.round((attachment.width || 1) * ratio)}` : undefined}} />
    </a>
  );
}

export function isGifOnlyMessage(message) {
  return !message.body?.trim() && message.attachments?.length > 0 &&
    message.attachments.every(attachment => attachment.type === "gif");
}

export default function MessageBubble({message, mine, bubbleStyle, children}) {
  const gifOnly = isGifOnlyMessage(message);
  return (
    <div className={cn("rounded-2xl text-sm group-hover/message:ring-2 group-hover/message:ring-primary/50 group-focus-within/message:ring-2 group-focus-within/message:ring-primary/50",
      gifOnly ? "w-fit max-w-full overflow-hidden bg-transparent" : "space-y-1.5 px-3 py-2",
      message.status === "sending" && "opacity-70",
      message.status === "failed" && !gifOnly && "bg-destructive/10 text-destructive")}
      data-testid={mine ? "chat-bubble-mine" : "chat-bubble-theirs"}
      style={gifOnly || message.status === "failed" ? undefined : bubbleStyle}>
      {children}
    </div>
  );
}
