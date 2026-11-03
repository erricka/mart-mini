/**
 * Map pin picker (OpenStreetMap via Leaflet — free, no API key).
 * Delivery-app style: the pin stays in the middle and the customer moves the map under it, which is
 * much easier on a phone than dragging a marker. Loaded lazily so the shop doesn't pay for it upfront.
 */
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import { useT } from '../lib/i18n';
import { getCurrentLocation, haptic } from '../lib/telegram';
import type { LatLng } from '../lib/types';
import { cx } from './ui';

export const PHNOM_PENH: LatLng = { lat: 11.5564, lng: 104.9282 };
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export default function MapPicker({
  value,
  onChange,
  store,
  pinEmoji = '📍',
  height = 260,
  hint,
}: {
  value: LatLng | null;
  onChange: (p: LatLng) => void;
  /** Shown as a 🏪 marker (customer maps). */
  store?: LatLng | null;
  pinEmoji?: string;
  height?: number;
  /** Shown over the map until a pin is chosen. */
  hint?: string;
}) {
  const { t } = useT();
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const programmatic = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState(false);

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
      onChangeRef.current({ lat: round6(c.lat), lng: round6(c.lng) });
    });
    map.current = m;
    // The map may mount inside a sheet / collapsed section: re-measure when the box changes.
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current!);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store?.lat, store?.lng]);

  // Follow outside changes (saved address picked, "use my location", pasted link).
  useEffect(() => {
    const m = map.current;
    if (!m || !value) return;
    const c = m.getCenter();
    if (Math.abs(c.lat - value.lat) > 1e-6 || Math.abs(c.lng - value.lng) > 1e-6) {
      programmatic.current = true;
      m.setView([value.lat, value.lng], Math.max(m.getZoom(), 16), { animate: false });
      programmatic.current = false;
    }
  }, [value?.lat, value?.lng, value]);

  const locate = async () => {
    setLocating(true);
    setLocateError(false);
    const p = await getCurrentLocation();
    setLocating(false);
    if (!p) {
      haptic('error');
      setLocateError(true);
      return;
    }
    haptic('success');
    onChangeRef.current({ lat: round6(p.lat), lng: round6(p.lng) });
  };

  return (
    <div className="space-y-2">
      <div className="relative isolate overflow-hidden rounded-3xl ring-1 ring-line" style={{ height }}>
        <div ref={el} className="h-full w-full" />
        {/* Fixed centre pin — its tip marks the exact spot. */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-[500] -translate-x-1/2 -translate-y-full text-4xl drop-shadow-md">{pinEmoji}</div>
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-[500] h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink/40" />
        {!value && hint && (
          <div className="pointer-events-none absolute inset-x-3 top-3 z-[500] rounded-2xl bg-surface/95 px-3 py-2 text-center text-xs font-semibold shadow">{hint}</div>
        )}
        <button
          type="button"
          onClick={locate}
          disabled={locating}
          className={cx('absolute bottom-3 right-3 z-[500] rounded-full bg-surface px-3.5 py-2 text-sm font-bold shadow-lg ring-1 ring-line', locating && 'opacity-70')}
        >
          {locating ? t('map.locating') : t('map.use_my_location')}
        </button>
      </div>
      {locateError && <p className="text-xs text-rose-700 dark:text-rose-300">{t('map.locate_failed')}</p>}
    </div>
  );
}
