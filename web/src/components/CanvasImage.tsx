'use client';

import { useCallback, useEffect, useState } from 'react';
import { Icon } from './Icon';

export function CanvasImage({ src, alt, width, height }: { src: string; alt: string; width?: number; height?: number }) {
  const [request, setRequest] = useState({ attempts: 0, retryAt: 0 });
  const [failed, setFailed] = useState(false);
  const imageSrc = request.attempts ? `${src}${src.includes('?') ? '&' : '?'}retry=${request.retryAt}` : src;

  const retry = useCallback(() => {
    setFailed(false);
    setRequest(previous => ({ attempts: previous.attempts + 1, retryAt: Date.now() }));
  }, []);

  useEffect(() => {
    if (!failed || request.attempts >= 2) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function schedule() {
      clearTimeout(timer);
      if (!document.hidden && navigator.onLine) {
        timer = setTimeout(retry, 1000 * 3 ** request.attempts + Math.random() * 600);
      }
    }
    schedule();
    window.addEventListener('online', schedule);
    document.addEventListener('visibilitychange', schedule);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('online', schedule);
      document.removeEventListener('visibilitychange', schedule);
    };
  }, [failed, request.attempts, retry]);

  return <div className="nc-canvas-image" data-failed={failed ? '' : undefined}
    style={width && height ? { aspectRatio: `${width} / ${height}` } : undefined}>
    <img key={imageSrc} src={imageSrc} alt={alt} width={width} height={height}
      loading={request.attempts ? 'eager' : 'lazy'} decoding="async" draggable={false} onError={() => setFailed(true)} />
    {failed && <button type="button" className="nc-canvas-image-retry" aria-label={`重试加载${alt}`}
      onPointerDown={event => event.stopPropagation()} onClick={retry}>
      <Icon n="refresh" s={14} />重试
    </button>}
  </div>;
}
