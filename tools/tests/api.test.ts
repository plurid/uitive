import { beforeAll, describe, expect, it } from 'vitest';
import { apiModel, type Model } from '../build/api-docs.ts';

let model: Model;
beforeAll(() => {
  model = apiModel();
}, 60_000);

describe('the API reference', () => {
  it('describes every public export', () => {
    expect(model.problems.undocumented).toEqual([]);
  });

  it('describes every member of every interface, class and object', () => {
    expect(model.problems.members).toEqual([]);
  });

  it('makes public every type a public declaration uses', () => {
    expect(model.problems.dangling).toEqual([]);
  });

  it('puts every export in a category, and resolves every link', () => {
    expect([...model.problems.categories, ...model.problems.links]).toEqual([]);
  });

  it('prints every signature readably', () => {
    expect(model.problems.long).toEqual([]);
  });
});
