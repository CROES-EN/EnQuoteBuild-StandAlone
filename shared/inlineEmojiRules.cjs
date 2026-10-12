function splitInlineEmojis(body) {
  const parts = [];
  const pattern = /<:([a-z0-9][a-z0-9_-]{0,31}):([a-f0-9]{64})>/g;
  let start = 0;
  for (const match of body.matchAll(pattern)) {
    if (match.index > start) parts.push({text: body.slice(start, match.index)});
    parts.push({id: match[2], name: match[1], token: match[0]});
    start = match.index + match[0].length;
  }
  if (start < body.length) parts.push({text: body.slice(start)});
  return parts;
}

function inlineEmojiPreview(body) {
  return splitInlineEmojis(body).map(part => part.id ? `:${part.name}:` : part.text).join("");
}

module.exports = {splitInlineEmojis, inlineEmojiPreview};
