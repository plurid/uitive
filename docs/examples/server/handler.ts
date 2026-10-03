import { anthropicPlanner, createAptuitiveHandler } from '@plurid/aptuitive-server';
import { heuristicPlanner } from '@plurid/aptuitive-core';
import { shop } from '../shop/contract.js';

// #region handler
export const handler = createAptuitiveHandler({
  contract: shop,
  // Claude where the server has a key; the deterministic planner otherwise, as in development.
  planner: process.env.ANTHROPIC_API_KEY ? anthropicPlanner() : heuristicPlanner(),
  // Planning spends money: only signed-in people may ask. The default allows localhost only.
  authorize: (request) => /(^|;\s*)session=/.test(request.headers.get('cookie') ?? ''),
});
// #endregion
