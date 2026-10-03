import { createAptuitive, localStore } from '@plurid/aptuitive-core';
import { contract } from './contract.js';

// Learns from use and changes when asked; the person's interface is kept in this browser.
export const aptuitive = createAptuitive({ contract, store: localStore('editor') });
