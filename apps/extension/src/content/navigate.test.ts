// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { linkTo, modePrefix, targetOf } from './navigate.ts';

const TEST = '^/test/';
const at = (pathname: string) => ({ origin: 'https://dashboard.example', pathname });

describe('links built from routes', () => {
  it('stay in test mode on a page in test mode, and in live mode on a live page', () => {
    expect(modePrefix(TEST, '/test/payments')).toBe('/test');
    expect(modePrefix(TEST, '/payments')).toBe('');
    expect(targetOf('/customers/cus_x', TEST, at('/test/dashboard')).href).toBe(
      '/test/customers/cus_x',
    );
    expect(targetOf('/customers/cus_x?tab=1', TEST, at('/dashboard')).href).toBe(
      '/customers/cus_x?tab=1',
    );
    expect(targetOf('/test/payments', TEST, at('/test/dashboard')).path).toBe('/test/payments');
  });

  it("follow the page's own link to exactly that path, never one that merely ends like it", () => {
    document.body.innerHTML = `
      <a href="/customers/cus_x">Live</a>
      <a href="/x/payments">Elsewhere</a>
      <a href="/test/customers/cus_x/">Test</a>
      <a href="https://other.example/test/payments">Other site</a>`;
    expect(linkTo(document, '/test/customers/cus_x')?.textContent).toBe('Test');
    expect(linkTo(document, '/test/payments')).toBeUndefined();
    expect(linkTo(document, '/payments')).toBeUndefined();
  });
});
