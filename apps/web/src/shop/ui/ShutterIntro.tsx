import { useEffect, useRef, useState } from 'react';

const SLATS = 8;
/** The whole rise is under a second (the CSS runs 800 ms); this is the latest it may linger. */
const MAX_MS = 900;

/**
 * After a shop logs in: a shop shutter rolls up off the screen, then the shop home is there. Pure
 * decoration over a screen that is already loading, so it never waits for anything: it ends on its
 * own timer, on a tap or on a key, and not at all for people who ask for reduced motion.
 */
export function ShutterIntro({ onDone }: { onDone: () => void }) {
  const [reduce] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
  );
  const finished = useRef(false);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const finish = () => {
      if (finished.current) return;
      finished.current = true;
      done.current();
    };
    if (reduce) {
      finish();
      return;
    }
    const timer = window.setTimeout(finish, MAX_MS);
    window.addEventListener('keydown', finish);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', finish);
    };
  }, [reduce]);

  if (reduce) return null;
  return (
    <div
      className="sh-shutter"
      data-testid="shutter-intro"
      aria-hidden="true"
      onClick={() => {
        if (finished.current) return;
        finished.current = true;
        done.current();
      }}
    >
      {Array.from({ length: SLATS }, (_, i) => (
        <span key={i} className="sh-shutter__slat" />
      ))}
      <span className="sh-shutter__handle" />
    </div>
  );
}
