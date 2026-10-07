import {X} from "lucide-react";
import CustomEmojiImage from "./CustomEmojiImage";
import ReactionIcon from "./ReactionIcon";

export default function EmojiAttachment({attachment, onRemove}) {
  return <span className="inline-flex items-center gap-2" title={`:${attachment.name}:`}>
    {attachment.type === "custom_emoji"
      ? <CustomEmojiImage id={attachment.emojiId} name={attachment.name} size={onRemove ? 24 : 48} />
      : <ReactionIcon reaction={attachment.emojiId} size={onRemove ? 24 : 48} />}
    {attachment.sourceGifId && <span className="text-[9px] opacity-70">GIPHY</span>}
    {onRemove && <><span className="text-xs">:{attachment.name}:</span>
      <button type="button" aria-label={`Remove ${attachment.name} emoji`} onClick={onRemove} className="rounded p-1 hover:bg-muted">
        <X className="h-3.5 w-3.5" />
      </button></>}
  </span>;
}
