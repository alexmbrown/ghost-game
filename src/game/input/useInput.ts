import { useEffect, useRef, type RefObject } from 'react';

const MOVE_KEYS: Record<string, keyof Keys> = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
};
const ABILITY_KEYS = new Set(['Space', 'ShiftLeft', 'ShiftRight', 'KeyE']);

interface Keys {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

/** Raw stick: x = right, y = forward (camera-relative mapping happens in GameWorld). */
export interface MoveInput {
  x: number;
  y: number;
}

interface Callbacks {
  onAbility: () => void;
  onScoreboard: (held: boolean) => void;
}

/**
 * Keyboard input. Movement lives in a ref read every frame (no re-renders);
 * the ability is edge-triggered so holding the key doesn't spam it.
 */
export function useInput(cb: Callbacks): RefObject<MoveInput> {
  const move = useRef<MoveInput>({ x: 0, y: 0 });
  const keys = useRef<Keys>({ up: false, down: false, left: false, right: false });
  const cbRef = useRef(cb);
  useEffect(() => {
    cbRef.current = cb;
  });

  useEffect(() => {
    const apply = () => {
      const k = keys.current;
      move.current.x = (k.right ? 1 : 0) - (k.left ? 1 : 0);
      move.current.y = (k.up ? 1 : 0) - (k.down ? 1 : 0);
    };
    const isTyping = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    };
    const onDown = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const binding = MOVE_KEYS[e.code];
      if (binding) {
        e.preventDefault();
        keys.current[binding] = true;
        apply();
      } else if (ABILITY_KEYS.has(e.code)) {
        e.preventDefault();
        if (!e.repeat) cbRef.current.onAbility();
      } else if (e.code === 'Tab') {
        e.preventDefault();
        cbRef.current.onScoreboard(true);
      }
    };
    const onUp = (e: KeyboardEvent) => {
      const binding = MOVE_KEYS[e.code];
      if (binding) {
        keys.current[binding] = false;
        apply();
      } else if (e.code === 'Tab') {
        cbRef.current.onScoreboard(false);
      }
    };
    const reset = () => {
      keys.current = { up: false, down: false, left: false, right: false };
      apply();
      cbRef.current.onScoreboard(false);
    };

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', reset);
    };
  }, []);

  return move;
}
