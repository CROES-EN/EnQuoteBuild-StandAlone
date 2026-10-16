const line = value => typeof value === "string" || typeof value === "number"
  ? String(value).replace(/\s+/g, " ").trim() : "";

export function homeownerQuoteEmail(quote, homeowner, context, {senderName = "", scopeSummary = ""} = {}) {
  if (!quote) throw new Error("A quote is required to generate the homeowner email.");
  const name = line(homeowner);
  if (!name) throw new Error("A homeowner name is required to generate the email.");
  const sender = line(senderName);
  const firstName = sender && !sender.includes("@") ? sender.split(" ")[0] : "";
  const scope = line(scopeSummary);
  const service = /^on[- ]demand$/i.test(line(quote.picklist)) ? "an On-Demand service quote" : "a service quote";
  const site = line(context?.siteId || quote.site_id);
  const paragraphs = [
    `Subject: Enphase Energy - On - Demand Quote - ${name}${site ? ` - ${site}` : ""}`,
    `Hello ${name},`,
    `${firstName ? `This is ${firstName} with Enphase Energy. ` : ""}I was requested to put together ${service} for the work needed to help restore the functionality of your system.`,
    ...(scope ? [scope] : []),
    "I have attached the service quote to this email for you to review.",
    "If this service is something you would like to proceed with, please let me know so I can have an invoice sent to you."
  ];
  return paragraphs.join("\n\n");
}
