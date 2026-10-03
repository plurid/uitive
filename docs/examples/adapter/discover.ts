import { discoverApp, factsOf, parseAriaSnapshot } from '@plurid/aptuitive-adapter';
import { shop } from '../shop/contract.js';

// #region discover
// What Playwright's `page.locator('body').ariaSnapshot()` writes for the orders page.
const snapshot = `
- navigation "Main":
  - link "Orders":
    - /url: /orders
  - link "Customers":
    - /url: /customers
- main:
  - heading "Orders" [level=1]
  - button "Cancel order"
`;

const facts = factsOf(parseAriaSnapshot(snapshot), 'http://localhost:5173/orders');
// A route and a region for the page, the navigation as a list, and buttons matched to actions.
export const discovery = discoverApp([facts], shop);
// #endregion
