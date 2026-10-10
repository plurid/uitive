import { heuristicPlanner } from '@plurid/uitive-core';
import { createUitiveHandler, environmentModel, modelPlanner } from '@plurid/uitive-server';
import { cloud } from './contract.ts';

// Runs in the dev server only. The contract is the same module the browser uses, and the model is
// whichever the dev server has a key for; without one, the deterministic planner answers.
const model = environmentModel();

export const handler = createUitiveHandler({
  contract: cloud,
  planner: model ? modelPlanner({ model }) : heuristicPlanner(),
  // A demonstration with no sign-in: it plans only outside production. An application checks the
  // person's session here, as its own API does.
  authorize: () => process.env.NODE_ENV !== 'production',
});
