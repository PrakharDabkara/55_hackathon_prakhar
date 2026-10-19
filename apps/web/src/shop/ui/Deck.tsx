import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useT } from '../../i18n/index.js';

const MAX_DOTS = 7;

interface Props {
  slides: { key: string; node: ReactNode }[];
  index: number;
  onIndexChange: (index: number) => void;
}

/**
 * A row of slips you swipe through (CSS scroll-snap, no carousel library). The next slip peeks out
 * behind the current one. Arrow keys move while the deck has focus.
 */
export function Deck({ slides, index, onIndexChange }: Props) {
  const { t } = useT();
  const track = useRef<HTMLDivElement>(null);
  const settled = useRef(index);

  /** How far one slip is from the next: the width of a slide. */
  const step = () => {
    const [first, second] = Array.from(track.current?.children ?? []) as HTMLElement[];
    if (!first) return 0;
    return second ? second.offsetLeft - first.offsetLeft : first.offsetWidth;
  };

  // Follow the index when something else (the arrow buttons, an answered slip leaving) changes it.
  useEffect(() => {
    const el = track.current;
    if (!el || step() === 0 || settled.current === index) return;
    settled.current = index;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo?.({ left: index * step(), behavior: reduce ? 'auto' : 'smooth' });
  }, [index]);

  function onScroll() {
    const el = track.current;
    if (!el || step() === 0) return;
    const next = Math.round(el.scrollLeft / step());
    if (next !== settled.current && next >= 0 && next < slides.length) {
      settled.current = next;
      onIndexChange(next);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'ArrowRight' && index < slides.length - 1) {
      event.preventDefault();
      onIndexChange(index + 1);
    } else if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      onIndexChange(index - 1);
    }
  }

  const dots = Math.min(slides.length, MAX_DOTS);
  const extra = slides.length - dots;

  return (
    <div className="sh-deck">
      <div
        ref={track}
        className="sh-deck__track"
        role="group"
        aria-label={t.shop.deckLabel}
        tabIndex={0}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
      >
        {slides.map(({ key, node }, i) => (
          <div key={key} className="sh-deck__slide">
            {/* The next slip, 8 px out from behind the one in front and turned 2 degrees. */}
            {i === index && i < slides.length - 1 && (
              <span className="sh-peek" aria-hidden="true" />
            )}
            <div className="sh-deck__front">{node}</div>
          </div>
        ))}
      </div>
      <div className="sh-dots" aria-hidden="true">
        {Array.from({ length: dots }, (_, i) => (
          <span
            key={i}
            className="sh-dot"
            {...(i === index && { 'aria-current': 'true' as const })}
          />
        ))}
        {extra > 0 && <span className="sh-dots__more">{t.shop.dotsMore(extra)}</span>}
      </div>
    </div>
  );
}
