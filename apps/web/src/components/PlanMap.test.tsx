// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { routeColour } from './PlanMap.js';

afterEach(() => document.documentElement.style.removeProperty('--brand'));

describe('routeColour', () => {
  it('is the empty string (Leaflet default) when the token is not defined', () => {
    expect(routeColour()).toBe('');
  });

  it('reads the --brand token from the page at run time', () => {
    document.documentElement.style.setProperty('--brand', ' #123456 ');
    expect(routeColour()).toBe('#123456');
  });
});
