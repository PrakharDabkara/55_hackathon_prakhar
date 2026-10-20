// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrandMark } from './BrandMark.js';

describe('BrandMark', () => {
  it('is one decorative svg: a slip with two ink lines and a pin dot on a rounded square', () => {
    const { container } = render(<BrandMark size={32} />);
    const svg = container.querySelector('svg.brand-mark') as SVGSVGElement;
    expect(svg).toBeTruthy();
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('width')).toBe('32');
    expect(svg.querySelectorAll('.bm-bg')).toHaveLength(1);
    expect(svg.querySelectorAll('.bm-paper')).toHaveLength(1);
    expect(svg.querySelectorAll('.bm-ink')).toHaveLength(2);
    expect(svg.querySelectorAll('.bm-pin')).toHaveLength(1);
  });

  it('uses no colour of its own: it is styled by tokens in ui.css', () => {
    const { container } = render(<BrandMark size={48} />);
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b|fill="|stroke="/);
  });
});
