type AudioSession = EventTarget & { type: string; readonly state: 'inactive' | 'active' | 'interrupted' };
type IosNavigator = Navigator & { standalone?: boolean; audioSession?: AudioSession };
type Progress = { queue: string; index: number; position: number };

export function isIosHomeScreen() {
  if (typeof window === 'undefined') return false;
  const nav = navigator as IosNavigator;
  const ios = /iPhone|iPad|iPod/i.test(nav.userAgent) || nav.platform === 'MacIntel' && nav.maxTouchPoints > 1;
  return ios && (nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches);
}

export function iosAudioSession() {
  return (navigator as IosNavigator).audioSession;
}

export function updateIosMediaState(audio: HTMLAudioElement, playing: boolean, duration = audio.duration) {
  const media = navigator.mediaSession;
  if (!media) return;
  try { media.playbackState = playing ? 'playing' : 'paused'; } catch { /* Optional on older WebKit. */ }
  try {
    if (Number.isFinite(duration) && duration > 0 && audio.readyState >= 1) {
      media.setPositionState({ duration, position: Math.max(0, Math.min(duration, audio.currentTime || 0)), playbackRate: audio.playbackRate || 1 });
    } else {
      media.setPositionState();
    }
  } catch { /* The session may not yet have an active audio route. */ }
}

const key = (user: number) => 'nt-ios-progress:' + user;

export function saveIosProgress(user: number, ids: readonly string[], index: number, position: number) {
  if (!ids[index] || !Number.isFinite(position) || position < 0) return;
  try { localStorage.setItem(key(user), JSON.stringify({ queue: ids.join(','), index, position } satisfies Progress)); }
  catch { /* Browsing without local storage still supports in-memory recovery. */ }
}

export function readIosProgress(user: number, ids: readonly string[]) {
  try {
    const value: Partial<Progress> | null = JSON.parse(localStorage.getItem(key(user)) || 'null');
    if (!value || value.queue !== ids.join(',') || typeof value.index !== 'number' || !Number.isInteger(value.index) || !ids[value.index] ||
        typeof value.position !== 'number' || !Number.isFinite(value.position) || value.position < 0 || value.position > 86_400) return null;
    return { index: value.index, position: value.position };
  } catch { return null; }
}
