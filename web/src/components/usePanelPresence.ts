'use client';
import { prefersQuietTransitions } from '@/lib/interface-motion';

import { useEffect, useState } from 'react';

/** Keep a closing panel painted while its controls are already inert. */
export function usePanelPresence(open: boolean) {
  const [retained, setRetained] = useState(open);
  useEffect(() => {
    if (open) { setRetained(true); return; }
    const delay = prefersQuietTransitions() ? 100 : 300;
    const timer = window.setTimeout(() => setRetained(false), delay);
    return () => window.clearTimeout(timer);
  }, [open]);
  return open || retained;
}
