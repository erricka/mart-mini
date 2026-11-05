/**
 * "📷 Upload photos": pick many photos at once. Each file is matched to a product by its file name —
 * the product's barcode/code (8934868197911.jpg) or its exact name (សាប៊ូទឹក Downy.jpg). A preview
 * shows the matches before anything is saved; existing photos are kept unless "replace" is ticked.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, cx, Notice, Sheet, Spinner } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { uploadProductPhoto } from '../../lib/image';
import { useT, type TKey } from '../../lib/i18n';
import { toast } from '../../lib/toast';
import { uploadPhotos } from '../../lib/xlsxImages';

type Status = 'matched' | 'kept' | 'none' | 'ambiguous' | 'duplicate';
interface Match {
  key: string;
  status: Status;
  productId?: number;
  productName?: string;
  sku?: string | null;
}

const keyOf = (f: File) => f.name.replace(/\.[^.]+$/, '').trim();
const TONE: Record<Status, string> = {
  matched: 'bg-emerald-100 text-emerald-800',
  kept: 'bg-slate-100 text-slate-700',
  none: 'bg-rose-100 text-rose-800',
  ambiguous: 'bg-amber-100 text-amber-900',
  duplicate: 'bg-amber-100 text-amber-900',
};

export function PhotoUploads({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useT();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFiles([]);
    setMatches(null);
    setProgress(null);
    setError(null);
    if (input.current) input.current.value = '';
  };
  const close = () => {
    reset();
    onClose();
  };

  const match = async (fs: File[], rep: boolean) => {
    if (!fs.length) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ results: Match[] }>('/admin/products/photos', { body: { dryRun: true, replace: rep, items: fs.map((f) => ({ key: keyOf(f) })) } });
      setMatches(r.results);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (files.length) void match(files, replace);
  }, [replace]); // eslint-disable-line react-hooks/exhaustive-deps

  const toUpload = matches ? files.filter((_, i) => matches[i]?.status === 'matched') : [];
  // Thumbnails: one preview link per chosen file, released when the selection changes.
  const thumbs = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => thumbs.forEach((u) => URL.revokeObjectURL(u)), [thumbs]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      setProgress({ done: 0, total: toUpload.length });
      const urls = await uploadPhotos(
        toUpload.map((f) => ({ key: keyOf(f), blob: f, name: f.name })),
        uploadProductPhoto,
        (done, total) => setProgress({ done, total }),
      );
      const r = await api<{ matched: number }>('/admin/products/photos', {
        body: { dryRun: false, replace, items: [...urls].map(([key, url]) => ({ key, url })) },
      });
      toast(t('ph.done', { n: r.matched }), 'success');
      qc.invalidateQueries({ queryKey: ['admin', 'products'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      close();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <Sheet open={open} onClose={close} title={t('ph.title')} wide>
      <div className="space-y-4">
        <ol className="space-y-1.5 text-sm">
          <li>{t('ph.step1')}</li>
          <li className="text-muted">{t('ph.step2')}</li>
        </ol>
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-line p-6 text-center hover:border-brand/60">
          <input
            ref={input}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              const fs = Array.from(e.target.files ?? []);
              setFiles(fs);
              setMatches(null);
              void match(fs, replace);
            }}
          />
          <span className="text-4xl">🖼️</span>
          <span className="font-bold text-brand">{files.length ? t('ph.chosen', { n: files.length }) : t('ph.choose')}</span>
        </label>

        {busy && !matches && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Spinner className="h-4 w-4" /> {t('ph.matching')}
          </p>
        )}

        {matches && (
          <>
            <p className="text-sm font-semibold">{t('ph.summary', { ok: toUpload.length, total: files.length })}</p>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
              {t('ph.replace')}
            </label>
            <div className="max-h-[40vh] overflow-auto rounded-2xl ring-1 ring-line">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-line">
                  {files.map((f, i) => {
                    const m = matches[i];
                    return (
                      <tr key={f.name + i}>
                        <td className="w-14 px-3 py-2">
                          <img src={thumbs[i]} alt="" className="h-10 w-10 rounded-lg object-cover" />
                        </td>
                        <td className="px-2 py-2">
                          <div className="font-semibold">{m?.productName ?? f.name}</div>
                          <div className="text-xs text-muted">{f.name}</div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {m && <Badge className={cx(TONE[m.status])}>{t(`ph.status_${m.status}` as TKey)}</Badge>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        <Button block size="lg" disabled={!toUpload.length || busy} loading={busy && !!progress} onClick={save}>
          {progress ? t('imp.uploading_photos', { done: progress.done, total: progress.total }) : t('ph.save', { n: toUpload.length })}
        </Button>
      </div>
    </Sheet>
  );
}
