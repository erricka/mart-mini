import { useState } from 'react';
import { cx } from './ui';

/** Real photo when available, otherwise the product's emoji on a plain tile. */
export function ProductImage({ emoji, imageUrl, className, size = 'md' }: { emoji: string; imageUrl?: string | null; color?: string; className?: string; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const [broken, setBroken] = useState(false);
  const text = { sm: 'text-3xl', md: 'text-5xl', lg: 'text-7xl', xl: 'text-[7rem]' }[size];
  if (imageUrl && !broken) {
    return <img src={imageUrl} alt="" loading="lazy" onError={() => setBroken(true)} className={cx('aspect-square w-full rounded-xl bg-surface-2 object-cover', className)} />;
  }
  return (
    <div className={cx('grid aspect-square w-full place-items-center overflow-hidden rounded-xl bg-surface-2', className)} aria-hidden>
      <span className={cx(text, 'select-none')}>{emoji}</span>
    </div>
  );
}
