// Runs the fictional dashboard for trying the extension by hand:
//   node tools/fixtures/payments-dashboard/start.ts
// then build the extension for it: node apps/extension/build.ts --out dist/fixture --fixture http://127.0.0.1:4180 --api http://127.0.0.1:4181
import { startDashboard } from './server.ts';

const dashboard = await startDashboard({ port: 4180, apiPort: 4181 });
console.log(`Dashboard: ${dashboard.url}/test/dashboard`);
console.log(`API: ${dashboard.api} (any key starting rk_test_ works)`);
process.on('SIGINT', () => {
  void dashboard.close().then(() => process.exit(0));
});
