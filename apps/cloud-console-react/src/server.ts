import { anthropicPlanner, createAptuitiveHandler } from '@plurid/aptuitive-server';
import { cloud } from './contract.ts';

// Runs in the dev server only. The contract is the same module the browser uses.
export const handler = createAptuitiveHandler({ contract: cloud, planner: anthropicPlanner() });
