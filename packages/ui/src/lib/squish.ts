/** Lowercased text with all whitespace removed, so search ignores spaces. */
export const squish = (s: unknown): string => String(s ?? "").replace(/\s+/g, "").toLowerCase();

/** Whitespace- and case-insensitive substring match. */
export const looseIncludes = (hay: unknown, q: unknown): boolean => squish(hay).includes(squish(q));
