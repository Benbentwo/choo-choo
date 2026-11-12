/** Where `query` occurs in `text`, ignoring case: start offsets, left to right, without overlaps. */
export function findMatches(text: string, query: string, limit = Infinity): number[] {
  const out: number[] = []
  if (!query) return out
  const hay = text.toLowerCase()
  const needle = query.toLowerCase()
  // Lowercasing can change a string's length in a few scripts; offsets would then point at the wrong place.
  if (hay.length !== text.length || needle.length !== query.length) return out
  for (let at = hay.indexOf(needle); at >= 0 && out.length < limit; at = hay.indexOf(needle, at + needle.length)) out.push(at)
  return out
}
