import { createServer } from 'node:http';
import { toNodeListener } from '@plurid/uitive-server/node';
import { handler } from './handler.js';

// #region node
// In Express: app.use('/api/uitive', toNodeListener(handler)).
createServer(toNodeListener(handler)).listen(8787);
// #endregion
