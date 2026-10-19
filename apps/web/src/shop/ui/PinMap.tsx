import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { arrowDelta, type LatLng } from '../lib/geo.js';

interface Props {
  /** Where the pin is drawn. */
  pin: LatLng;
  /** False until the shop has moved the pin: it is only a starting guess. */
  confirmed: boolean;
  label: string;
  onMove: (position: LatLng) => void;
}

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const pinIcon = (confirmed: boolean) =>
  L.divIcon({
    html: '<span class="sh-pin__dot"></span>',
    className: `sh-pin${confirmed ? '' : ' sh-pin--guess'}`,
    iconSize: [32, 40],
    iconAnchor: [16, 40],
  });

/**
 * A small map with one draggable pin: drag it, tap the map to put it there, or press the arrow keys
 * while the map has focus. The only file in the shop app that touches Leaflet, so everything around
 * it is tested without a real map (jsdom cannot draw one). OpenStreetMap needs its attribution and
 * a Referer, so tiles send the origin only (ADR-0019).
 */
export function PinMap({ pin, confirmed, label, onMove }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const move = useRef(onMove);
  move.current = onMove;

  useEffect(() => {
    if (!container.current) return;
    const created = L.map(container.current, { zoomControl: true, keyboard: false }).setView(
      [pin.lat, pin.lng],
      16,
    );
    created.attributionControl.setPrefix(false);
    L.tileLayer(TILES, {
      maxZoom: 19,
      attribution: ATTRIBUTION,
      referrerPolicy: 'origin',
    } as L.TileLayerOptions).addTo(created);
    const pinMarker = L.marker([pin.lat, pin.lng], {
      draggable: true,
      keyboard: false,
      icon: pinIcon(confirmed),
    }).addTo(created);
    pinMarker.on('dragend', () => {
      const at = pinMarker.getLatLng();
      move.current({ lat: at.lat, lng: at.lng });
    });
    created.on('click', (event: L.LeafletMouseEvent) => {
      move.current({ lat: event.latlng.lat, lng: event.latlng.lng });
    });
    map.current = created;
    marker.current = pinMarker;
    // The frame may still be settling when it mounts; draw tiles for its real size.
    const settle = setTimeout(() => created.invalidateSize(), 0);
    return () => {
      clearTimeout(settle);
      created.remove();
      map.current = null;
      marker.current = null;
    };
    // One map per mounted picker; later changes of the pin are applied below.
  }, []);

  useEffect(() => {
    const current = map.current;
    const pinMarker = marker.current;
    if (!current || !pinMarker) return;
    pinMarker.setLatLng([pin.lat, pin.lng]);
    pinMarker.setIcon(pinIcon(confirmed));
    if (!current.getBounds().contains([pin.lat, pin.lng])) current.panTo([pin.lat, pin.lng]);
  }, [pin.lat, pin.lng, confirmed]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const delta = arrowDelta(event.key);
    const current = map.current;
    const pinMarker = marker.current;
    if (!delta || !current || !pinMarker) return;
    event.preventDefault();
    const point = current.latLngToContainerPoint(pinMarker.getLatLng());
    const next = current.containerPointToLatLng(L.point(point.x + delta.dx, point.y + delta.dy));
    move.current({ lat: next.lat, lng: next.lng });
  }

  return (
    <div className="sh-pinmap" role="group" aria-label={label} tabIndex={0} onKeyDown={onKeyDown}>
      <div ref={container} className="sh-pinmap__map" />
    </div>
  );
}
