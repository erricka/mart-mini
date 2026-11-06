/**
 * Settings → Branches: the shop's stores. Customers get delivery from the nearest one (or pick one) and
 * choose where to collect pickup orders. Each branch: name, address, hours and a map pin (from a
 * Google Maps link or by moving the map).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Pencil, Plus, Store, Trash2 } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { Badge, Button, Field, Input, Notice, Sheet, Skeleton, Toggle } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { toast } from '../../lib/toast';
import type { LatLng } from '../../lib/types';

const MapPicker = lazy(() => import('../../components/MapPicker'));

interface Branch {
  id: number;
  name: string;
  nameEn: string | null;
  address: string;
  hours: string;
  lat: number | null;
  lng: number | null;
  mapsUrl: string | null;
  active: boolean;
  sortOrder: number;
}
type Draft = Partial<Branch> & { pin?: LatLng | null };

export function BranchesManager({ canEdit }: { canEdit: boolean }) {
  const { t } = useT();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['admin', 'branches'], queryFn: () => api<{ branches: Branch[] }>('/admin/branches').then((r) => r.branches) });
  const [editing, setEditing] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<Branch | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'branches'] });
    qc.invalidateQueries({ queryKey: ['shop'] });
  };
  const remove = useMutation({
    mutationFn: (b: Branch) => api(`/admin/branches/${b.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast(t('br.removed'), 'success');
      setRemoving(null);
      refresh();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-semibold">{t('br.title')}</div>
          <p className="text-sm text-muted">{t('br.hint')}</p>
        </div>
        {canEdit && (
          <Button size="sm" variant="secondary" className="shrink-0 whitespace-nowrap" onClick={() => setEditing({ active: true, sortOrder: (list.data?.length ?? 0) })}>
            <Plus className="h-4 w-4" />
            {t('br.add')}
          </Button>
        )}
      </div>
      {list.isLoading ? (
        <Skeleton className="h-20" />
      ) : (
        <div className="divide-y divide-line rounded-2xl ring-1 ring-line">
          {list.data!.length === 0 && <p className="p-4 text-sm text-muted">{t('br.none')}</p>}
          {list.data!.map((b) => (
            <div key={b.id} className="flex items-start gap-3 p-3.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand/10 text-brand">
                <Store className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0 flex-1 text-sm">
                <div className="flex flex-wrap items-center gap-2 font-semibold">
                  {b.name}
                  {!b.active && <Badge className="bg-slate-100 text-slate-700">{t('br.closed')}</Badge>}
                  {b.lat == null && <Badge className="bg-amber-100 text-amber-900">{t('br.no_pin')}</Badge>}
                </div>
                {b.address && <div className="text-muted">{b.address}</div>}
                {b.hours && <div className="text-xs text-muted">{b.hours}</div>}
              </div>
              {canEdit && (
                <div className="flex shrink-0 gap-1">
                  <button className="grid h-9 w-9 place-items-center rounded-xl text-muted hover:bg-surface-2" aria-label={t('common.edit')} onClick={() => setEditing({ ...b, pin: b.lat != null && b.lng != null ? { lat: b.lat, lng: b.lng } : null })}>
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button className="grid h-9 w-9 place-items-center rounded-xl text-muted hover:bg-rose-50 hover:text-rose-600" aria-label={t('br.remove')} onClick={() => setRemoving(b)}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <BranchEditor draft={editing} onClose={() => setEditing(null)} onSaved={refresh} />
      <Sheet open={!!removing} onClose={() => setRemoving(null)} title={t('br.remove_title', { name: removing?.name ?? '' })}>
        <p className="text-sm text-muted">{t('br.remove_text')}</p>
        <div className="mt-5 grid gap-2">
          <Button block size="lg" variant="danger" loading={remove.isPending} onClick={() => removing && remove.mutate(removing)}>
            <Trash2 className="h-4 w-4" />
            {t('br.remove')}
          </Button>
          <Button block variant="ghost" onClick={() => setRemoving(null)}>
            {t('common.cancel')}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

function BranchEditor({ draft, onClose, onSaved }: { draft: Draft | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useT();
  const [f, setF] = useState<Draft>({});
  const [loaded, setLoaded] = useState<Draft | null>(null);
  if (draft !== loaded) {
    setLoaded(draft);
    setF(draft ?? {});
  }
  const set = (patch: Draft) => setF((prev) => ({ ...prev, ...patch }));
  const locate = useMutation({
    mutationFn: () => api<{ pin: LatLng }>('/admin/settings/locate', { body: { input: f.mapsUrl ?? '' } }),
    onSuccess: (r) => {
      set({ pin: r.pin });
      toast(t('as.dm_found'), 'success');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: (f.name ?? '').trim(),
        nameEn: f.nameEn?.trim() || null,
        address: f.address?.trim() ?? '',
        hours: f.hours?.trim() ?? '',
        lat: f.pin?.lat ?? null,
        lng: f.pin?.lng ?? null,
        mapsUrl: f.mapsUrl?.trim() || null,
        active: f.active ?? true,
        sortOrder: Number(f.sortOrder) || 0,
      };
      return f.id ? api(`/admin/branches/${f.id}`, { method: 'PUT', body }) : api('/admin/branches', { body });
    },
    onSuccess: () => {
      toast(t('br.saved'), 'success');
      onSaved();
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  return (
    <Sheet open={!!draft} onClose={onClose} title={f.id ? t('br.edit') : t('br.add')} wide>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('br.name')}>
            <Input value={f.name ?? ''} onChange={(e) => set({ name: e.target.value })} placeholder="mart25 — សាខា ២" />
          </Field>
          <Field label={t('br.name_en')}>
            <Input value={f.nameEn ?? ''} onChange={(e) => set({ nameEn: e.target.value })} placeholder="mart25 — Branch 2" />
          </Field>
        </div>
        <Field label={t('br.address')}>
          <Input value={f.address ?? ''} onChange={(e) => set({ address: e.target.value })} />
        </Field>
        <Field label={t('br.hours')}>
          <Input value={f.hours ?? ''} onChange={(e) => set({ hours: e.target.value })} placeholder="7:00 – 21:00" />
        </Field>
        <div className="space-y-2">
          <div className="text-sm font-semibold">{t('br.location')}</div>
          <div className="flex gap-2">
            <Input value={f.mapsUrl ?? ''} onChange={(e) => set({ mapsUrl: e.target.value })} placeholder={t('as.dm_paste')} />
            <Button variant="secondary" disabled={(f.mapsUrl ?? '').trim().length < 3} loading={locate.isPending} onClick={() => locate.mutate()}>
              {t('as.dm_find')}
            </Button>
          </div>
          {!f.pin && <Notice tone="warn">{t('br.pin_needed')}</Notice>}
          <Suspense fallback={<Skeleton className="h-[260px] rounded-xl" />}>
            <MapPicker value={f.pin ?? null} onChange={(p) => set({ pin: p })} pinEmoji="🏪" height={260} />
          </Suspense>
          {f.pin && (
            <p className="flex items-center gap-1.5 text-xs text-muted tabular-nums">
              <MapPin className="h-3.5 w-3.5" />
              {f.pin.lat.toFixed(6)}, {f.pin.lng.toFixed(6)}
            </p>
          )}
        </div>
        <Toggle checked={f.active ?? true} onChange={(v) => set({ active: v })} label={t('br.open')} hint={t('br.open_hint')} />
        <Button block size="lg" disabled={!(f.name ?? '').trim()} loading={save.isPending} onClick={() => save.mutate()}>
          {t('common.save')}
        </Button>
      </div>
    </Sheet>
  );
}
