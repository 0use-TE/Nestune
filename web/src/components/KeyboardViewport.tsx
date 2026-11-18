'use client';
import { useEffect } from 'react';

export function KeyboardViewport() {
  useEffect(() => {
    const root = document.documentElement;
    let layoutWidth = innerWidth;
    let fullHeight = innerHeight;
    let frame = 0;
    let keyboardVisible = false;
    let chatInput = false;
    const sync = () => {
      const viewport = window.visualViewport;
      const height = viewport?.height ?? innerHeight;
      const top = viewport?.offsetTop ?? 0;
      if (innerWidth !== layoutWidth) {
        layoutWidth = innerWidth;
        fullHeight = innerHeight;
      }
      const focused = document.activeElement;
      const typing = !!focused?.matches('input:not([type=range]),textarea,[contenteditable=true]');
      const unzoomed = Math.abs((viewport?.scale ?? 1) - 1) < .03;
      if (!typing && unzoomed) fullHeight = Math.max(fullHeight, innerHeight, height);
      if (typing) chatInput = !!focused?.closest('.chat-composer');
      // Keep the composer stable between a button press and the keyboard's closing animation.
      keyboardVisible = (typing || keyboardVisible) && unzoomed && Math.max(fullHeight, innerHeight) - height > 110;
      const bottom = Math.max(0, innerHeight - height - top);
      root.style.setProperty('--visible-height', `${unzoomed ? height : innerHeight}px`);
      root.style.setProperty('--visible-top', `${unzoomed ? top : 0}px`);
      root.style.setProperty('--keyboard-bottom', `${unzoomed ? bottom : 0}px`);
      root.toggleAttribute('data-keyboard', keyboardVisible);
      root.toggleAttribute('data-chat-keyboard', keyboardVisible && chatInput);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(sync); };
    sync();
    window.visualViewport?.addEventListener('resize', sync);
    window.visualViewport?.addEventListener('scroll', sync);
    window.addEventListener('resize', sync);
    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', schedule);
    return () => {
      window.visualViewport?.removeEventListener('resize', sync);
      window.visualViewport?.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
      document.removeEventListener('focusin', schedule);
      document.removeEventListener('focusout', schedule);
      cancelAnimationFrame(frame);
      root.removeAttribute('data-chat-keyboard');
      root.style.removeProperty('--visible-height'); root.style.removeProperty('--visible-top'); root.style.removeProperty('--keyboard-bottom'); root.removeAttribute('data-keyboard');
    };
  }, []);
  return null;
}
