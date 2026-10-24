import { describe, expect, it } from 'vitest';
import { CATEGORIES, ROLES, coveredCategories, isCategory } from './index.js';

describe('CATEGORIES', () => {
  it('is the eight launch categories plus the five of the open catalog (ADR-0028)', () => {
    expect([...CATEGORIES]).toEqual([
      'grocery',
      'hardware',
      'electrical',
      'stationery',
      'mobile_accessories',
      'household_kitchen',
      'personal_care',
      'general_store',
      'dairy',
      'sabzi_fruit',
      'pooja',
      'medical',
      'bakery_sweets',
    ]);
    expect(CATEGORIES).not.toContain('pharmacy');
  });

  it('isCategory accepts only listed values', () => {
    expect(isCategory('grocery')).toBe(true);
    expect(isCategory('pharmacy')).toBe(false);
    expect(isCategory(42)).toBe(false);
  });
});

describe('ROLES', () => {
  it('has seeker, shop and admin', () => {
    expect([...ROLES]).toEqual(['seeker', 'shop', 'admin']);
  });
});

describe('coveredCategories (S-06)', () => {
  it('lets a general store also take everyday household, personal care and stationery items', () => {
    expect([...coveredCategories(['general_store'])].sort()).toEqual([
      'general_store',
      'household_kitchen',
      'personal_care',
      'stationery',
    ]);
  });

  it('leaves every other shop as it is', () => {
    expect(coveredCategories(['grocery', 'dairy'])).toEqual(['grocery', 'dairy']);
    expect(coveredCategories([])).toEqual([]);
  });

  it("adds nothing twice and keeps the shop's own order first", () => {
    expect(coveredCategories(['stationery', 'general_store'])).toEqual([
      'stationery',
      'general_store',
      'household_kitchen',
      'personal_care',
    ]);
  });

  it('does not make a general store a grocer, a chemist or a hardware shop', () => {
    const covered = coveredCategories(['general_store']);
    for (const other of ['grocery', 'medical', 'hardware', 'electrical', 'dairy']) {
      expect(covered).not.toContain(other);
    }
  });
});
