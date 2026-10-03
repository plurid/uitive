/**
 * Action IDs, context values and choice values: everything a planner may emit as an enum
 * value. Lowercase only, because structured outputs don't guarantee the casing of enum values.
 */
export const ID_PATTERN = /^[a-z0-9][a-z0-9.:-]*$/;

/** Surface names are identifiers in application code. */
export const SURFACE_PATTERN = /^[a-z][a-zA-Z0-9]*$/;

/** Throws unless every ID matches its pattern and none collide ignoring case. */
export function assertIds(domain: string, ids: readonly string[], pattern = ID_PATTERN): void {
  const seen = new Map<string, string>();
  for (const id of ids) {
    if (!pattern.test(id)) throw new Error(`${domain}: "${id}" must match ${pattern}`);
    const folded = id.toLowerCase();
    const previous = seen.get(folded);
    if (previous !== undefined) {
      throw new Error(`${domain}: "${id}" collides with "${previous}" ignoring case`);
    }
    seen.set(folded, id);
  }
}

/** Maps a value to the canonical ID it names, comparing case-insensitively. */
export function canonicaliser(ids: readonly string[]): (value: string) => string | undefined {
  const byFolded = new Map(ids.map((id) => [id.toLowerCase(), id]));
  return (value) => byFolded.get(value.trim().toLowerCase());
}
