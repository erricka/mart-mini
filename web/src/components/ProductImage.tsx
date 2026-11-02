import { useState } from 'react';
import { cx } from './ui';

/** Real photo when available, otherwise a colourful emoji tile (keeps the catalog fast and friendly). */
export function ProductImage({ emoji, imageUrl, color = '#22c55e', className, size = 'md' }: { emoji: string; imageUrl?: string | null; color?: string; className?: string; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const [broken, setBroken] = useState(false);
  const text = { sm: 'text-3xl', md: 'text-6xl', lg: 'text-7xl', xl: 'text-[8rem]' }[size];
  if (imageUrl && !broken) {
    return <img src={imageUrl} alt="" loading="lazy" onError={() => setBroken(true)} className={cx('aspect-square w-full rounded-2xl bg-surface-2 object-cover', className)} />;
  }
  return (
    <div
      className={cx('grid aspect-square w-full place-items-center overflow-hidden rounded-2xl', className)}
      style={{ background: `radial-gradient(circle at 30% 25%, ${color}38, ${color}14 60%, ${color}08)` }}
      aria-hidden
    >
      <span className={cx(text, 'drop-shadow-sm select-none')}>{emoji}</span>
    </div>
  );
}
