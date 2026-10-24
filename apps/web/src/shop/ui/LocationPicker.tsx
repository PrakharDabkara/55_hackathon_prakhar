import { useState } from 'react';
import { useT } from '../../i18n/index.js';
import { currentPosition, DEFAULT_CENTRE, type LatLng } from '../lib/geo.js';
import { Button } from '../../ui/Button.js';
import { Icon } from '../../ui/Icon.js';
import { PinMap } from './PinMap.js';

interface Props {
  /** The place the shop confirmed, or null before there is one. */
  value: LatLng | null;
  onChange: (position: LatLng) => void;
  /** Marks the title with * (the shop cannot start without a place). */
  required?: boolean;
  /** For tests: a stand-in for the phone's location. */
  locate?: () => Promise<LatLng | null>;
}

type Phase = 'idle' | 'finding' | 'found' | 'denied';

/**
 * "Shop location": use the phone's position, or drag the pin to the shop. Until the shop has moved
 * or confirmed the pin, the value stays empty, so a guess at the city centre is never saved.
 */
export function LocationPicker({
  value,
  onChange,
  required = false,
  locate = currentPosition,
}: Props) {
  const { t } = useT();
  const s = t.shop;
  const [phase, setPhase] = useState<Phase>('idle');

  async function useMyLocation() {
    setPhase('finding');
    const here = await locate();
    if (here) {
      setPhase('found');
      onChange(here);
    } else {
      setPhase('denied');
    }
  }

  const showMap = value !== null || phase === 'found' || phase === 'denied';
  return (
    <section className="sh-field" aria-labelledby="location-title">
      <h2 id="location-title" className={`sh-label${required ? ' sh-label--required' : ''}`}>
        {s.locationTitle}
      </h2>
      <Button
        variant="secondary"
        disabled={phase === 'finding'}
        onClick={() => void useMyLocation()}
      >
        <Icon name="pin" />
        {s.useLocation}
      </Button>
      {showMap && (
        <>
          <PinMap
            pin={value ?? DEFAULT_CENTRE}
            confirmed={value !== null}
            label={s.mapLabel}
            onMove={onChange}
          />
          <p className="sh-helper">
            {phase === 'denied' && value === null ? s.pinHelperDenied : s.pinHelper}
          </p>
        </>
      )}
    </section>
  );
}
