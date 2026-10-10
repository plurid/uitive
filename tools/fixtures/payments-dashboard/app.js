// A fictional payments dashboard, for testing Uitive's extension. A single-page app that
// re-renders its sidebar and content on every navigation, the way framework-built pages do.

const money = (amount, currency) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency.toUpperCase() }).format(
    amount / 100,
  );
const when = (seconds) =>
  new Date(seconds * 1000).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
const escape = (text) =>
  String(text ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );

let data;

const test = () => location.pathname.startsWith('/test/');
const base = () => (test() ? '/test' : '');

// `?variant=renamed` plays a site redesign: Customers becomes Buyers, at a new address.
const params = new URLSearchParams(location.search);
if (params.has('variant')) sessionStorage.setItem('variant', params.get('variant'));
const renamed = sessionStorage.getItem('variant') === 'renamed';

const SIDEBAR = [
  ['Home', '/dashboard'],
  ['Funds', '/funds'],
  ['Payments', '/payments'],
  renamed ? ['Buyers', '/buyers'] : ['Customers', '/customers'],
  ['Catalog', '/catalog'],
  ['Partners', '/partners'],
  ['Invoices', '/invoices'],
  ['Reports', '/reports'],
];

function sidebar() {
  const here = location.pathname.replace(/^\/test/, '');
  return `<nav aria-label="Main" class="sidebar">${SIDEBAR.map(
    ([label, path]) =>
      `<a data-link href="${base()}${path}"${here.startsWith(path) ? ' aria-current="page"' : ''}>${label}</a>`,
  ).join('')}</nav>`;
}

function chargeRows(charges) {
  return charges
    .map(
      (charge) => `<tr>
        <td><a data-link href="${base()}/payments/${charge.id}">${money(charge.amount, charge.currency)}</a></td>
        <td><span class="status ${charge.status}">${charge.status === 'succeeded' ? 'Succeeded' : 'Failed'}</span></td>
        <td>${escape(charge.description)}</td>
        <td>${escape(charge.receipt_email)}</td>
        <td>${when(charge.created)}</td>
      </tr>`,
    )
    .join('');
}

const PAGES = [
  [
    /^\/dashboard\/?$/,
    () => {
      const today = data.charges.filter((charge) => charge.created > Date.now() / 1000 - 86_400);
      const gross = today
        .filter((charge) => charge.status === 'succeeded')
        .reduce((sum, charge) => sum + charge.amount, 0);
      return `<h1>Today</h1>
        <section class="cards">
          <div class="card"><h2>Gross volume</h2><p class="big">${money(gross, 'eur')}</p></div>
          <div class="card"><h2>Payments</h2><p class="big">${today.length}</p></div>
          <div class="card"><h2>Disputes</h2><p class="big">${data.disputes.length}</p></div>
        </section>
        <h2>Recent payments</h2>
        <table><thead><tr><th>Amount</th><th>Status</th><th>Description</th><th>Customer</th><th>Date</th></tr></thead>
        <tbody>${chargeRows(data.charges.slice(0, 8))}</tbody></table>`;
    },
  ],
  [
    /^\/payments\/?$/,
    () => `<h1>Payments</h1>
      <div class="toolbar"><button type="button">Filter</button><button type="button">Export</button><button type="button">Create payment</button></div>
      <table><thead><tr><th>Amount</th><th>Status</th><th>Description</th><th>Customer</th><th>Date</th></tr></thead>
      <tbody>${chargeRows(data.charges)}</tbody></table>`,
  ],
  [
    /^\/payments\/(ch_\w+)\/?$/,
    (id) => {
      const charge = data.charges.find((entry) => entry.id === id);
      if (!charge) return '<h1>Payment not found</h1>';
      return `<h1>${money(charge.amount, charge.currency)} <span class="status ${charge.status}">${charge.status}</span></h1>
        <p>${escape(charge.description)}</p>
        <div class="toolbar"><button type="button">Refund</button><button type="button">Copy ID</button></div>`;
    },
  ],
  [
    /^\/(customers|buyers)\/?$/,
    () => `<h1>Customers</h1>
      <table><thead><tr><th>Name</th><th>Email</th><th>Created</th></tr></thead><tbody>${data.customers
        .map(
          (
            customer,
          ) => `<tr><td><a data-link href="${base()}/customers/${customer.id}">${escape(customer.name)}</a></td>
          <td>${escape(customer.email)}</td><td>${when(customer.created)}</td></tr>`,
        )
        .join('')}</tbody></table>`,
  ],
  [
    /^\/customers\/(cus_\w+)\/?$/,
    (id) => {
      const customer = data.customers.find((entry) => entry.id === id);
      if (!customer) return '<h1>Customer not found</h1>';
      return `<h1>${escape(customer.name)}</h1><p>${escape(customer.email)}</p>
        <h2>Payments</h2><table><tbody>${chargeRows(data.charges.filter((charge) => charge.customer === id))}</tbody></table>`;
    },
  ],
  [/^\/funds\/?$/, () => '<h1>Funds</h1><p>Your balance and the payouts on their way.</p>'],
  [/^\/catalog/, () => '<h1>Catalog</h1><p>What you sell, and for how much.</p>'],
  [/^\/partners/, () => '<h1>Partners</h1><p>Businesses you take payments for.</p>'],
  [/^\/invoices/, () => '<h1>Invoices</h1><p>Invoices and the plans customers pay for.</p>'],
  [/^\/reports/, () => '<h1>Reports</h1><p>How the business is doing.</p>'],
];

function render() {
  const path = location.pathname.replace(/^\/test/, '') || '/dashboard';
  const found = PAGES.map(([pattern, page]) => [pattern.exec(path), page]).find(([match]) => match);
  const content = found ? found[1](...found[0].slice(1)) : '<h1>Not found</h1>';
  document.querySelector('#app').innerHTML = `
    <header class="top"><strong>Acme Payments</strong> <span class="badge">fictional</span> <input type="search" aria-label="Search" placeholder="Search" /></header>
    ${test() ? '<div role="alert" class="notice">You are viewing test data. CANARY-notice switch to live data in the corner.</div>' : ''}
    <div class="layout">${sidebar()}<main>${content}</main></div>`;
}

document.addEventListener('click', (event) => {
  const link = event.target instanceof Element ? event.target.closest('a[data-link]') : null;
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey)
    return;
  event.preventDefault();
  history.pushState({}, '', link.getAttribute('href'));
  render();
});
window.addEventListener('popstate', render);

fetch('/__data')
  .then((response) => response.json())
  .then((loaded) => {
    data = loaded;
    if (
      location.pathname === '/' ||
      location.pathname === '/test' ||
      location.pathname === '/test/'
    ) {
      history.replaceState({}, '', `${base()}/dashboard`);
    }
    render();
  });
