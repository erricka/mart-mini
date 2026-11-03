/** Free OpenStreetMap map (Leaflet) — used when no Google Maps key is set or Google can't load. */
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import { PHNOM_PENH, round6, sameSpot, type MapViewProps } from './shared';

export default function LeafletMapView({ value, store, onMove }: MapViewProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const programmatic = useRef(false);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  useEffect(() => {
    const start = value ?? store ?? PHNOM_PENH;
    const m = L.map(el.current!, { zoomControl: true, attributionControl: true }).setView([start.lat, start.lng], value ? 17 : 14);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
    }).addTo(m);
    if (store) {
      L.marker([store.lat, store.lng], {
        interactive: false,
        icon: L.divIcon({ className: '', html: '<div class="map-store-marker">🏪</div>', iconSize: [34, 34], iconAnchor: [17, 17] }),
      }).addTo(m);
    }
    m.on('moveend', () => {
      if (programmatic.current) return;
      const c = m.getCenter();
      onMoveRef.current({ lat: round6(c.lat), lng: round6(c.lng) });
    });
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current!);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store?.lat, store?.lng]);

  useEffect(() => {
    const m = map.current;
    if (!m || !value) return;
    const c = m.getCenter();
    if (!sameSpot({ lat: c.lat, lng: c.lng }, value)) {
      programmatic.current = true;
      m.setView([value.lat, value.lng], Math.max(m.getZoom(), 16), { animate: false });
      programmatic.current = false;
    }
  }, [value?.lat, value?.lng, value]);

  return <div ref={el} className="h-full w-full" />;
}
