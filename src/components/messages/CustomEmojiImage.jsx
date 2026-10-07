import {useQuery} from "@tanstack/react-query";
import {chatApi} from "@/features/collab/collabApi";
import {getCurrentUserNamespace} from "@/lib/userScopedStorage";
import {retryEmojiQuery} from "@/features/collab/customEmojis";

export default function CustomEmojiImage({id, name, size = 24}) {
  const image = useQuery({
    queryKey: ["custom-emoji-image", getCurrentUserNamespace(), id],
    queryFn: () => chatApi.getEmoji(id), staleTime: Infinity, retry: retryEmojiQuery
  });
  if (image.isError) return <span role="alert" title={image.error.message} className="text-destructive text-xs">:{name || "emoji"}: unavailable</span>;
  if (!image.data) return <span role="status" aria-label={`Loading ${name || "emoji"}`} style={{width: size, height: size}} className="inline-block animate-pulse rounded bg-muted" />;
  return <img src={image.data} alt={`:${name || "emoji"}:`} width={size} height={size}
    className="inline-block shrink-0 object-contain" style={{width: size, height: size}} />;
}
