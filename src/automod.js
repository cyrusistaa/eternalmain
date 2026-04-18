const URL_RE = /\bhttps?:\/\/\S+/i;
const INVITE_RE = /\bdiscord\.gg\/\S+|\bdiscord\.com\/invite\/\S+/i;

export function messageHasLink(content) {
  if (!content) return false;
  return URL_RE.test(content) || INVITE_RE.test(content);
}

export function messageHasBadWord(content, badWords) {
  if (!content) return false;
  const lowered = content.toLowerCase();
  for (const w of badWords ?? []) {
    if (!w) continue;
    if (lowered.includes(w)) return true;
  }
  return false;
}

