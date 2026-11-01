// Shared crew-position helpers (web). The backend position list no longer
// includes the legacy "Any"; a stored "Any" is shown as "Railmeat". Any other
// stored value (for example "Grinder") is displayed as stored.
export const displayPosition = (p) => (p === "Any" ? "Railmeat" : p);

// Normalize a stored positions array for form editing: map "Any" to "Railmeat",
// de-duplicate, and (when the current valid list is known) drop values that are
// no longer selectable so an old entry does not 400 on save.
export function normalizePositions(stored, valid) {
  const mapped = (stored || []).map(displayPosition);
  const seen = new Set();
  const dedup = mapped.filter((p) => (seen.has(p) ? false : (seen.add(p), true)));
  if (!valid || valid.length === 0) return dedup;
  const allow = new Set(valid);
  return dedup.filter((p) => allow.has(p));
}
