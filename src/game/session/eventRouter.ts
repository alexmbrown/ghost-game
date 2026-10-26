// Turns simulation events into feedback: sound, voice, particles, the kill
// feed, popups and big announcements. Runs on every client (host included).

import { audio } from '../audio/audio';
import type { SoundId } from '../audio/sounds';
import { abilityFor, voiceOf } from '../core/characters';
import { FACTIONS, FLAME_COLOR, MEGA_FLAME_COLOR } from '../core/factions';
import type { GameEvent, PowerId } from '../core/types';
import { emitAnim, emitVfx } from '../fx/bus';
import { useAppStore } from '../state/store';
import type { IconName } from '../ui/icons';
import type { ViewPlayer, ViewState } from './types';

const POWER_TEXT: Record<PowerId, [string, string]> = {
  speed: ['SPEED UNLOCKED', 'You move faster for the rest of the round'],
  magnet: ['MAGNET UNLOCKED', 'Spirits jump to you from further away'],
  phase: ['PHASE UNLOCKED', 'You can drift through crypts and walls'],
};

const bark = (vp: ViewPlayer | undefined, line: 'steal' | 'stolen' | 'bank' | 'ability') => {
  // Alternate characters borrow their faction hero's recorded lines.
  if (vp) audio.say(`vo.${voiceOf(vp.character)}.${line}` as SoundId, 'low');
};

