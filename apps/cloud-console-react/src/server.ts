import { heuristicPlanner } from '@plurid/aptuitive-core';
import { createAptuitiveHandler, environmentModel, modelPlanner } from '@plurid/aptuitive-server';
import { cloud } from './contract.ts';

// Runs in the dev server only. The contract is the same module the browser uses, and the model is
// whichever the dev server has a key for; without one, the deterministic planner answers.
const model = environmentModel();

export const handler = createAptuitiveHandler({
  contract: cloud,
  planner: model ? modelPlanner({ model }) : heuristicPlanner(),
});
