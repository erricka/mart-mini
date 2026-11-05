/**
 * Pictures inside an .xlsx file (e.g. a POS "Product List" with an Image column), keyed by the
 * spreadsheet row they sit on. Excel stores them as drawings anchored to a cell:
 *   workbook → first sheet → its drawing → each anchor's <from><row> + the picture it embeds.
 * Pictures placed with Excel 365's "Place in cell" aren't drawings and aren't read (counted instead).
 */
import { strFromU8, unzipSync } from 'fflate';

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

export interface XlsxImages {
  /** 1-based spreadsheet row → picture */
  byRow: Map<number, Blob>;
  /** Pictures in the file that couldn't be tied to a row. */
  unplaced: number;
}

function resolve(fromFile: string, target: string) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = fromFile.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

const relsOf = (file: string) => {
  const i = file.lastIndexOf('/');
  return `${file.slice(0, i)}/_rels/${file.slice(i + 1)}.rels`;
};

function readRels(files: Record<string, Uint8Array>, owner: string): Map<string, { target: string; type: string }> {
  const out = new Map<string, { target: string; type: string }>();
  const raw = files[relsOf(owner)];
  if (!raw) return out;
  const doc = new DOMParser().parseFromString(strFromU8(raw), 'application/xml');
  for (const r of Array.from(doc.getElementsByTagNameNS('*', 'Relationship'))) {
    out.set(r.getAttribute('Id') ?? '', { target: resolve(owner, r.getAttribute('Target') ?? ''), type: r.getAttribute('Type') ?? '' });
  }
  return out;
}

export async function extractXlsxImages(file: File): Promise<XlsxImages> {
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter: (f) => f.name.startsWith('xl/') && (f.name.endsWith('.xml') || f.name.endsWith('.rels') || f.name.startsWith('xl/media/')),
  });
  const media = Object.keys(files).filter((n) => n.startsWith('xl/media/') && MIME[n.split('.').pop()!.toLowerCase()]);
  const byRow = new Map<number, Blob>();
  if (!media.length || !files['xl/workbook.xml']) return { byRow, unplaced: 0 };

  // First worksheet of the workbook.
  const wb = new DOMParser().parseFromString(strFromU8(files['xl/workbook.xml']), 'application/xml');
  const firstSheet = wb.getElementsByTagNameNS('*', 'sheet')[0];
  const sheetRid = firstSheet?.getAttribute('r:id') ?? firstSheet?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  const sheetFile = sheetRid ? readRels(files, 'xl/workbook.xml').get(sheetRid)?.target : undefined;
  const drawings = sheetFile ? [...readRels(files, sheetFile).values()].filter((r) => r.type.endsWith('/drawing')).map((r) => r.target) : [];

  const used = new Set<string>();
  for (const drawing of drawings) {
    if (!files[drawing]) continue;
    const rels = readRels(files, drawing);
    const doc = new DOMParser().parseFromString(strFromU8(files[drawing]), 'application/xml');
    const anchors = [...Array.from(doc.getElementsByTagNameNS('*', 'twoCellAnchor')), ...Array.from(doc.getElementsByTagNameNS('*', 'oneCellAnchor'))];
    for (const a of anchors) {
      const from = a.getElementsByTagNameNS('*', 'from')[0];
      const row0 = Number(from?.getElementsByTagNameNS('*', 'row')[0]?.textContent);
      const blip = a.getElementsByTagNameNS('*', 'blip')[0];
      const rid = blip?.getAttribute('r:embed') ?? blip?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed');
      const target = rid ? rels.get(rid)?.target : undefined;
      if (!Number.isInteger(row0) || !target || !files[target]) continue;
      const ext = target.split('.').pop()!.toLowerCase();
      if (!MIME[ext] || byRow.has(row0 + 1)) continue;
      byRow.set(row0 + 1, new Blob([files[target]], { type: MIME[ext] }));
      used.add(target);
    }
  }
  return { byRow, unplaced: media.filter((m) => !used.has(m)).length };
}

/** Uploads photos (resized in the browser) a few at a time; returns key → uploaded /media URL. */
export async function uploadPhotos<K>(
  items: { key: K; blob: Blob; name: string }[],
  upload: (file: File) => Promise<string>,
  onProgress: (done: number, total: number) => void,
  concurrency = 3,
): Promise<Map<K, string>> {
  const out = new Map<K, string>();
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length) {
      const it = items[next++];
      try {
        out.set(it.key, await upload(new File([it.blob], it.name, { type: it.blob.type })));
      } catch {
        /* skipped — the product keeps its emoji; the photo can be added later */
      }
      onProgress(++done, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}
