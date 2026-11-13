'use client';
import { useEffect } from 'react';

export function KeyboardViewport() {
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => {
      const viewport = window.visualViewport;
      const height = viewport?.height ?? innerHeight;
      const top = viewport?.offsetTop ?? 0;
      const bottom = Math.max(0, innerHeight - height - top);
      const typing = document.activeElement?.matches('input,textarea,[contenteditable=true]');
      root.style.setProperty('--visible-height', `${height}px`);
      root.style.setProperty('--visible-top', `${top}px`);
      root.style.setProperty('--keyboard-bottom', `${bottom}px`);
      root.toggleAttribute('data-keyboard', !!typing && (bottom > 100 || height < screen.height * .7));
    };
    sync();
    window.visualViewport?.addEventListener('resize', sync);
    window.visualViewport?.addEventListener('scroll', sync);
    window.addEventListener('resize', sync);
    document.addEventListener('focusin', sync);
    document.addEventListener('focusout', sync);
    return () => {
      window.visualViewport?.removeEventListener('resize', sync);
      window.visualViewport?.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
      document.removeEventListener('focusin', sync);
      document.removeEventListener('focusout', sync);
      root.style.removeProperty('--visible-height'); root.style.removeProperty('--visible-top'); root.style.removeProperty('--keyboard-bottom'); root.removeAttribute('data-keyboard');
    };
  }, []);
  return null;
}
