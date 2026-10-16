import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import { pinSvg, pinsKey } from '../lib/pins.js';

export interface Pin {
  id: string;
  lat: number;
  lng: number;
  kind: 'live' | 'learned';
  label: string;
}

interface Props {
  /** Where the customer is. */
  origin: { lat: number; lng: number };
  pins: Pin[];
  /** Accessible name for the map region. */
  label: string;
  youAreHere: string;
}

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const icon = (kind: 'user' | 'live' | 'learned') =>
  L.divIcon({
    html: pinSvg(kind),
    className: 'km-pin', // replaces Leaflet's default white box
    ...(kind === 'user'
      ? { iconSize: [22, 22] as [number, number], iconAnchor: [11, 11] as [number, number] }
      : { iconSize: [30, 40] as [number, number], iconAnchor: [15, 40] as [number, number] }),
  });

/**
 * The only file that touches Leaflet, so everything else can be tested without a real map (jsdom
 * cannot draw one). OpenStreetMap tiles need the attribution shown and a Referer, which the page's
 * no-referrer policy would remove, so the tile layer sends the origin only (ADR-0019).
 */
export function ResultsMap({ origin, pins, label, youAreHere }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef<L.LayerGroup | null>(null);
  const fittedFor = useRef<string>('');

  useEffect(() => {
    if (!container.current) return;
    const created = L.map(container.current, { zoomControl: true }).setView(
      [origin.lat, origin.lng],
      15,
    );
    created.attributionControl.setPrefix(false);
    L.tileLayer(TILES, {
      maxZoom: 19,
      attribution: ATTRIBUTION,
      referrerPolicy: 'origin',
    } as L.TileLayerOptions).addTo(created);
    map.current = created;
    markers.current = L.layerGroup().addTo(created);
    return () => {
      created.remove();
      map.current = null;
      markers.current = null;
      fittedFor.current = '';
    };
    // The map is made once per mounted screen; the origin is fixed for a request.
  }, []);

  useEffect(() => {
    const group = markers.current;
    const current = map.current;
    if (!group || !current) return;
    group.clearLayers();
    L.marker([origin.lat, origin.lng], {
      icon: icon('user'),
      title: youAreHere,
      keyboard: false,
    }).addTo(group);
    for (const pin of pins) {
      L.marker([pin.lat, pin.lng], {
        icon: icon(pin.kind),
        title: pin.label,
        keyboard: false,
      }).addTo(group);
    }
    // Zoom to everything whenever the pins change (a shop answers, a pin turns live), so every
    // answered shop is in view. An unchanged refresh never undoes a pan.
    const key = pinsKey(pins);
    if (key !== fittedFor.current) {
      fittedFor.current = key;
      current.invalidateSize();
      const bounds = L.latLngBounds([[origin.lat, origin.lng]]);
      for (const pin of pins) bounds.extend([pin.lat, pin.lng]);
      current.fitBounds(bounds, { padding: [32, 32], maxZoom: 16 });
    }
  }, [pins, origin, youAreHere]);

  return <div ref={container} className="results-map" role="region" aria-label={label} />;
}
