'use client';

import { Canvas } from '@react-three/fiber';
import { useCallback, useEffect, useRef, useState } from 'react';

import { LoadingScreen } from '@/components/LoadingScreen';
import { Hud } from '@/game/hud/Hud';
import { useInput } from '@/game/input/useInput';
import { Ticker } from '@/game/session/ticker';
import { useAppStore } from '@/game/state/store';
import { GameWorld } from './GameWorld';
import { themeFor } from './mapThemes';
import { useAdaptiveDpr } from './useAdaptiveDpr';

/**
 * Client-only game screen: the WebGL canvas, HUD overlay and name-tag layer.
 * Loaded via next/dynamic with `ssr: false` so it never renders on the server.
 */
export default function GameView() {
  const session = useAppStore((s) => s.session);
  const sessionKey = useAppStore((s) => s.sessionKey);
  const quality = useAppStore((s) => s.settings.quality);
  const setPaused = useAppStore((s) => s.setPaused);
  const tagLayer = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const [scoreboard, setScoreboard] = useState(false);
  // The session whose arena has finished loading (a new match starts covered again).
  const [readyKey, setReadyKey] = useState<number | null>(null);
  const onReady = useCallback(() => setReadyKey(sessionKey), [sessionKey]);
  const adaptive = useAdaptiveDpr(quality === 'high');
  const [locked, setLocked] = useState(false);

  const move = useInput({
    onAbility: () => session?.pressAbility(),
    onScoreboard: setScoreboard,
  });

  // Simulation clock (keeps an online host ticking in background tabs).
  useEffect(() => {
    if (!session) return;
    const ticker = new Ticker((now) => session.tick(now));
    ticker.start();
    return () => ticker.stop();
  }, [session]);

  // Esc releases the mouse: offline that pauses the match (online can't pause).
  useEffect(() => {
    const onChange = () => {
      const isLocked = !!document.pointerLockElement;
      setLocked(isLocked);
      const s = useAppStore.getState();
      const live = s.session && !s.session.online && s.session.view.phase !== 'ended';
      if (!isLocked && live && !s.showSettings) setPaused(true);
      if (isLocked) setPaused(false);
    };
    document.addEventListener('pointerlockchange', onChange);
    return () => document.removeEventListener('pointerlockchange', onChange);
  }, [setPaused]);

  const resume = useCallback(() => {
    setPaused(false);
    const canvas = screenRef.current?.querySelector('canvas');
    const p = canvas?.requestPointerLock?.() as unknown as Promise<void> | undefined;
    p?.catch?.(() => {});
  }, [setPaused]);

  if (!session) return null;
  const theme = themeFor(session.view.mapId);
  const high = quality === 'high';

  return (
    <div className="game-screen" ref={screenRef}>
      <Canvas
        key={sessionKey}
        shadows={high}
        dpr={adaptive.dpr}
        camera={{ position: [0, 9, 14], fov: 55, near: 0.1, far: 220 }}
        gl={{ antialias: !high, powerPreference: 'high-performance' }}
      >
        <color attach="background" args={[theme.background]} />
        <fog attach="fog" args={[theme.fog.color, theme.fog.near, theme.fog.far]} />
        {adaptive.monitor}
        <GameWorld session={session} move={move} tagLayer={tagLayer} onReady={onReady} />
      </Canvas>
      <div className="nametags" ref={tagLayer} />
      <Hud scoreboard={scoreboard} locked={locked} onResume={resume} />
      {readyKey !== sessionKey && <ArenaLoading key={`loading-${sessionKey}`} />}
    </div>
  );
}

/** Covers the arena until its models and textures are in (usually instant: the menu preloads the map). */
function ArenaLoading() {
  const [giveUp, setGiveUp] = useState(false);
  useEffect(() => {
    // Never hold the match hostage to a slow asset.
    const t = setTimeout(() => setGiveUp(true), 15000);
    return () => clearTimeout(t);
  }, []);
  if (giveUp) return null;
  return (
    <div className="arena-loading">
      <LoadingScreen />
    </div>
  );
}
