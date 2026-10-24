import { describe, expect, it } from 'vitest';
import { DEMO_PLACE } from './index.js';

describe('DEMO_PLACE', () => {
  it('is Vijay Nagar, Indore, the one place the demo shops are laid out around', () => {
    expect(DEMO_PLACE).toEqual({ lat: 22.7196, lng: 75.8577, label: 'Vijay Nagar, Indore' });
  });
});
