// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { applyTheme, readTheme, saveTheme } from './theme.js';

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('theme choice (ADR-0054)', () => {
  it('is System until the person chooses', () => {
    expect(readTheme()).toBe('system');
  });

  it('saves Dark and Light, sets data-theme, and System removes both', () => {
    saveTheme('dark');
    expect(readTheme()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    saveTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    saveTheme('system');
    expect(readTheme()).toBe('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem('km-theme')).toBeNull();
  });

  it('ignores a stored value it does not know', () => {
    localStorage.setItem('km-theme', 'neon');
    expect(readTheme()).toBe('system');
    applyTheme(readTheme());
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('still applies the choice when storage throws', () => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('blocked');
    };
    try {
      expect(() => saveTheme('dark')).not.toThrow();
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    } finally {
      Storage.prototype.setItem = real;
    }
  });
});
