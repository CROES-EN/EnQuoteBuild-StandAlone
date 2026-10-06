const UNAVAILABLE_NAV = ["Invite", "Film", "Blog", "Favorites", "Forum", "Groups", "Events", "Videos", "Music", "Comedy", "Classifieds"];

function Unavailable({label}) {
  return <button type="button" disabled title={`${label}: not available in EnQuote Space`} className="cursor-not-allowed px-1.5 py-1 text-xs opacity-50">{label}</button>;
}

export function NavigationQuicklinks({onHome, onBrowse, onSearch, onMail, canMail}) {
  return (
    <nav aria-label="EnQuote Space quicklinks" className="mt-2 flex flex-wrap items-center gap-x-1 border-t border-white/30 pt-1 text-white">
      {[["Home", onHome], ["Browse", onBrowse], ["Search", onSearch], ["Mail", onMail]].map(([label, action]) =>
        <button key={label} type="button" onClick={action} disabled={label === "Mail" && !canMail}
          title={label === "Mail" && !canMail ? "Messages access is not enabled for your account" : label}
          className="px-1.5 py-1 text-xs hover:underline disabled:cursor-not-allowed disabled:opacity-50">{label}</button>)}
      {UNAVAILABLE_NAV.map((label) => <Unavailable key={label} label={label} />)}
      <span className="px-1.5 text-[10px] text-white/70">Faded links are unavailable.</span>
    </nav>
  );
}

export function ProfileActions({name, onMessage, canMessage, sending}) {
  return (
    <section aria-label="Profile contact quicklinks" className="contents">
      <button type="button" onClick={onMessage} disabled={!canMessage || sending}
        title={!canMessage ? "Messages access is not enabled for this profile" : `Message ${name} in EnQuote Messages`}
        className="rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-[#143779] hover:bg-[#e5efff] disabled:cursor-not-allowed disabled:opacity-50">{sending ? "Opening..." : "Send Message"}</button>
    </section>
  );
}
