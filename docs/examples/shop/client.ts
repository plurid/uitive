import { createAptuitive, localStore } from '@plurid/aptuitive-core';
import { bindings } from './bindings.js';
import { shop } from './contract.js';

export const aptuitive = createAptuitive({ contract: shop, store: localStore('shop'), bindings });
