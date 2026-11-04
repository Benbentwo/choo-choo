// Conductor names worktrees after cities. We do the same.
export const CITIES = [
  'amsterdam', 'athens', 'austin', 'bangkok', 'barcelona', 'berlin', 'bogota', 'boston',
  'brussels', 'budapest', 'cairo', 'chicago', 'copenhagen', 'dallas', 'delhi', 'denver',
  'dublin', 'edinburgh', 'florence', 'geneva', 'hanoi', 'havana', 'helsinki', 'houston',
  'istanbul', 'jakarta', 'kyoto', 'lagos', 'lima', 'lisbon', 'london', 'madrid', 'manila',
  'marseille', 'melbourne', 'miami', 'milan', 'montreal', 'moscow', 'mumbai', 'munich',
  'nairobi', 'naples', 'oslo', 'paris', 'pattaya', 'perth', 'porto', 'prague', 'quebec',
  'reykjavik', 'riga', 'rome', 'santiago', 'seattle', 'seoul', 'seville', 'singapore',
  'stockholm', 'sydney', 'taipei', 'tallinn', 'tokyo', 'toronto', 'tunis', 'valencia',
  'vancouver', 'venice', 'vienna', 'vilnius', 'warsaw', 'zagreb', 'zurich'
]

export function pickCityName(taken: Set<string>, rand: () => number = Math.random): string {
  const free = CITIES.filter((c) => !taken.has(c))
  if (free.length > 0) return free[Math.floor(rand() * free.length)]
  for (let n = 2; ; n++) {
    const base = CITIES[Math.floor(rand() * CITIES.length)]
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
  }
}
