import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button, Card, ErrorState, Field, Input, Notice, Skeleton } from '../../components/ui';
import { api, apiBlob, errorMessage } from '../../lib/api';
import { useShop } from '../../lib/queries';
import { toast } from '../../lib/toast';
import { translate, useT, type TKey } from '../../lib/i18n';
import { PageHeader } from './common';

interface Links {
  botConfigured: boolean;
  usesShortName: boolean;
  links: { source: string; label: string; hint: string; url: string }[];
  signupsBySource: { source: string; count: number }[];
}

function useQrImage(source: string) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let obj: string | null = null;
    apiBlob(`/admin/qr?source=${encodeURIComponent(source)}&format=svg`)
      .then((b) => {
        obj = URL.createObjectURL(b);
        if (alive) setUrl(obj);
      })
      .catch(() => setUrl(null));
    return () => {
      alive = false;
      if (obj) URL.revokeObjectURL(obj);
    };
  }, [source]);
  return url;
}

async function downloadPng(source: string) {
  try {
    const blob = await apiBlob(`/admin/qr?source=${encodeURIComponent(source)}&format=png`);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `qr-${source}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (e) {
    toast(errorMessage(e), 'error');
  }
}

const srcLabel = (s: string) => {
  const key = `aq.src_${s}` as TKey;
  const v = translate(key);
  return v === key ? null : v;
};

export function QrPage() {
  const { t } = useT();
  const q = useQuery({ queryKey: ['admin', 'qr-links'], queryFn: () => api<Links>('/admin/qr/links') });
  const shop = useShop();
  const [custom, setCustom] = useState('');
  const [poster, setPoster] = useState<string | null>(null);
  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const count = (src: string) => d.signupsBySource.find((s) => s.source === src)?.count ?? 0;
  const validCustom = /^[A-Za-z0-9_-]{1,64}$/.test(custom);

  return (
    <div>
      <div className="no-print">
        <PageHeader title={t('aq.title')} subtitle={t('aq.subtitle')} />
        {!d.botConfigured && (
          <Notice tone="warn" className="mb-4">
            {t('aq.setup_warn')}
          </Notice>
        )}
        <div className="grid gap-4 md:grid-cols-3">
          {d.links.map((l) => (
            <QrCard
              key={l.source}
              source={l.source}
              url={l.url}
              label={srcLabel(l.source) ?? l.label}
              hint={translate(`aq.src_${l.source}_hint` as TKey)}
              signups={count(l.source)}
              onPoster={() => { setPoster(l.source); setTimeout(() => window.print(), 300); }}
            />
          ))}
        </div>
        <Card className="mt-4 max-w-xl">
          <h2 className="mb-2 font-bold">{t('aq.custom_title')}</h2>
          <div className="flex gap-2">
            <Field label={t('aq.source_tag')} hint={t('aq.source_hint')}><Input value={custom} onChange={(e) => setCustom(e.target.value.trim())} placeholder="aisle5" /></Field>
          </div>
          {validCustom && <div className="mt-3"><QrCard source={custom} label={t('aq.custom', { s: custom })} hint="" url={d.links[0].url.replace(/(startapp=|src=)store/, `$1${custom}`)} signups={count(custom)} onPoster={() => { setPoster(custom); setTimeout(() => window.print(), 300); }} /></div>}
        </Card>
      </div>
      {poster && <Poster source={poster} shopName={shop.data?.shopName ?? 'mart25'} />}
    </div>
  );
}

function QrCard({ source, label, hint, url, signups, onPoster }: { source: string; label: string; hint: string; url: string; signups: number; onPoster: () => void }) {
  const { t } = useT();
  const img = useQrImage(source);
  return (
    <Card className="flex flex-col items-center text-center">
      {img ? <img src={img} alt={t('aq.qr_alt', { label })} className="aspect-square w-44 rounded-xl bg-white p-1" /> : <Skeleton className="aspect-square w-44" />}
      <div className="mt-2 font-bold">{label}</div>
      {hint && <div className="text-xs text-muted">{hint}</div>}
      <div className="mt-1 text-xs text-muted">{t('aq.signups', { n: signups })}</div>
      <button className="mt-2 max-w-full truncate text-xs text-brand underline" onClick={() => { navigator.clipboard?.writeText(url); toast(t('aq.copied'), 'success'); }}>{url}</button>
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="secondary" onClick={() => downloadPng(source)}>{t('aq.png')}</Button>
        <Button size="sm" onClick={onPoster}>{t('aq.poster')}</Button>
      </div>
    </Card>
  );
}

function Poster({ source, shopName }: { source: string; shopName: string }) {
  const img = useQrImage(source);
  return (
    <div className="print-only fixed inset-0 bg-white p-12 text-center text-black">
      {/* Posters are always bilingual: Khmer first, English below. */}
      <div className="text-6xl">🧺⭐</div>
      <h1 className="mt-4 text-5xl font-black">{shopName}</h1>
      <p className="mt-4 text-3xl font-bold">{translate('aq.poster_title', {}, 'km')}</p>
      <p className="mt-1 text-xl">{translate('aq.poster_title', {}, 'en')}</p>
      {img && <img src={img} alt="" className="mx-auto mt-8 w-[55%]" />}
      <p className="mt-8 text-xl">{translate('aq.poster_perks', {}, 'km')}</p>
      <p className="mt-1 text-lg">{translate('aq.poster_perks', {}, 'en')}</p>
    </div>
  );
}
