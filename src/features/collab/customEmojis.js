import {useQuery} from "@tanstack/react-query";
import {chatApi} from "./collabApi";
import {getCurrentUserNamespace} from "@/lib/userScopedStorage";
import {CUSTOM_EMOJI_MAX_BYTES, CUSTOM_EMOJI_TYPES} from "../../../shared/customEmojiRules.js";

export const customEmojiQueryKey = () => ["custom-emojis", getCurrentUserNamespace()];
const updateRequired = error => ["desktop_restart_required", "emoji_service_update_required"].includes(error?.code);
export const retryEmojiQuery = (count, error) => !updateRequired(error) && count < 1;

export function useCustomEmojis(enabled = true) {
  return useQuery({
    queryKey: customEmojiQueryKey(), queryFn: chatApi.emojis,
    enabled, staleTime: 30000, retry: retryEmojiQuery,
    refetchInterval: query => enabled && !updateRequired(query.state.error) ? 60000 : false
  });
}

export async function customEmojiFile(file) {
  if (!CUSTOM_EMOJI_TYPES.includes(file.type)) throw new Error("Choose a PNG, JPEG, WebP, or GIF image.");
  if (!file.size || file.size > CUSTOM_EMOJI_MAX_BYTES) throw new Error("Custom emojis must be 512 KB or smaller.");
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Unable to read the emoji image."));
    reader.readAsDataURL(file);
  });
  await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => image.naturalWidth && image.naturalHeight
      ? resolve() : reject(new Error("That image cannot be used as an emoji."));
    image.onerror = () => reject(new Error("That image cannot be used as an emoji."));
    image.src = dataUrl;
  });
  return dataUrl;
}
