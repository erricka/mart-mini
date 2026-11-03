/** Google map for the pin picker: reports the centre after each pan/zoom, follows outside changes. */
import { useEffect, useRef } from 'react';
import { loadGoogleMaps, onGoogleMapsFailure } from '../../lib/googleMaps';
import { useT } from '../../lib/i18n';
import type { LatLng } from '../../lib/types';
import { PHNOM_PENH, round6, sameSpot, type MapViewProps } from './shared';

export default function GoogleMapView({ apiKey, value, store, onMove, onFail }: MapViewProps & { apiKey: string; onFail: () => void }) {
  const { lang } = useT();
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  /** Last centre we know about (set by us or reported to the parent) — idle events at it are ignored. */
  const known = useRef<LatLng | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const onFailRef = useRef(onFail);
  onFailRef.current = onFail;

  useEffect(() => {
    let cancelled = false;
    let idle: google.maps.MapsEventListener | null = null;
    let marker: google.maps.OverlayView | null = null;
    const off = onGoogleMapsFailure(() => onFailRef.current());
    loadGoogleMaps(apiKey, lang)
      .then(async () => {
        const { Map, OverlayView } = (await google.maps.importLibrary('maps')) as google.maps.MapsLibrary;
        if (cancelled || !el.current) return;
        const start = value ?? store ?? PHNOM_PENH;
        known.current = start;
        const m = new Map(el.current, {
          center: start,
          zoom: value ? 17 : 14,
          gestureHandling: 'greedy', // one finger moves the map (the pin stays in the middle)
          disableDefaultUI: true,
          zoomControl: true,
          clickableIcons: false,
        });
        idle = m.addListener('idle', () => {
          const c = m.getCenter();
          if (!c) return;
          const p = { lat: round6(c.lat()), lng: round6(c.lng()) };
          if (known.current && sameSpot(known.current, p)) return;
          known.current = p;
          onMoveRef.current(p);
        });
        if (store) {
          // Store marker as a plain HTML overlay (no Map ID / deprecated Marker needed).
          class StoreMarker extends OverlayView {
            div: HTMLDivElement | null = null;
            onAdd() {
              this.div = document.createElement('div');
              this.div.className = 'map-store-marker';
              this.div.style.position = 'absolute';
              this.div.textContent = '🏪';
              this.getPanes()?.overlayLayer.appendChild(this.div);
            }
            draw() {
              const pt = this.getProjection()?.fromLatLngToDivPixel(store!);
              if (pt && this.div) {
                this.div.style.left = `${pt.x - 17}px`;
                this.div.style.top = `${pt.y - 17}px`;
              }
            }
            onRemove() {
              this.div?.remove();
              this.div = null;
            }
          }
          marker = new StoreMarker();
          marker.setMap(m);
        }
        map.current = m;
      })
      .catch(() => !cancelled && onFailRef.current());
    return () => {
      cancelled = true;
      off();
      idle?.remove();
      marker?.setMap(null);
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, store?.lat, store?.lng]);

  // Follow outside changes (saved address picked, "use my location", pasted link).
  useEffect(() => {
    const m = map.current;
    if (!m || !value) return;
    if (known.current && sameSpot(known.current, value)) return;
    known.current = value;
    m.setCenter(value);
    if ((m.getZoom() ?? 0) < 16) m.setZoom(17);
  }, [value?.lat, value?.lng, value]);

  return <div ref={el} className="h-full w-full" />;
}
