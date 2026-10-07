import {UserAvatar} from "@/components/profile/UserAvatar";

export function startsMessageSenderGroup(message, previous) {
  return !previous || previous.sender !== message.sender ||
    Date.parse(message.createdAt) - Date.parse(previous.createdAt) >= 5 * 60 * 1000;
}

export default function MessageSenderAvatar({email, name, show, hasSenderLabel = false}) {
  return show
    ? <UserAvatar email={email} name={name} size={32} className={hasSenderLabel ? "mt-5" : "mt-0.5"} />
    : <span className="h-8 w-8 shrink-0" aria-hidden="true" />;
}
