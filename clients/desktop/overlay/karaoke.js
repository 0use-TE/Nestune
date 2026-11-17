// Bundled local renderer: no network or HTML from lyric text.
window.NestuneKaraoke = {
  create(element) {
    let current = null, pieces = [], flow = { phase: 0, direction: 1, speed: 14 };
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      element.style.setProperty('--lyric-width', `${Math.max(1, bounds.width) * 2}px`);
      pieces.forEach(piece => piece.node.style.setProperty('--word-x', `${piece.node.getBoundingClientRect().left - bounds.left}px`));
    };
    new ResizeObserver(measure).observe(element);
    return {
      clear(text) { current = null; pieces = []; if (element.textContent !== text) element.textContent = text; element.setAttribute('aria-label', text); },
      render(line, nextTime, duration, seed, position) {
        if (line !== current) {
          current = line;
          let words = line.words;
          if (!words?.length || words.map(word => word.text).join('') !== line.text) {
            const characters = [...new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(line.text)].map(item => item.segment);
            const end = line.d ? line.t + line.d : nextTime > line.t ? nextTime : duration > line.t ? duration : line.t + 5;
            const length = Math.min(10, Math.max(.2, end - line.t));
            words = characters.map((text, index) => ({ text, t: line.t + length * index / characters.length, d: length / characters.length }));
          }
          let hash = (2166136261 ^ seed) >>> 0; const key = `${line.t.toFixed(3)}:${line.text}`;
          for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619) >>> 0;
          flow = { phase: (hash & 65535) / 65536, direction: hash & 65536 ? 1 : -1, speed: 14 + ((hash >>> 17) % 9) };
          pieces = words.map(word => {
            const node = document.createElement('span'), base = document.createElement('span'), ink = document.createElement('span');
            node.className = 'k-word'; ink.className = 'k-ink'; ink.setAttribute('aria-hidden', 'true');
            base.textContent = ink.textContent = word.text; node.append(base, ink); return { word, node, progress: -1 };
          });
          element.replaceChildren(...pieces.map(piece => piece.node)); element.setAttribute('aria-label', line.text); measure();
        }
        for (const piece of pieces) {
          const value = Math.round(Math.max(0, Math.min(1, position < piece.word.t ? 0 : piece.word.d > 0 ? (position - piece.word.t) / piece.word.d : 1)) * 10000) / 100;
          if (piece.progress !== value) { piece.node.style.setProperty('--sung', `${value}%`); piece.progress = value; }
        }
        const drift = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : -position * flow.speed * flow.direction;
        element.style.setProperty('--lyric-flow', `calc(var(--lyric-width,600px) * ${flow.phase} + ${drift}px)`);
      }
    };
  }
};
