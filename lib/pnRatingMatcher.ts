export const PN_RATING_PATTERNS = [
  { rating: "CLASS-150#", patterns: [/class\s*150/i] },
  { rating: "CLASS-300#", patterns: [/class\s*300/i, /pn[\s-]*40/i] },
  { rating: "CLASS-600#", patterns: [/class\s*600/i, /pn[\s-]*6\.0/i, /pn[\s-]*0?6(?!\d)/i] },
  { rating: "CLASS-800#", patterns: [/class\s*800/i] },
  { rating: "PN-10/16",   patterns: [
    /pn[\s-]*10/i,
    /pn[\s-]*16/i,
    /pn[\s-]*1\.6/i,
    /pn[\s-]*1\.0/i,
    /p\.\s*n\.\s*1\.\s*6/i,
    /pn[\s-]*1(?!\d)/i,
  ]},
  { rating: "PN-20/25/30", patterns: [
    /pn[\s-]*20/i,
    /pn[\s-]*25/i,
    /pn[\s-]*30/i,
    /pn[\s-]*2\.5/i,
    /pn[\s-]*3\.0/i,
    /pn[\s-]*2\.0/i,
    /pn[\s-]*2(?!\d)/i,
  ]},
]

export function matchPnRating(text: string | null | undefined): string | null {
  if (!text || typeof text !== 'string') return null
  for (const entry of PN_RATING_PATTERNS) {
    for (const pattern of entry.patterns) {
      if (pattern.test(text)) {
        return entry.rating
      }
    }
  }
  return null
}
