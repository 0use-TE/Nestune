'use client';

import { useLayoutEffect, useSyncExternalStore } from 'react';

type MotionPreference = 'system' | 'full';
const key = 'nt-interface-motion';
const query = '(prefers-reduced-motion: reduce)';
let sessionPreference: MotionPreference | undefined;

function preference(): MotionPreference {
  try { return sessionPreference ?? (localStorage.getItem(key) === 'full' ? 'full' : 'system'); }
  catch { return sessionPreference ?? 'system'; }
}

export function prefersQuietTransitions() {
  return preference() === 'system' && window.matchMedia(query).matches;
}

function subscribe(notify: () => void) {
  const media = window.matchMedia(query);
  const storage = (e: StorageEvent) => {
    if (e.key === key || e.key === null) { sessionPreference = undefined; notify(); }
  };
  window.addEventListener(key, notify);
  window.addEventListener('storage', storage);
  media.addEventListener('change', notify);
  return () => {
    window.removeEventListener(key, notify);
    window.removeEventListener('storage', storage);
    media.removeEventListener('change', notify);
  };
}

export function setMotionPreference(value: MotionPreference) {
  sessionPreference = value;
  try { localStorage.setItem(key, value); } catch { /* Keep this window's choice. */ }
  window.dispatchEvent(new Event(key));
}

export function useMotionPreference() {
  return useSyncExternalStore(subscribe, preference, () => 'system' as const);
}

export function useQuietTransitions() {
  return useSyncExternalStore(subscribe, prefersQuietTransitions, () => true);
}

// CSS media queries already handle the system default, including before hydration.
export function useApplyMotionPreference() {
  const selected = useMotionPreference();
  useLayoutEffect(() => {
    document.documentElement.toggleAttribute('data-full-motion', selected === 'full');
  }, [selected]);
}
