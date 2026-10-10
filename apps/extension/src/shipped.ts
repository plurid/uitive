import demo from '../adapters/acme-payments.json';

/**
 * The adapters this extension ships, as JSON. Tests and type checks see the demo imported here,
 * for a fictional dashboard; a build replaces the list with exactly the adapters it was given.
 */
export const shipped: readonly unknown[] = [demo];
