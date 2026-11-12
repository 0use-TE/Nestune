'use client';
import { useEffect, useState } from 'react';
import { get } from './api';

export function recentSearches(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem('nt-recent') || '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch { return []; }
}

export function saveRecentSearches(keywords: string[]) {
  try {
    if (keywords.length) localStorage.setItem('nt-recent', JSON.stringify(keywords));
    else localStorage.removeItem('nt-recent');
  } catch { /* Storage can be unavailable. */ }
}

export function useSearchSuggestions(query: string, enabled: boolean) {
  const keywords = query.trim();
  const [result, setResult] = useState<{ query: string; keywords: string[] } | null>(null);

  useEffect(() => {
    if (!enabled || !keywords) return;
    let live = true;
    const timer = setTimeout(() => {
      get<{ keywords: string[] }>(`/api/search/suggest?keywords=${encodeURIComponent(keywords)}`).then(response => {
        if (live) setResult({ query: keywords, keywords: response.keywords });
      }).catch(() => {});
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [enabled, keywords]);

  return enabled && result?.query === keywords ? result.keywords : [];
}
