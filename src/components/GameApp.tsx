'use client';

import dynamic from 'next/dynamic';
import { useEffect, useSyncExternalStore } from 'react';

import { audio } from '@/game/audio/audio';
import { characterFor } from '@/game/core/characters';
import type { TeamId } from '@/game/core/types';
import { preloadCreatureModels } from '@/game/r3f/creatureModels';
import { useAppStore } from '@/game/state/store';
import { useUiImage } from '@/game/ui/icons';
import { LoadingScreen } from './LoadingScreen';
import { Lobby } from './Lobby';
import { MainMenu } from './MainMenu';

// The WebGL canvas must never render on the server (no DOM/WebGL there),
// so the whole game view is loaded client-side only.
const GameView = dynamic(() => import('@/game/r3f/GameView'), {
  ssr: false,
  loading: () => <LoadingScreen />,
});

// Live 3D backdrop shared by the menu and lobby (stays mounted between them).
const MenuScene = dynamic(() => import('@/game/r3f/MenuScene'), { ssr: false });

const noopSubscribe = () => () => {};

/**
 * What the menu scene shows: your faction and character front and centre, in
 * the selected map (the room's in the lobby, else your Quick Play picks).
 */
function useFeatured(): { team: TeamId; character: string; mapId: string } {
  const offline = useAppStore((s) => s.offline);
  const me = useAppStore((s) => s.online?.lobby?.players.find((p) => p.id === s.online?.selfId));
  const roomMap = useAppStore((s) => s.online?.lobby?.settings.mapId);
  const team = me?.team ?? offline.team;
  return { team, character: characterFor(me ? me.character : offline.character, team), mapId: roomMap ?? offline.mapId };
}

export function GameApp() {
  const screen = useAppStore((s) => s.screen);
  // Persisted settings/name live in localStorage, so render only on the client
  // (the static HTML shows the splash) to avoid hydration mismatches.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);

  useEffect(() => {
    // Dev-only handle for debugging/tests (stripped from production builds).
    if (process.env.NODE_ENV !== 'production') (window as unknown as Record<string, unknown>).__store = useAppStore;
    preloadCreatureModels();
    audio.setVolumes(useAppStore.getState().settings);

    // Browsers only allow audio after a user gesture.
    const unlock = () => audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    // Global UI sounds for every button.
    let hovered: Element | null = null;
    const onOver = (e: MouseEvent) => {
      const btn = (e.target as Element | null)?.closest?.('button:not(:disabled)') ?? null;
      if (btn && btn !== hovered) audio.play('ui.hover');
      hovered = btn;
    };
    const onClick = (e: MouseEvent) => {
      const btn = (e.target as Element | null)?.closest?.('button:not(:disabled)');
      if (btn && !btn.classList.contains('silent')) audio.play('ui.click');
    };
    document.addEventListener('mouseover', onOver);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('click', onClick, true);
    };
  }, []);

  // Menu / lobby music (the match picks its own in GameWorld).
  useEffect(() => {
    if (screen === 'menu') {
      audio.playMusic('music.menu');
      audio.playAmbient(null);
    } else if (screen === 'lobby') {
      audio.playMusic('music.lobby');
      audio.playAmbient(null);
      audio.say('vo.welcome', 'low');
    }
  }, [screen]);

  const featured = useFeatured();
  const poster = useUiImage('keyart_menu.webp');
  const lobbyArt = useUiImage('keyart_lobby.webp');

  if (!mounted) return <LoadingScreen />;
  if (screen === 'game') return <GameView />;
  return (
    <>
      {/* Key art holds the stage until the live 3D scene has loaded, then it fades in on top. */}
      {poster && <div className="scene-poster" style={{ backgroundImage: `url(${poster})` }} aria-hidden />}
      {/* The lobby covers the scene with its own art, so stop rendering it there. */}
      <MenuScene team={featured.team} character={featured.character} mapId={featured.mapId} active={screen === 'menu' || !lobbyArt} />
      <div className="scene-vignette" />
      {screen === 'lobby' ? <Lobby /> : <MainMenu />}
    </>
  );
}
