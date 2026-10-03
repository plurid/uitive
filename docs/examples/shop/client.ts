import { createUitive, localStore } from '@plurid/uitive-core';
import { bindings } from './bindings.js';
import { shop } from './contract.js';

export const uitive = createUitive({ contract: shop, store: localStore('shop'), bindings });
