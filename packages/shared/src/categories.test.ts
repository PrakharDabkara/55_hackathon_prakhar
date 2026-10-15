import { describe, expect, it } from 'vitest';
import { CATEGORIES, ROLES, isCategory } from './index.js';

describe('CATEGORIES', () => {
  it('is the eight launch categories, without pharmacy', () => {
    expect([...CATEGORIES]).toEqual([
      'grocery',
      'hardware',
      'electrical',
      'stationery',
      'mobile_accessories',
      'household_kitchen',
      'personal_care',
      'general_store',
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
