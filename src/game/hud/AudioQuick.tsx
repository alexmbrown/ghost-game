'use client';

import { useEffect, useRef, useState } from 'react';

import { useAppStore } from '@/game/state/store';
import { Icon } from '@/game/ui/icons';
import { VolumeControls } from './SettingsPanel';

/**
 * Speaker button with a pop-over of every volume, available on every screen
 * (menu, lobby, pause, results) so sound can be fixed without digging into
 * Settings. `up` opens it above the button; `align` picks the edge it lines up with.
 */
export function AudioQuick({ up = false, align = 'right' }: { up?: boolean; align?: 'left' | 'right' | 'center' }) {
  const [open, setOpen] = useState(false);
  const silent = useAppStore((s) => s.settings.muted || s.settings.master === 0);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={root} className={`audio-quick audio-quick--${align}${up ? ' audio-quick--up' : ''}`}>
      <button
        className={`gbtn gbtn--icon gbtn--slate gbtn--sm${open ? ' is-on' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-label="Sound"
        aria-expanded={open}
        title="Sound"
      >
        <Icon name={silent ? 'muted' : 'sound'} size={20} />
      </button>
      {open && (
        <div className="audio-pop" role="dialog" aria-label="Sound">
          <div className="audio-pop-title">Sound</div>
          <VolumeControls />
        </div>
      )}
    </div>
  );
}
