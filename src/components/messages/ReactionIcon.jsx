const colors = {
  thumbs_up: "#79d6aa",
  heart: "#ff91ad",
  laugh: "#ffd36b",
  surprised: "#a9a0ff",
  sad: "#86c8f5",
  celebrate: "#ffaf73"
};

export default function ReactionIcon({reaction, size = 24}) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none"
      aria-hidden="true" focusable="false" data-reaction-icon={reaction} className="shrink-0">
      <circle cx="16" cy="16" r="14" fill={colors[reaction]} />
      <g stroke="#293344" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {reaction === "heart" ? (
          <g fill="#c83360" stroke="none">
            <path d="M6 11c0-3 4-4 5-1 2-3 6-2 5 1-1 2-5 5-5 5s-5-3-5-5Z" />
            <path d="M18 11c0-3 4-4 5-1 2-3 6-2 5 1-1 2-5 5-5 5s-5-3-5-5Z" />
          </g>
        ) : reaction === "laugh" ? (
          <><path d="m8 10 4 3-4 2M24 10l-4 3 4 2" /></>
        ) : reaction === "sad" ? (
          <><path d="m8 11 4-2M20 9l4 2" /><circle cx="10" cy="15" r="1" fill="#293344" /><circle cx="22" cy="15" r="1" fill="#293344" /></>
        ) : reaction === "thumbs_up" ? (
          <><path d="M7 13c2-3 4-3 6 0" /><circle cx="22" cy="12" r="1.5" fill="#293344" stroke="none" /></>
        ) : (
          <><circle cx="10" cy="12" r="2" fill="#293344" stroke="none" /><circle cx="22" cy="12" r="2" fill="#293344" stroke="none" /></>
        )}
        {reaction === "surprised" ? <ellipse cx="16" cy="22" rx="3" ry="4" fill="#293344" />
          : reaction === "sad" ? <path d="M11 24c3-3 7-3 10 0" />
          : reaction === "laugh" ? <path d="M8 19h16c-1 10-15 10-16 0Z" fill="#293344" />
          : <path d="M10 20c2 6 10 6 12 0" />}
      </g>
      {reaction === "laugh" && <path d="M12 25c2-2 6-2 8 0-2 2-6 2-8 0Z" fill="#ff8397" />}
      {reaction === "sad" && <path d="M24 18c-5 5-2 9 1 6 2-2 0-4-1-6Z" fill="#267bc1" />}
      {reaction === "celebrate" && <>
        <path d="m6 8 5-7 8 7Z" fill="#7357cb" />
        <path d="m11 1 3 7h-3l-2-4Z" fill="#ffe788" />
        <path d="m24 3 2 3 3-1-2 3 2 3-4-1-2 2V8l-3-2 4-1Z" fill="#ed6383" />
      </>}
    </svg>
  );
}
