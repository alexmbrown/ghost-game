'use client';

import { useUiImage } from '@/game/ui/icons';

/** Full-screen loading card: the generated loading art behind the caption once it's available. */
export function LoadingScreen({ text = 'Summoning the arena…' }: { text?: string }) {
  const art = useUiImage('loading.webp');
  return (
    <div className={`loading${art ? ' loading--art' : ''}`} style={art ? { backgroundImage: `url(${art})` } : undefined}>
      <span>{text}</span>
    </div>
  );
}
