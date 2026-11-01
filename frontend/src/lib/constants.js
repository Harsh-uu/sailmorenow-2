// Client-side mirror of /app/backend/constants.py::MAX_PHOTO_URL_CHARS.
// Photos travel as base64 data URLs; the server rejects any single string
// longer than this many CHARACTERS. Keep the two files in sync — if you
// bump one, bump the other in the same commit.
export const MAX_PHOTO_URL_CHARS = 400_000;
