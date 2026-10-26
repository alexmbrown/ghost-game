'use client';

import { useState } from 'react';

import { audio } from '@/game/audio/audio';
import { useAppStore, type UserSettings } from '@/game/state/store';
import { Icon, type IconName } from '@/game/ui/icons';

type Tab = 'audio' | 'controls' | 'graphics';

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'audio', label: 'Audio', icon: 'sound' },
  { id: 'controls', label: 'Controls', icon: 'mouse' },
  { id: 'graphics', label: 'Graphics', icon: 'gear' },
];

const VOLUMES: { key: keyof Pick<UserSettings, 'master' | 'music' | 'sfx' | 'ambient' | 'voice'>; label: string }[] = [
  { key: 'master', label: 'Master' },
  { key: 'music', label: 'Music' },
  { key: 'sfx', label: 'Effects' },
  { key: 'ambient', label: 'Ambience' },
  { key: 'voice', label: 'Announcer' },
];

/** Mute switch + a slider per audio bus (Settings' Audio tab and the quick sound menu). */
export function VolumeControls() {
  const settings = useAppStore((s) => s.settings);
  const update = useAppStore((s) => s.updateSettings);
  return (
    <>
      <Toggle label="Mute all" on={settings.muted} onChange={(on) => update({ muted: on })} />
      {VOLUMES.map((v) => (
        <Slider
          key={v.key}
          label={v.label}
          value={settings[v.key]}
          min={0}
          max={1}
          step={0.05}
          display={`${Math.round(settings[v.key] * 100)}`}
          onChange={(n) => update({ [v.key]: n, muted: false })}
          onCommit={() => audio.play(v.key === 'voice' || v.key === 'music' || v.key === 'ambient' ? 'ui.click' : 'sfx.flame.pickup')}
        />
      ))}
    </>
  );
}

export function SettingsPanel() {
  const settings = useAppStore((s) => s.settings);
  const update = useAppStore((s) => s.updateSettings);
  const [tab, setTab] = useState<Tab>('audio');
  const close = () => {
    audio.play('ui.back');
    useAppStore.getState().setShowSettings(false);
  };

  return (
    <div className="overlay overlay--settings" onClick={close}>
      <div className="gpanel gpanel--settings" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
        <div className="ribbon">
          <span>Settings</span>
        </div>
        <button className="gbtn gbtn--icon gbtn--danger gbtn--sm panel-close" onClick={close} aria-label="Close settings">
          <Icon name="close" size={18} />
        </button>
        <div className="gpanel-body">
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'is-on' : ''} onClick={() => setTab(t.id)}>
                <Icon name={t.icon} size={20} /> {t.label}
              </button>
            ))}
          </div>

          {tab === 'audio' && <VolumeControls />}

          {tab === 'controls' && (
            <>
              <Slider
                label="Mouse sensitivity"
                value={settings.sensitivity}
                min={0.3}
                max={2.5}
                step={0.05}
                display={settings.sensitivity.toFixed(2)}
                onChange={(n) => update({ sensitivity: n })}
              />
              <Toggle label="Invert mouse Y" on={settings.invertY} onChange={(on) => update({ invertY: on })} />
              <div className="keymap">
                <span>
                  <kbd>W</kbd>
                  <kbd>A</kbd>
                  <kbd>S</kbd>
                  <kbd>D</kbd> Move
                </span>
                <span>
                  <kbd>Space</kbd> / <kbd>Click</kbd> Ability
                </span>
                <span>
                  <kbd>Tab</kbd> Scoreboard
                </span>
                <span>
                  <kbd>Esc</kbd> Pause / free mouse
                </span>
              </div>
            </>
          )}

          {tab === 'graphics' && (
            <div className="quality-pick">
              {(['high', 'low'] as const).map((q) => (
                <button
                  key={q}
                  className={`quality-card${settings.quality === q ? ' is-on' : ''}`}
                  onClick={() => update({ quality: q })}
                >
                  <b>{q === 'high' ? 'High' : 'Fast'}</b>
                  <small>{q === 'high' ? 'Shadows, bloom glow, sharp on high-DPI screens' : 'No shadows or bloom — for laptops & older GPUs'}</small>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (n: number) => void;
  onCommit?: () => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="gslider">
      <span className="gslider-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ['--pct' as string]: `${pct}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
      />
      <b className="gslider-value outlined">{display}</b>
    </label>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="gtoggle">
      <span>{label}</span>
      <button className={`gtoggle-switch${on ? ' is-on' : ''}`} role="switch" aria-checked={on} onClick={() => onChange(!on)}>
        <i />
      </button>
    </div>
  );
}
