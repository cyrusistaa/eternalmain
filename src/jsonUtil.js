export function safeJsonParse(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function uniqStrings(values) {
  return Array.from(new Set((values ?? []).filter(Boolean).map((v) => String(v))));
}

