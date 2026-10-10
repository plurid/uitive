import type { ClientLike } from './client-like.js';

/**
 * Accepts a waiting change or a suggestion. Returns why it couldn't apply, in policy's own words
 * when policy refused it, or undefined when it applied.
 */
export function accept(client: ClientLike, operation: string): string | undefined {
  const before = client.getSnapshot().latest?.id;
  if (client.accept(operation)) return undefined;
  const latest = client.getSnapshot().latest;
  const refusal = latest?.id === before ? undefined : latest?.rejected[0]?.message;
  if (refusal) return refusal;
  const suggested = client
    .getSnapshot()
    .definition.operations.find((entry) => entry.id === operation);
  return suggested?.change.kind === 'collection'
    ? 'There is no room for another item. Remove one first.'
    : "That change can't apply any more.";
}
