import { heuristicPlanner } from '@plurid/uitive-core';
import { createUitiveHandler, environmentModel, modelPlanner } from '@plurid/uitive-server';
import { shop } from '../shop/contract.js';

// #region handler
// Whichever model the server has a key for: Anthropic, OpenAI or Gemini.
const model = environmentModel();

export const handler = createUitiveHandler({
  contract: shop,
  // Without a key, as in development, the deterministic planner answers plain commands.
  planner: model ? modelPlanner({ model }) : heuristicPlanner(),
  // Planning spends money: only signed-in people may ask. The default allows localhost only.
  authorize: (request) => /(^|;\s*)session=/.test(request.headers.get('cookie') ?? ''),
});
// #endregion
