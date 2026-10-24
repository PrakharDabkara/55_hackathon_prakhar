// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShutterIntro } from './ShutterIntro.js';

const reduced = (matches: boolean) =>
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );

beforeEach(() => {
  vi.useFakeTimers();
  reduced(false);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ShutterIntro (A-08)', () => {
  it('draws a decorative shutter that is gone by 900 ms', () => {
    const onDone = vi.fn();
    render(<ShutterIntro onDone={onDone} />);
    const shutter = screen.getByTestId('shutter-intro');
    expect(shutter.getAttribute('aria-hidden')).toBe('true');
    expect(shutter.querySelectorAll('.sh-shutter__slat').length).toBeGreaterThanOrEqual(6);
    act(() => vi.advanceTimersByTime(899));
    expect(onDone).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('ends on a tap or a key, once', () => {
    const onDone = vi.fn();
    render(<ShutterIntro onDone={onDone} />);
    fireEvent.click(screen.getByTestId('shutter-intro'));
    fireEvent.keyDown(window, { key: 'Enter' });
    act(() => vi.advanceTimersByTime(2000));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('is skipped entirely when the person prefers reduced motion', () => {
    reduced(true);
    const onDone = vi.fn();
    render(<ShutterIntro onDone={onDone} />);
    expect(screen.queryByTestId('shutter-intro')).toBeNull();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('is CSS only, under 900 ms, in theme colours, and off under reduced motion', () => {
    const css = readFileSync(join(process.cwd(), 'apps/web/src/shop/screens/screens.css'), 'utf8');
    const rule = /\.sh-shutter\b[^{]*\{[^}]*\}/g;
    const block = (css.match(rule) ?? []).join('\n');
    const ms = [...block.matchAll(/(\d+)ms/g)].map((m) => Number(m[1]));
    expect(ms.length).toBeGreaterThan(0);
    expect(Math.max(...ms)).toBeLessThanOrEqual(900);
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*\.sh-shutter\s*\{\s*display:\s*none/,
    );
  });
});
