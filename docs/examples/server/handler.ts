import { heuristicPlanner } from '@plurid/aptuitive-core';
import { createAptuitiveHandler, environmentModel, modelPlanner } from '@plurid/aptuitive-server';
import { shop } from '../shop/contract.js';

// #region handler
// Whichever model the server has a key for: Anthropic, OpenAI or Gemini.
const model = environmentModel();

export const handler = createAptuitiveHandler({
  contract: shop,
  // Without a key, as in development, the deterministic planner answers plain commands.
  planner: model ? modelPlanner({ model }) : heuristicPlanner(),
  // Planning spends money: only signed-in people may ask. The default allows localhost only.
  authorize: (request) => /(^|;\s*)session=/.test(request.headers.get('cookie') ?? ''),
});
// #endregion
