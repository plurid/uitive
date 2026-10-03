import { createServer } from 'node:http';
import { toNodeListener } from '@plurid/aptuitive-server/node';
import { handler } from './handler.js';

// #region node
// In Express: app.use('/api/aptuitive', toNodeListener(handler)).
createServer(toNodeListener(handler)).listen(8787);
// #endregion
