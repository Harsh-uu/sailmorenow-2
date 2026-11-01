// ONE rule for when an event exposes the Crew Bank: the host marked it a race
// (is_race) OR the category is Racing. Used everywhere an event is shown (list
// rows, detail, My Events). Mirrors the mobile and backend helpers.
export const eventHasCrewBank = (ev) => !!(ev && (ev.is_race || ev.category === "racing"));
