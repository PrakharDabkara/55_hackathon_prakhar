import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import { mapPoints } from '../lib/errand.js';
import type { MapStop } from '../lib/errand.js';
import { pinSvg } from '../lib/pins.js';

interface Props {
  /** Where the customer is: the start of the route. */
  origin: { lat: number; lng: number };
  /** The shops, numbered in the order to visit them. */
  stops: MapStop[];
  label: string;
  youAreHere: string;
}

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const startIcon = L.divIcon({
  html: pinSvg('user'),
  className: 'km-pin',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

/** A numbered marker. No inline style: the page's Content-Security-Policy forbids it (ADR-0017). */
const stopIcon = (n: number) =>
  L.divIcon({
    html: `<span class="km-stop-num">${n}</span>`,
    className: 'km-stop',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });

/**
 * The route of one plan: the customer's start, numbered shops and a line through them in order.
 * Like ResultsMap it is the only place that touches Leaflet, so screens test without a real map.
 */
export function PlanMap({ origin, stops, label, youAreHere }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

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
    layer.current = L.layerGroup().addTo(created);
    return () => {
      created.remove();
      map.current = null;
      layer.current = null;
    };
    // One map per mounted screen; the start does not move.
  }, []);

  // Draws the route, then fits the view to every point. Fitting needs the frame's real size, so it
  // runs again whenever the frame changes size (the plan appearing, a rotation, a late layout).
  useEffect(() => {
    const group = layer.current;
    const current = map.current;
    const frame = container.current;
    if (!group || !current || !frame) return;
    group.clearLayers();
    const { points, shown } = mapPoints(origin, stops);
    if (shown.length > 0)
      L.polyline(points, { color: '#0a6b35', weight: 4, opacity: 0.85 }).addTo(group);
    L.marker([origin.lat, origin.lng], {
      icon: startIcon,
      title: youAreHere,
      keyboard: false,
    }).addTo(group);
    for (const stop of shown)
      L.marker([stop.lat, stop.lng], {
        icon: stopIcon(stop.n),
        title: `${stop.n}. ${stop.label}`,
        keyboard: false,
      }).addTo(group);
    const fit = () => {
      current.invalidateSize();
      if (points.length > 0)
        current.fitBounds(L.latLngBounds(points), {
          padding: [32, 32],
          maxZoom: 16,
          animate: false,
        });
    };
    fit();
    const watcher = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    watcher?.observe(frame);
    return () => watcher?.disconnect();
  }, [stops, origin, youAreHere]);

  return <div ref={container} className="results-map" role="region" aria-label={label} />;
}
