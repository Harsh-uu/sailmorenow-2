// ONE rule for when an event exposes the Crew Bank: the host marked it a race
// (is_race) OR the category is Racing. Used everywhere an event is shown.
// Mirrors the web (lib/events.js) and backend (event_has_crew_bank) helpers.
export const eventHasCrewBank = (ev?: { is_race?: boolean; category?: string } | null) =>
  !!(ev && (ev.is_race || ev.category === "racing"));
