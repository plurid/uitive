/**
 * Fictional data for a fictional payments dashboard, deterministic for tests. Some strings carry
 * `CANARY-`: they show on the page and come from the API, and must never reach a planner.
 */

export type Row = Record<string, unknown>;

export interface Dataset {
  charges: Row[];
  customers: Row[];
  disputes: Row[];
  payouts: Row[];
  refunds: Row[];
  balance_transactions: Row[];
  invoices: Row[];
  subscriptions: Row[];
}

function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

const NAMES = [
  'Ada Lovelace',
  'Grace Hopper',
  'Katherine Johnson',
  'Alan Turing',
  'Edsger Dijkstra',
  'Barbara Liskov',
  'Margaret Hamilton',
  'Donald Knuth',
];
const BRANDS = ['visa', 'mastercard', 'amex'];
const CURRENCIES = ['eur', 'eur', 'eur', 'usd'];

/** Rows relative to `now` (in milliseconds), so "today" always has data. */
export function dataset(now: number): Dataset {
  const next = random(42);
  const seconds = Math.floor(now / 1000);
  const id = (prefix: string, index: number) =>
    `${prefix}_${(index + 1).toString(36).padStart(4, '0')}${'Q7M3W2B4A5N0Z8'.slice(0, 10)}`;
  const customers = NAMES.map((name, index) => ({
    id: id('cus', index),
    object: 'customer',
    name,
    email: `${name.split(' ')[0]?.toLowerCase()}@example.test`,
    created: seconds - (index + 1) * 86_400 * 7,
    balance: index === 3 ? -1500 : 0,
    currency: 'eur',
    delinquent: index === 5,
    description: index === 0 ? 'CANARY-c1 founding customer' : null,
    phone: null,
  }));
  const charges = Array.from({ length: 60 }, (_, index) => {
    const failed = next() < 0.18;
    const customer = customers[index % customers.length];
    const amount = Math.round(500 + next() * 24_500);
    return {
      id: id('ch', index),
      object: 'charge',
      amount,
      amount_refunded: !failed && next() < 0.08 ? amount : 0,
      currency: CURRENCIES[index % CURRENCIES.length],
      status: failed ? 'failed' : 'succeeded',
      created: seconds - Math.floor(index * 3_600 * (1 + next() * 3)),
      customer: customer?.id ?? null,
      description:
        index % 7 === 0 ? `CANARY-${index} order ${1000 + index}` : `Order ${1000 + index}`,
      receipt_email: customer?.email ?? null,
      refunded: false,
      disputed: index === 4 || index === 17,
      payment_intent: id('pi', index),
      failure_message: failed ? 'Your card was declined.' : null,
      failure_code: failed ? 'card_declined' : null,
      captured: !failed,
      payment_method_details: {
        type: 'card',
        card: { brand: BRANDS[index % BRANDS.length], last4: String(4242 + index).slice(-4) },
      },
      metadata: {},
    };
  });
  const disputes = [4, 17].map((index, position) => ({
    id: id('dp', position),
    object: 'dispute',
    amount: charges[index]?.amount,
    currency: charges[index]?.currency,
    status: position === 0 ? 'needs_response' : 'under_review',
    reason: position === 0 ? 'fraudulent' : 'product_not_received',
    created: seconds - (position + 1) * 5_400,
    charge: charges[index]?.id,
    payment_intent: charges[index]?.payment_intent,
    is_charge_refundable: true,
  }));
  const payouts = Array.from({ length: 6 }, (_, index) => ({
    id: id('po', index),
    object: 'payout',
    amount: 120_000 + index * 7_350,
    currency: 'eur',
    status: index === 0 ? 'in_transit' : 'paid',
    arrival_date: seconds + (index === 0 ? 86_400 : -index * 86_400 * 2),
    created: seconds - index * 86_400 * 2 - 3_600,
    method: 'standard',
    type: 'bank_account',
    description: 'ACME PAYOUT',
    failure_message: null,
  }));
  const refunds = charges
    .filter((charge) => charge.amount_refunded > 0)
    .map((charge, index) => ({
      id: id('re', index),
      object: 'refund',
      amount: charge.amount_refunded,
      currency: charge.currency,
      status: 'succeeded',
      reason: 'requested_by_customer',
      created: charge.created + 3_600,
      charge: charge.id,
      payment_intent: charge.payment_intent,
    }));
  const balance_transactions = charges
    .filter((charge) => charge.status === 'succeeded')
    .map((charge, index) => ({
      id: id('txn', index),
      object: 'balance_transaction',
      amount: charge.amount,
      fee: Math.round(charge.amount * 0.015 + 25),
      net: charge.amount - Math.round(charge.amount * 0.015 + 25),
      currency: charge.currency,
      type: 'charge',
      status: index < 5 ? 'pending' : 'available',
      created: charge.created,
      available_on: charge.created + 86_400 * 2,
      description: charge.description,
      reporting_category: 'charge',
    }));
  const invoices = customers.slice(0, 5).map((customer, index) => ({
    id: id('in', index),
    object: 'invoice',
    amount_due: 4_900,
    amount_paid: index === 2 ? 0 : 4_900,
    amount_remaining: index === 2 ? 4_900 : 0,
    currency: 'eur',
    status: index === 2 ? 'open' : 'paid',
    created: seconds - index * 86_400 * 30,
    due_date: index === 2 ? seconds + 86_400 * 5 : null,
    customer: customer.id,
    number: `ACME-${1000 + index}`,
    customer_email: customer.email,
  }));
  const subscriptions = customers.slice(0, 5).map((customer, index) => ({
    id: id('sub', index),
    object: 'subscription',
    status: index === 4 ? 'past_due' : 'active',
    created: seconds - index * 86_400 * 40,
    customer: customer.id,
    currency: 'eur',
    cancel_at_period_end: index === 1,
    description: null,
  }));
  return {
    charges,
    customers,
    disputes,
    payouts,
    refunds,
    balance_transactions,
    invoices,
    subscriptions,
  };
}