export function routeEvents(events: GameEvent[], view: ViewState): void {
  if (!events.length) return;
  const store = useAppStore.getState();
  const byId = new Map(view.players.map((p) => [p.id, p]));
  const local = byId.get(view.localId);
  const isLocal = (id: string | null) => id === view.localId;
  const name = (id: string) => byId.get(id)?.name ?? 'Someone';
  const teamOf = (id: string) => byId.get(id)?.team ?? 0;
  const color = (id: string) => FACTIONS[teamOf(id)].color;

  for (const ev of events) {
    switch (ev.type) {
      case 'pickup': {
        audio.play(ev.mega ? 'sfx.flame.pickupMega' : 'sfx.flame.pickup', { x: ev.x, z: ev.z, volume: isLocal(ev.player) ? 1 : 0.6 });
        emitVfx({ kind: 'burst', x: ev.x, z: ev.z, color: ev.mega ? MEGA_FLAME_COLOR : FLAME_COLOR, count: ev.mega ? 40 : 8, speed: ev.mega ? 6 : 3 });
        if (ev.mega && isLocal(ev.player)) store.pushPopup('+10 MEGA-SPIRIT!', 'good');
        else if (ev.mega) store.pushFeed({ icon: 'mega', who: name(ev.player), what: 'caught the Mega-Spirit', a: teamOf(ev.player) });
        break;
      }
      case 'bank': {
        const big = ev.amount >= 10;
        audio.play(big ? 'sfx.flame.bankBig' : 'sfx.flame.bankSmall', { x: ev.x, z: ev.z });
        emitVfx({ kind: 'ring', x: ev.x, z: ev.z, color: FACTIONS[ev.team].color, radius: big ? 7 : 4.5 });
        emitVfx({ kind: 'beam', x: view.bases[ev.team].pos.x, z: view.bases[ev.team].pos.z, color: FACTIONS[ev.team].color, height: big ? 16 : 9 });
        emitVfx({ kind: 'burst', x: ev.x, z: ev.z, color: FACTIONS[ev.team].color, count: Math.min(60, 10 + ev.amount * 2), speed: 5, y: 1 });
        if (isLocal(ev.player)) {
          store.pushPopup(`+${ev.amount} BANKED!`, 'good');
          if (ev.amount >= 15) audio.say('vo.bigBank', 'low');
          else bark(local, 'bank');
        } else if (ev.amount >= 10) {
          store.pushFeed({ icon: 'bank', who: name(ev.player), what: `banked ${ev.amount}`, a: ev.team });
        }
        break;
      }
      case 'steal': {
        emitAnim(ev.victim, 'hit');
        const victim = byId.get(ev.victim);
        if (victim) {
          emitVfx({ kind: 'stream', fromX: victim.x, fromZ: victim.z, toX: ev.x, toZ: ev.z, color: color(ev.attacker), count: Math.min(30, 4 + ev.amount * 2) });
        }
        if (isLocal(ev.attacker)) {
          audio.play('sfx.steal.thief');
          store.pushPopup(`STOLE ${ev.amount}!`, 'good');
          bark(local, 'steal');
        } else if (isLocal(ev.victim)) {
          audio.play('sfx.steal.victim');
          store.pushPopup(`${name(ev.attacker)} stole ${ev.amount}!`, 'bad');
          bark(local, 'stolen');
        } else {
          audio.play('sfx.steal.thief', { x: ev.x, z: ev.z, volume: 0.6 });
        }
        store.pushFeed({ icon: 'steal', who: name(ev.attacker), what: `stole ${ev.amount} from`, whom: name(ev.victim), a: teamOf(ev.attacker), b: teamOf(ev.victim) });
        break;
      }
      case 'buddy': {
        audio.play('sfx.buddy', { x: ev.x, z: ev.z });
        emitVfx({ kind: 'burst', x: ev.x, z: ev.z, color: color(ev.a), count: 16, speed: 4, y: 1.2 });
        if (isLocal(ev.a) || isLocal(ev.b)) store.pushPopup('+3 BUDDY BONUS', 'good');
        break;
      }
      case 'stun': {
        audio.play('sfx.stun', { x: ev.x, z: ev.z });
        emitVfx({ kind: 'burst', x: ev.x, z: ev.z, color: '#ff9a3c', count: 30, speed: 6, y: 1, look: 'smoke' });
        if (isLocal(ev.victim)) store.pushPopup('STUNNED! Spirits scattered', 'bad');
        else if (isLocal(ev.attacker)) store.pushPopup(`Stunned ${name(ev.victim)}!`, 'good');
        store.pushFeed({ icon: 'stun', who: name(ev.attacker), what: 'stunned', whom: name(ev.victim), a: teamOf(ev.attacker), b: teamOf(ev.victim) });
        break;
      }
      case 'knock': {
        emitAnim(ev.victim, 'hit');
        audio.play('sfx.knock', { x: ev.x, z: ev.z });
        emitVfx({ kind: 'burst', x: ev.x, z: ev.z, color: color(ev.victim), count: 20, speed: 5, y: 1, look: 'smoke' });
        const icon = abilityFor(byId.get(ev.attacker)?.character ?? '').icon as IconName;
        if (isLocal(ev.victim)) store.pushPopup(`Knocked loose! (-${ev.dropped})`, 'bad');
        else if (isLocal(ev.attacker)) store.pushPopup(`Knocked ${ev.dropped} loose!`, 'good');
        if (ev.dropped > 0) {
          store.pushFeed({ icon, who: name(ev.attacker), what: `knocked ${ev.dropped} loose from`, whom: name(ev.victim), a: teamOf(ev.attacker), b: teamOf(ev.victim) });
        }
        break;
      }
      case 'respawn': {
        const p = byId.get(ev.player);
        if (p) {
          audio.play('sfx.respawn', { x: p.x, z: p.z, volume: isLocal(ev.player) ? 1 : 0.5 });
          emitVfx({ kind: 'ring', x: p.x, z: p.z, color: FACTIONS[p.team].accent, radius: 3 });
        }
        break;
      }
      case 'power': {
        if (isLocal(ev.player)) {
          const [text, sub] = POWER_TEXT[ev.power];
          store.announce(text, 'info', sub);
          audio.play('sfx.power');
          audio.say(`vo.power.${ev.power}` as SoundId);
        }
        break;
      }
      case 'ability': {
        emitAnim(ev.player, 'cast');
        const p = byId.get(ev.player);
        audio.play(`sfx.ability.${ev.ability}` as SoundId, { x: ev.x, z: ev.z, volume: isLocal(ev.player) ? 1 : 0.8 });
        // Hellfire bursts into flame, Grave Grasp kicks up grave dust.
        if (p) emitVfx({ kind: 'burst', x: ev.x, z: ev.z, color: FACTIONS[p.team].color, count: 14, speed: 4, y: 0.8, look: p.team === 3 ? 'flame' : p.team === 1 ? 'smoke' : undefined });
        if (isLocal(ev.player)) bark(local, 'ability');
        break;
      }
      case 'pumpkin': {
        audio.play('sfx.pumpkin.get', { x: ev.x, z: ev.z });
        emitVfx({ kind: 'burst', x: ev.x, z: ev.z, color: '#ff8c1a', count: 40, speed: 7, y: 1, look: 'flame' });
        if (isLocal(ev.player)) store.announce('MAGIC PUMPKIN!', 'go', 'Untouchable — ram rivals to stun them');
        else store.pushFeed({ icon: 'pumpkin', who: name(ev.player), what: 'grabbed the Magic Pumpkin!', a: teamOf(ev.player) });
        break;
      }
      case 'pumpkinSpawn': {
        audio.play('sfx.pumpkin.spawn');
        audio.say('vo.pumpkinSpawn', 'low');
        store.announce('The Magic Pumpkin is ripe!', 'info', 'Grab it at the center');
        break;
      }
      case 'megaSpawn': {
        audio.play('sfx.mega.spawn');
        audio.say('vo.megaSpawn', 'low');
        emitVfx({ kind: 'ring', x: ev.x, z: ev.z, color: MEGA_FLAME_COLOR, radius: 5 });
        store.announce('A Mega-Spirit appeared!', 'info', 'Corner it — it’s worth 10');
        break;
      }
      case 'phase': {
        if (ev.phase === 'playing') {
          store.announce('GO!', 'go');
          audio.play('sfx.countdown.go');
          audio.say('vo.go');
        } else if (ev.phase === 'ended') {
          audio.play('sfx.round.end');
          const myTeam = local?.team;
          if (view.winner === null) {
            audio.playMusic('music.draw', 0.4);
            audio.say('vo.draw');
          } else {
            audio.playMusic(view.winner === myTeam ? 'music.victory' : 'music.defeat', 0.4);
            audio.say(`vo.win.${view.winner}` as SoundId);
          }
          audio.playAmbient(null);
        }
        break;
      }
      case 'hurry': {
        store.announce('20 SECONDS LEFT!', 'warn');
        audio.play('sfx.hurry');
        audio.say('vo.hurry');
        audio.playMusic('music.hurry', 1.5);
        break;
      }
      case 'left': {
        store.pushFeed({ icon: 'leave', who: name(ev.player), what: 'left the match', a: teamOf(ev.player) });
        audio.play('ui.leave');
        break;
      }
    }
  }
}
