import {
  createAptuitive,
  heuristicPlanner,
  localStore,
  remotePlanner,
} from '@plurid/aptuitive-core';
import { bindings } from '../shop/bindings.js';
import { shop } from '../shop/contract.js';

// #region client
export const aptuitive = createAptuitive({
  contract: shop,
  store: localStore('shop'),
  bindings,
  // A model through the application's server; simple commands still work when it can't answer.
  planner: remotePlanner({ url: '/api/aptuitive', fallback: heuristicPlanner() }),
});
// #endregion
