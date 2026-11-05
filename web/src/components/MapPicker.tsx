/**
 * Map pin picker. Delivery-app style: the pin stays in the middle and the customer moves the map
 * under it. Uses Google Maps (with address auto-fill) when the shop has a Google Maps key, otherwise
 * — or if Google can't load — the free OpenStreetMap map. Loaded lazily.
 */
import { LocateFixed, MapPin } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { allowGoogle, reverseGeocode, type GeoAddress } from '../lib/googleMaps';
import { useT } from '../lib/i18n';
import { useShop } from '../lib/queries';
import { getCurrentLocation, haptic } from '../lib/telegram';
import type { LatLng } from '../lib/types';
import { metresBetween, round6 } from './maps/shared';
import { cx } from './ui';

const GoogleMapView = lazy(() => import('./maps/GoogleMapView'));

// Frugal address look-ups (Google's free amount is per month): only after the map has been still for
// a moment, only when the pin really moved, and at most a few per checkout.
const LOOKUP_DELAY_MS = 1200;
const MIN_MOVE_M = 40;
const MAX_LOOKUPS = 6;
const LeafletMapView = lazy(() => import('./maps/LeafletMapView'));

export { PHNOM_PENH } from './maps/shared';

export default function MapPicker({
  value,
  onChange,
  store,
  pinEmoji = '📍',
  height = 260,
  hint,
  onAddress,
}: {
  value: LatLng | null;
  onChange: (p: LatLng) => void;
  /** Shown as a 🏪 marker (customer maps). */
  store?: LatLng | null;
  pinEmoji?: string;
  height?: number;
  /** Shown over the map until a pin is chosen. */
  hint?: string;
  /** Google only: called with the street address under the pin (after the map stops moving). */
  onAddress?: (a: GeoAddress) => void;
}) {
  const { t } = useT();
  const shop = useShop();
  const apiKey = shop.data?.mapsApiKey ?? null;
  const [googleFailed, setGoogleFailed] = useState(false);
  // Each Google map shown is counted on the server (keeps Google free); "no" → the free map.
  const [googleOk, setGoogleOk] = useState<boolean | null>(null);
  useEffect(() => {
    if (!apiKey) return setGoogleOk(false);
    let live = true;
    void allowGoogle('map').then((ok) => live && setGoogleOk(ok));
    return () => {
      live = false;
    };
  }, [apiKey]);
  const useGoogle = !!apiKey && googleOk === true && !googleFailed;
  const deciding = shop.isLoading || (!!apiKey && googleOk === null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onAddressRef = useRef(onAddress);
  onAddressRef.current = onAddress;
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState(false);
  const [address, setAddress] = useState<{ status: 'idle' | 'looking' | 'found' | 'none'; text?: string }>({ status: 'idle' });
  const lastLookup = useRef<LatLng | null>(null);
  /** Address look-ups used on this map (each one counts against Google's free monthly amount). */
  const lookups = useRef(0);

  // Pin → street address (debounced; skipped for tiny nudges to keep Geocoding calls low).
  const wantsAddress = !!onAddress;
  useEffect(() => {
    if (!useGoogle || !value || !onAddressRef.current) return;
    if (lastLookup.current && metresBetween(lastLookup.current, value) < MIN_MOVE_M) return;
    if (lookups.current >= MAX_LOOKUPS) return; // keep the last filled address; the customer can edit it
    setAddress({ status: 'looking' });
    const timer = setTimeout(async () => {
      lastLookup.current = value;
      lookups.current += 1;
      const a = await reverseGeocode(value);
      if (!a) return setAddress({ status: 'none' });
      setAddress({ status: 'found', text: a.formatted });
      onAddressRef.current?.(a);
    }, LOOKUP_DELAY_MS);
    return () => clearTimeout(timer);
  }, [useGoogle, wantsAddress, value?.lat, value?.lng, value]);

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

  const viewProps = { value, store, onMove: (p: LatLng) => onChangeRef.current(p) };
  const fallback = <div className="h-full w-full animate-pulse bg-surface-2" />;

  return (
    <div className="space-y-2">
      <div className="relative isolate overflow-hidden rounded-xl ring-1 ring-line" style={{ height }}>
        {deciding ? (
          fallback
        ) : (
          <Suspense fallback={fallback}>
            {useGoogle ? <GoogleMapView {...viewProps} apiKey={apiKey!} onFail={() => setGoogleFailed(true)} /> : <LeafletMapView {...viewProps} />}
          </Suspense>
        )}
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
          className={cx('absolute bottom-3 right-3 z-[500] flex items-center gap-1.5 rounded-full bg-surface px-3.5 py-2 text-sm font-semibold shadow-md ring-1 ring-line', locating && 'opacity-70')}
        >
          <LocateFixed className="h-4 w-4 text-brand" />
          {locating ? t('map.locating') : t('map.use_my_location')}
        </button>
      </div>
      {onAddress && useGoogle && address.status !== 'idle' && (
        <p className="text-sm">
          {address.status === 'looking' ? (
            <span className="text-muted">{t('map.looking_up')}</span>
          ) : address.status === 'found' ? (
            <span className="flex items-start gap-1.5 font-semibold">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
              {address.text}
            </span>
          ) : (
            <span className="text-muted">{t('map.no_address')}</span>
          )}
        </p>
      )}
      {locateError && <p className="text-xs text-rose-700 dark:text-rose-300">{t('map.locate_failed')}</p>}
    </div>
  );
}
