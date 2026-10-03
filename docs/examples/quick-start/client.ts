import { createUitive, localStore } from '@plurid/uitive-core';
import { contract } from './contract.js';

// Learns from use and changes when asked; the person's interface is kept in this browser.
export const uitive = createUitive({
  contract,
  store: localStore('notes'),
});
