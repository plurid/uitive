/**
 * CSS `order` values that show a flex or grid box's children in a new order without moving them.
 * `positions` holds each child's place among the items, or -1 for a child that isn't one. Children
 * before the first item stay first, children after the last item stay last, and the others follow
 * the item before them. Without items, nothing moves.
 */
export function orders(positions: readonly number[]): number[] {
  let first = -1;
  let last = -1;
  positions.forEach((position, index) => {
    if (position < 0) return;
    if (first === -1) first = index;
    last = index;
  });
  if (first === -1) return positions.map(() => 0);
  let previous = 0;
  return positions.map((position, index) => {
    if (position >= 0) {
      previous = position * 100;
      return previous;
    }
    if (index < first) return index - 1000;
    if (index > last) return 1_000_000 + index;
    previous += 1;
    return previous;
  });
}
