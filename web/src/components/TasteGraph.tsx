'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type CSSProperties, type ReactNode } from 'react';
import type { TasteCenter, TasteMap, TasteSelection, TasteTrack } from '@/lib/taste-map';
import { zoomAt, CANVAS_DRAG_THRESHOLD, type Camera } from '@/lib/canvas-camera';
import { useQuietTransitions } from '@/lib/interface-motion';
import { MusicArtwork } from './MusicArtwork';
import { Icon } from './Icon';
import styles from './taste-graph.module.css';

type Point = { x: number; y: number };
type Bounds = { width: number; height: number };
type Hub = TasteCenter & Point & { color: string };
type PlacedTrack = Point & { track: TasteTrack; primary: Hub; hubs: Hub[]; label: string; sparse: boolean };
type Box = Point & Bounds;
const ARTIST = '#82a7ff';
const TAG = '#edc975';
const TAU = Math.PI * 2;
const INITIAL_SIZE = { width: 880, height: 550 };
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const pixel = (value: number) => Math.round(value * 10) / 10;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const around = ({ x, y }: Point, radius: number): Box => ({ x: x - radius, y: y - radius, width: radius * 2, height: radius * 2 });
const shorten = (value: string, limit: number) => Array.from(value).length > limit ? Array.from(value).slice(0, limit - 1).join('') + '…' : value;
const labelWidth = (value: string, size: number) => Array.from(value).reduce((width, char) => width + (/^[\u0020-\u007e]$/.test(char) ? 0.64 : 1) * size, 0);

function hash(text: string) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}

function makeLayout(map: TasteMap, { width, height }: Bounds, homeZoom: number) {
  const compact = width * homeZoom < 540;
  const textScale = compact ? Math.min(1.6, 1 / homeZoom) : 1;
  const origin = { x: width / 2, y: height * 0.49 };
  const discRadius = compact ? 43 : 45;
  const n = map.centers.length;
  const angles: Record<number, number[]> = { 1: [-27], 2: [-147, 33], 3: [-151, -25, 87], 4: [-145, -37, 38, 143], 5: [-148, -57, 13, 94, 151] };
  const hubs: Hub[] = map.centers.map((center, i) => {
    const angle = angles[n] ? angles[n][i] * Math.PI / 180 : i * TAU / n - 2.58;
    return { ...center, x: pixel(origin.x + Math.cos(angle) * width * (compact ? 0.31 : 0.315)),
      y: pixel(origin.y + Math.sin(angle) * height * (compact ? 0.345 : 0.303)), color: center.kind === 'artist' ? ARTIST : TAG };
  });
  const byId = new Map(hubs.map(hub => [hub.id, hub]));
  const occupied: Box[] = [around(origin, discRadius + 15),
    { x: origin.x - 44, y: origin.y + discRadius + 9, width: 88, height: 25 },
  ];
  for (const hub of hubs) {
    occupied.push(around(hub, 17));
    const w = labelWidth(hub.label, compact ? 12 * textScale : 14) + 14;
    occupied.push({ x: hub.x - w / 2, y: hub.y + 14, width: w, height: 20 * textScale });
  }

  // Keep every recording in one place. Additional memberships become extra edges.
  const tracks: PlacedTrack[] = [];
  const labels: Box[] = [...occupied];
  const seen = new Set<string>();
  const countByHub = new Map<string, number>();
  for (const track of map.tracks) {
    if (seen.has(track.song.id)) continue;
    const linked = [...new Set(track.centerIds)].map(id => byId.get(id)).filter((hub): hub is Hub => !!hub);
    if (!linked.length) continue;
    seen.add(track.song.id);
    const primary = linked.reduce((best, hub) => (countByHub.get(hub.id) ?? 0) < (countByHub.get(best.id) ?? 0) ? hub : best);
    const index = countByHub.get(primary.id) ?? 0;
    countByHub.set(primary.id, index + 1);
    const seed = hash(track.song.id);
    const label = shorten(track.song.name, compact ? 8 : 14);
    const labelBox = { width: labelWidth(label, 12 * textScale) + 14, height: 24 * textScale };
    const clearance = 12;
    const other = linked.find(hub => hub !== primary);
    const direction = other
      ? Math.atan2(other.y - primary.y, other.x - primary.x)
      : Math.atan2(primary.y - origin.y, primary.x - origin.x) + (index - 1) * 1.95;
    const spread = compact ? clamp(width * 0.125, 38, 61) : clamp(Math.min(width, height * 1.45) * 0.12, 57, 123);
    let best = { x: primary.x, y: primary.y }, bestCost = Infinity;
    for (let step = 0; step < 108; step++) {
      const angle = direction + step * 2.39996 + (seed % 24 - 12) * .017;
      const radius = spread * (.65 + (seed % 27) / 100 + Math.sqrt(step) * .18);
      const raw = { x: primary.x + Math.cos(angle) * radius, y: primary.y + Math.sin(angle) * radius };
      const point = { x: pixel(clamp(raw.x, labelBox.width / 2 + 5, width - labelBox.width / 2 - 5)), y: pixel(clamp(raw.y, clearance + 8, height - clearance - 8)) };
      const box = { x: point.x - labelBox.width / 2, y: point.y - labelBox.height / 2, ...labelBox };
      const collisions = occupied.filter(obstacle => overlaps(box, obstacle)).length;
      const hubAvoidance = Math.max(0, 28 - distance(primary, point)) * 5;
      const cost = collisions * 900 + distance(raw, point) + hubAvoidance + step * 0.45;
      if (cost < bestCost) { bestCost = cost; best = point; }
    }
    const box = { x: best.x - labelBox.width / 2, y: best.y - labelBox.height / 2, ...labelBox };
    occupied.push(box);
    const sparse = !labels.some(other => overlaps(box, other));
    if (sparse) labels.push({ x: box.x - 14, y: box.y - 8, width: box.width + 28, height: box.height + 16 });
    tracks.push({ ...best, track, primary, hubs: linked, label, sparse });
  }
  return { origin, discRadius, hubs, tracks, compact };
}

const HOME: Camera = { x: 0, y: 0, zoom: 1 };
const LIMITS = { min: .32, max: 3 };
const midpoint = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export default function TasteGraph({ map, mix, albums, selection, onSelect, onClose, renderDetail }: {
  map: TasteMap; mix: TasteTrack[]; albums?: Map<string, TasteTrack[]>;
  selection: TasteSelection | null; onSelect: (selection: TasteSelection) => void; onClose: () => void; renderDetail: (item: TasteSelection, pinned: boolean) => ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const camera = useRef(HOME);
  const contacts = useRef(new Map<number, Point>());
  const start = useRef<Point | null>(null);
  const paint = useRef<(updateLayout?: boolean) => void>(() => {});
  const pointedNode = useRef<string | null>(null);
  const pointer = useRef<HTMLSpanElement>(null);
  const pointerLinks = useRef<SVGGElement>(null);
  const target = useRef<Point | null>(null);
  const pendingPointer = useRef<Point | null>(null);
  const layoutDirty = useRef(false);
  const field = useRef({ x: 0, y: 0, gain: 0 });

  const reducedMotion = useQuietTransitions();
  const quiet = useRef(reducedMotion);
  quiet.current = reducedMotion;
  const visible = useRef(false);
  const motionFrame = useRef<number | null>(null);
  const lastFrame = useRef(0);
  function clearCursor() {
    pendingPointer.current = null;
    target.current = null;
    pointedNode.current = null;
    field.current.gain = 0;
    paint.current();
  }
  function updateField() {
    if (motionFrame.current !== null || !visible.current) return;
    function tick(now: number) {
      motionFrame.current = null;
      if (!visible.current) return;
      const input = pendingPointer.current;
      if (input && world.current) {
        const rect = world.current.getBoundingClientRect();
        const scale = rect.width / sizes.current.width;
        if (scale) {
          const aim = { x: (input.x - rect.left) / scale, y: (input.y - rect.top) / scale };
          if (!target.current && !field.current.gain) field.current = { ...aim, gain: 0 };
          target.current = aim;
        }
        pendingPointer.current = null;
      }
      const aim = target.current, previous = field.current;
      const gain = aim ? 1 : 0;
      const dt = now - lastFrame.current;
      const settled = (!aim || distance(aim, previous) < .5) && Math.abs(gain - previous.gain) < .006;
      // Idle drift needs fewer updates than a moving pointer.
      if (input || layoutDirty.current || !settled || dt >= 40 || quiet.current) {
        const fraction = settled || quiet.current ? 1 : 1 - Math.exp(-clamp(dt, 1, 100) / 75);
        const next = aim ?? previous;
        field.current = { x: previous.x + (next.x - previous.x) * fraction,
          y: previous.y + (next.y - previous.y) * fraction, gain: previous.gain + (gain - previous.gain) * fraction };
        lastFrame.current = now;
        paint.current(layoutDirty.current);
        layoutDirty.current = false;
      }
      if (!quiet.current) motionFrame.current = requestAnimationFrame(tick);
    }
    motionFrame.current = requestAnimationFrame(tick);
  }
  useEffect(() => {
    const el = container.current!;
    let intersecting = false;
    const sync = () => {
      visible.current = intersecting && !document.hidden && !el.closest('[inert]');
      if (visible.current) updateField();
      else {
        if (motionFrame.current !== null) cancelAnimationFrame(motionFrame.current);
        motionFrame.current = null;
        clearCursor();
      }
    };
    // A closed drawer can already intersect the viewport along its zero-height edge.
    const observer = new IntersectionObserver(([entry]) => {
      intersecting = entry.intersectionRatio >= .01;
      sync();
    }, { threshold: .01 });
    observer.observe(el);
    const drawer = el.closest('[aria-hidden][id]');
    const attributes = new MutationObserver(sync);
    if (drawer) attributes.observe(drawer, { attributes: true, attributeFilter: ['inert'] });
    document.addEventListener('visibilitychange', sync);
    return () => {
      observer.disconnect(); attributes.disconnect(); document.removeEventListener('visibilitychange', sync);
      visible.current = false;
      if (motionFrame.current !== null) cancelAnimationFrame(motionFrame.current);
      motionFrame.current = null;
    };
  }, []);
  useLayoutEffect(() => { updateField(); }, [reducedMotion]);
  function leaveField() {
    pendingPointer.current = null;
    target.current = null;
    pointedNode.current = null;
    updateField();
    if (!quiet.current) paint.current();
  }
  function follow(clientX: number, clientY: number, node: string | null = null) {
    pendingPointer.current = { x: clientX, y: clientY };
    pointedNode.current = node;
    updateField();
  }
  const moved = useRef(false);
  const [bounds, setBounds] = useState(INITIAL_SIZE);
  const [hover, setHover] = useState<TasteSelection | null>(null);
  const [allLabels, setAllLabels] = useState(true);
  const homeZoom = Math.min(1, bounds.width / 640);
  const worldSize = useMemo(() => ({ width: bounds.width / homeZoom, height: bounds.height / homeZoom }), [bounds, homeZoom]);
  const layout = useMemo(() => makeLayout(map, worldSize, homeZoom), [map, worldSize, homeZoom]);
  const sizes = useRef({ ...worldSize, bounds });
  sizes.current = { ...worldSize, bounds };
  const placements = useRef(new Map<string, Point>());

  const nodeDrag = useRef<{ readyAt: number; id: string; point: Point; start: Point } | null>(null);
  const dwell = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHover = useRef<Point | null>(null);
  function cancelDwell() {
    if (dwell.current !== null) clearTimeout(dwell.current);
    dwell.current = null;
    lastHover.current = null;
    setHover(null);
  }
  useEffect(() => () => { if (dwell.current !== null) clearTimeout(dwell.current); }, []);
  function waitForStillPointer(e: PointerEvent<HTMLDivElement>) {
    if (selection || e.pointerType !== 'mouse' || contacts.current.size) return;
    const element = (e.target as Element).closest<HTMLElement>('[data-kind][data-node]');
    if (hover && element?.dataset.kind === hover.kind && element.dataset.node === ('id' in hover ? hover.id : 'mix')) return;
    const point = { x: e.clientX, y: e.clientY };
    if (lastHover.current && distance(point, lastHover.current) < 3) return;
    cancelDwell();
    lastHover.current = point;
    dwell.current = setTimeout(() => {
      const target = document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>('[data-kind][data-node]');
      if (!container.current?.contains(target ?? null) || !target) return;
      const kind = target.dataset.kind;
      if (kind === 'song' || kind === 'center' || kind === 'album') setHover({ kind, id: target.dataset.node! });
      else if (kind === 'mix') setHover({ kind });
    }, 480);
  }

  const { origin, discRadius, hubs, tracks, compact } = layout;
  const { width, height } = worldSize;
  const highlight = selection ?? hover;
  const focusId = highlight && ('id' in highlight ? highlight.id : 'mix');
  const anchorId = highlight?.kind === 'album' && !tracks.some(p => p.track.song.id === focusId)
    ? albums?.get(highlight.id)?.[0]?.song.id ?? focusId : focusId;
  const isWork = highlight?.kind === 'song' || highlight?.kind === 'album';
  // Cache the DOM bindings once per layout. Pointer frames never render the React tree.
  const trackFocus = isWork ? focusId : null;
  const centerFocus = highlight?.kind === 'center' ? highlight.id : null;
  const lookup = useRef({ anchorId, reducedMotion, trackFocus, centerFocus });
  lookup.current = { anchorId, reducedMotion, trackFocus, centerFocus };
  useLayoutEffect(() => {
    const layer = world.current!, frame = container.current!;
    const nodes = new Map(Array.from(layer.querySelectorAll<HTMLElement>('[data-node]'), el => [el.dataset.node!, el]));
    const entries = [
      { id: 'mix', point: origin, group: -1 },
      ...hubs.map((h, group) => ({ id: h.id, point: h, group })),
      ...tracks.map(p => ({ id: p.track.song.id, point: p, group: hubs.indexOf(p.primary) })),
    ].map(entry => ({ ...entry, el: nodes.get(entry.id), x: entry.point.x, y: entry.point.y, shiftX: 0, shiftY: 0, base: entry.point, correctionX: 0, correctionY: 0 }));
    const byId = new Map(entries.map(entry => [entry.id, entry]));
    const clusters = hubs.map((hub, i) => {
      const group = layer.querySelector<HTMLElement>(`[data-cluster="${i}"]`)!;
      const lines = layer.querySelector<SVGGElement>(`[data-cluster-lines="${i}"]`)!;
      return {
        group, hub, center: byId.get(hub.id)!, x: 0, y: 0,
        paths: Array.from(lines.querySelectorAll('path')),
        spokes: tracks.filter(t => t.hubs.includes(hub)).map(t => ({ end: byId.get(t.track.song.id)!, primary: t.primary === hub })),
        trunk: Array.from(lines.querySelectorAll('line')),
      };
    });
    const rays = Array.from(pointerLinks.current!.querySelectorAll('line'));
    // Reading SVGLength.baseVal after changing geometry can force a synchronous layout.
    const lineEnds = (line: SVGLineElement, x: number, y: number, endX: number, endY: number) => {
      line.setAttribute('x1', String(x)); line.setAttribute('y1', String(y));
      line.setAttribute('x2', String(endX)); line.setAttribute('y2', String(endY));
    };
    let lastPaint = performance.now();
    let raised: HTMLElement | null = null;
    paint.current = (updateLayout = false) => {
      const view = camera.current, motion = field.current, cursor = target.current;
      const nextRaised = pointedNode.current ? nodes.get(pointedNode.current) ?? null : null;
      if (nextRaised !== raised) {
        raised?.removeAttribute('data-pointed');
        nextRaised?.setAttribute('data-pointed', '');
        raised = nextRaised;
      }
      const now = performance.now(), time = now / 1000;
      const smooth = 1 - Math.exp(-clamp(now - lastPaint, 0, 100) / 80);
      lastPaint = now;
      const moving = visible.current && !lookup.current.reducedMotion;
      for (const [i, cluster] of clusters.entries()) {
        const dx = (motion.x - cluster.hub.x) * view.zoom, dy = (motion.y - cluster.hub.y) * view.zoom;
        const pull = motion.gain * .29 / (1 + (dx * dx + dy * dy) / 38000);
        const x = (Math.cos(time * .64 + i * 2.4) * 11 + dx * pull) / view.zoom;
        const y = (Math.sin(time * .81 + i * 2.4) * 8 + dy * pull) / view.zoom;
        cluster.x = moving ? cluster.x + (x - cluster.x) * smooth : 0;
        cluster.y = moving ? cluster.y + (y - cluster.y) * smooth : 0;
        cluster.group.style.transform = `translate(${pixel(cluster.x)}px,${pixel(cluster.y)}px)`;
        cluster.group.style.zIndex = raised?.parentElement === cluster.group ? '4' : '';
      }
      for (const entry of entries) {
        if (updateLayout) {
          const pos = placements.current.get(entry.id);
          const base = pos ? { x: pos.x * width, y: pos.y * height } : entry.point;
          if (entry.el && base !== entry.base) { entry.el.style.left = base.x + 'px'; entry.el.style.top = base.y + 'px'; }
          entry.base = base;
        }
        const cluster = clusters[entry.group];
        const gx = cluster ? pixel(cluster.x) : 0, gy = cluster ? pixel(cluster.y) : 0;
        const held = entry.id === pointedNode.current || entry.id === lookup.current.anchorId;
        let cx = 0, cy = 0;
        if (placements.current.has(entry.id)) { cx = -gx; cy = -gy; }
        else if (moving && held) { cx = pixel(entry.shiftX - gx); cy = pixel(entry.shiftY - gy); }
        else if (moving) {
          cx = entry.correctionX * (1 - smooth); cy = entry.correctionY * (1 - smooth);
          if (Math.abs(cx) < .1) cx = 0;
          if (Math.abs(cy) < .1) cy = 0;
        }
        if (entry.el && (updateLayout || cx !== entry.correctionX || cy !== entry.correctionY)) {
          entry.el.style.translate = cx || cy ? `${cx}px ${cy}px` : '';
        }
        entry.correctionX = cx; entry.correctionY = cy;
        entry.shiftX = gx + cx; entry.shiftY = gy + cy;
        entry.x = pixel(entry.base.x + entry.shiftX); entry.y = pixel(entry.base.y + entry.shiftY);
      }
      const mixNode = byId.get('mix')!;
      for (const cluster of clusters) {
        const { center } = cluster;
        for (const line of cluster.trunk) lineEnds(line, mixNode.x, mixNode.y, center.x, center.y);
        const segments = ['', '', ''];
        const start = `M${center.x} ${center.y}L`;
        for (const {end, primary} of cluster.spokes) {
          const lit = lookup.current.centerFocus === center.id || lookup.current.trackFocus === end.id;
          segments[lit ? 2 : primary ? 0 : 1] += start + end.x + ' ' + end.y;
        }
        cluster.paths.forEach((path, i) => {
          if (path.getAttribute('d') !== segments[i]) path.setAttribute('d', segments[i]);
        });
      }
      const local = cursor;
      const nearest = local ? entries.filter(e => e.id !== 'mix' && e.id !== pointedNode.current).sort((a,b) => distance(a,local) - distance(b,local)).slice(0,4) : [];
      rays.forEach((ray,i) => {
        const end = nearest[i];
        if (local && end) lineEnds(ray as SVGLineElement, local.x, local.y, end.x, end.y);
      });
      pointerLinks.current!.style.display = cursor ? '' : 'none';
      pointer.current!.hidden = !cursor;
      if (local) pointer.current!.style.transform = `translate(${local.x}px,${local.y}px) scale(${1/view.zoom})`;
      const anchor = lookup.current.anchorId && byId.get(lookup.current.anchorId);
      if (anchor) {
        const x = anchor.x * view.zoom + view.x, y = anchor.y * view.zoom + view.y;
        frame.style.setProperty('--anchor-x', pixel(x) + 'px');
        frame.style.setProperty('--anchor-y', pixel(y) + 'px');
        frame.dataset.flipX = String(x > bounds.width / 2);
        frame.dataset.flipY = String(y > bounds.height / 2);
      }
    };
    paint.current(true);
    return () => { raised?.removeAttribute('data-pointed'); paint.current = () => {}; };
  }, [layout, bounds, width, height, origin, hubs, tracks]);
  useLayoutEffect(() => { paint.current(); }, [anchorId, reducedMotion]);
  const focusedTrack = tracks.find(p => p.track.song.id === trackFocus);
  const isNear = (hub: Hub) => centerFocus ? hub.id === centerFocus : !focusedTrack || focusedTrack.hubs.includes(hub);

  useLayoutEffect(() => {
    const el = container.current!;
    const measure = () => {
      const width = el.clientWidth, height = el.clientHeight;
      if (width && height) setBounds(old => old.width === width && old.height === height ? old : { width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  function move(to: Camera, animate = false) {
    const el = container.current, layer = world.current;
    if (!el || !layer) return;
    const { width: w, height: h } = sizes.current.bounds;
    const x = clamp(to.x, w * .2 - sizes.current.width * to.zoom, w * .8);
    const y = clamp(to.y, h * .2 - sizes.current.height * to.zoom, h * .8);
    camera.current = { x, y, zoom: to.zoom };
    layer.dataset.fly = String(animate);
    layer.style.transform = `translate3d(${x}px,${y}px,0) scale(${to.zoom})`;
    setAllLabels(to.zoom >= .98);
    updateField();
  }
  function interruptFlight() {
    const layer = world.current;
    if (layer?.dataset.fly !== 'true') return;
    const matrix = new DOMMatrixReadOnly(getComputedStyle(layer).transform);
    move({ x: matrix.e, y: matrix.f, zoom: matrix.a });
  }
  useLayoutEffect(() => {
    cancelDwell();
    clearCursor();
    paint.current(true);
    move({ ...HOME, zoom: homeZoom });
  }, [layout, homeZoom]);

  useEffect(() => {
    const el = container.current!;
    function wheel(event: WheelEvent) {
      if ((event.target as Element).closest('[data-controls]')) return;
      event.preventDefault();
      cancelDwell();
      interruptFlight();
      const rect = el.getBoundingClientRect();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
      const view = camera.current;
      move(zoomAt(view, { x: event.clientX - rect.left, y: event.clientY - rect.top },
        view.zoom * Math.exp(-event.deltaY * unit * .002), LIMITS));
      follow(event.clientX, event.clientY);
    }
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  function pointOf(e: PointerEvent) {
    const rect = container.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function down(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || (e.target as Element).closest('[data-controls]') || contacts.current.size >= 2) return;
    cancelDwell();
    interruptFlight();
    const button = (e.target as Element).closest<HTMLElement>('[data-node]');
    if (!button && selection) onClose();
    follow(e.clientX, e.clientY, button?.dataset.node);
    const hit = button?.getBoundingClientRect();
    const layer = world.current!.getBoundingClientRect();
    const scale = layer.width / world.current!.offsetWidth;
    nodeDrag.current = button && hit ? { readyAt: e.pointerType === 'touch' ? performance.now() + 300 : 0,
      id: button.dataset.node!, point: { x: (hit.x + hit.width / 2 - layer.x) / scale, y: (hit.y + hit.height / 2 - layer.y) / scale },
      start: { x: e.clientX, y: e.clientY } } : null;
    const point = pointOf(e);
    if (!contacts.current.size) { moved.current = false; start.current = point; }
    contacts.current.set(e.pointerId, point);
    if (contacts.current.size === 2) {
      nodeDrag.current = null;
      clearCursor();
      moved.current = true;
      for (const id of contacts.current.keys()) e.currentTarget.setPointerCapture(id);
    }
  }
  function drag(e: PointerEvent<HTMLDivElement>) {
    const pointers = contacts.current, previous = pointers.get(e.pointerId);
    if (!previous) {
      if ((e.target as Element).closest('[data-controls]')) { cancelDwell(); clearCursor(); }
      else if (!pointers.size && e.pointerType !== 'touch') { waitForStillPointer(e); follow(e.clientX, e.clientY, (e.target as Element).closest<HTMLElement>('[data-node]')?.dataset.node); }
      return;
    }
    const next = pointOf(e), old = [...pointers.values()];
    if (!moved.current && start.current && distance(next, start.current) < CANVAS_DRAG_THRESHOLD) return;
    moved.current = true;
    if (nodeDrag.current && performance.now() < nodeDrag.current.readyAt) nodeDrag.current = null;
    e.currentTarget.setPointerCapture(e.pointerId);
    setHover(null);
    pointers.set(e.pointerId, next);
    const view = camera.current;
    if (pointers.size === 2) {
      const now = [...pointers.values()], a = midpoint(old[0], old[1]), b = midpoint(now[0], now[1]);
      const z = zoomAt(view, a, view.zoom * distance(now[0], now[1]) / Math.max(1, distance(old[0], old[1])), LIMITS);
      move({ ...z, x: z.x + b.x - a.x, y: z.y + b.y - a.y });
    } else if (nodeDrag.current) {
      const held = nodeDrag.current;
      placements.current.set(held.id, {
        x: clamp(held.point.x + (e.clientX - held.start.x) / view.zoom, 20, width - 20) / width,
        y: clamp(held.point.y + (e.clientY - held.start.y) / view.zoom, 20, height - 20) / height,
      });
      layoutDirty.current = true;
      follow(e.clientX, e.clientY, held.id);
    } else {
      move({ ...view, x: view.x + next.x - previous.x, y: view.y + next.y - previous.y });
      follow(e.clientX, e.clientY);
    }
  }
  function release(id: number) { contacts.current.delete(id); if (!contacts.current.size) nodeDrag.current = null; }
  function node(point: Point, size: number, value: TasteSelection, label: string, body: ReactNode, dim = false, caption?: string) {
    const active = selection?.kind === value.kind && ('id' in value ? 'id' in selection && selection.id === value.id : true);
    return <button type="button" key={'id' in value ? value.kind + value.id : 'mix'} className={styles.node}
      data-dwell={hover?.kind === value.kind && ('id' in value ? 'id' in hover && hover.id === value.id : true) || undefined}
      data-node={'id' in value ? value.id : 'mix'} data-kind={value.kind} data-muted={dim || undefined} aria-pressed={active} aria-label={label}
      style={{ left: point.x, top: point.y, width: size, height: value.kind === 'song' || value.kind === 'album' ? 24 : size }}
      onFocus={e => { if (e.currentTarget.matches(':focus-visible')) setHover(value); }}
      onBlur={() => cancelDwell()}
      onClick={() => { cancelDwell(); onSelect(value); }}>
      <span className={styles.object}>{body}</span>
      {caption && <span className={styles.caption}>{caption}</span>}
    </button>;
  }

  return <div ref={container} className={styles.frame} role="group" tabIndex={0} aria-keyshortcuts="+ - Home" aria-label="音乐星图" style={{ '--label-scale': Math.min(1.6, 1 / homeZoom) } as CSSProperties}
    onKeyDown={e => {
      if (e.key === 'Escape' && highlight) { e.preventDefault(); e.stopPropagation(); cancelDwell(); onClose(); }
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Home') {
        e.preventDefault(); placements.current.clear(); clearCursor(); cancelDwell(); paint.current(true);
        move({ ...HOME, zoom: homeZoom }, true); onClose();
      } else if (['+', '=', '-'].includes(e.key)) {
        e.preventDefault(); clearCursor(); cancelDwell();
        move(zoomAt(camera.current, { x: bounds.width / 2, y: bounds.height / 2 }, camera.current.zoom * (e.key === '-' ? 1 / 1.3 : 1.3), LIMITS), true);
      }
    }}
    onPointerDown={down} onPointerMove={drag} onPointerUp={e => { release(e.pointerId); if (e.pointerType === 'touch') clearCursor(); }}
    onPointerCancel={e => { release(e.pointerId); clearCursor(); }} onLostPointerCapture={e => { if (e.target === e.currentTarget) release(e.pointerId); }}
    onPointerLeave={e => { if (!e.currentTarget.hasPointerCapture(e.pointerId)) { cancelDwell(); leaveField(); release(e.pointerId); } }}
    onClickCapture={e => { if (e.detail && moved.current && !(e.target as Element).closest('[data-controls]')) { e.stopPropagation(); moved.current = false; } }}>
    <div className={styles.world} ref={world} style={{ width, height }}>
      <div className={styles.plane}>
      <svg className={styles.chart} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        {hubs.map((hub, index) => <g key={hub.id} data-cluster-lines={index} stroke={hub.color} fill="none">
          <g opacity={isNear(hub) ? 1 : .2}>
            <line strokeWidth="1" opacity=".55" />
            <line pathLength="100" className={styles.hubFlow} strokeWidth="2.2" strokeDasharray="10 90"
              style={{ animationDelay: `${-index * .47}s` }} />
          </g>
          <path strokeWidth=".9" opacity={centerFocus || trackFocus ? .11 : .44} />
          <path strokeWidth=".9" strokeDasharray="2 4" opacity={centerFocus || trackFocus ? .11 : .44} />
          <path strokeWidth="1.6" strokeDasharray="8 3" className={trackFocus || centerFocus ? styles.signal : undefined} />
        </g>)}
        <g ref={pointerLinks} data-pointer-links="" style={{ display: 'none' }} stroke="var(--pointer-link, #679aef)" strokeWidth="2.4" strokeLinecap="round">
          {[0,1,2,3].map(i => <line key={i} opacity={1 - i * .09} vectorEffect="non-scaling-stroke" />)}
        </g>
      </svg>
      {hubs.map((hub, i) => <div key={hub.id} data-cluster={i} className={styles.cluster}>
      {tracks.filter(p => p.primary === hub).map(p => {
        const song = p.track.song, album = albums?.get(song.id);
        const value: TasteSelection = { kind: album ? 'album' : 'song', id: song.id };
        const showLabel = allLabels || p.sparse || trackFocus === song.id;
        const dim = trackFocus ? song.id !== trackFocus : !!centerFocus && !p.hubs.some(h => h.id === centerFocus);
        return node(p, showLabel ? labelWidth(p.label, compact ? 12 * Math.min(1.6, 1/homeZoom) : 12) + 12 : 22, value,
          album ? '专辑 · ' + song.name : song.name + ' · ' + song.artists.map(a => a.name).join(' / '),
          <span className={styles.workTitle} data-dot={!showLabel || undefined}>{showLabel ? p.label : '·'}</span>, dim);
      })}
      {node(hub, compact ? 29 : 36, { kind: 'center', id: hub.id },
        (hub.kind === 'artist' ? '歌手中心 · ' : hub.kind === 'tag' ? '标签中心 · ' : '发现中心 · ') + hub.label,
        <span className={styles.hub} data-type={hub.kind}><Icon n={hub.kind === 'artist' ? 'user' : 'lib'} s={compact ? 13 : 16} /></span>,
        !isNear(hub), hub.label)}
      </div>)}
      {!!mix.length && node(origin, discRadius * 2, { kind: 'mix' }, `为你推荐 · ${mix.length} 首`,
        <MusicArtwork item={{ kind: 'playlist', name: '为你推荐', song: mix[0].song, tracks: mix.map(t => t.song) }} />)}
      <span ref={pointer} hidden aria-hidden="true" className={styles.pointerStar} style={{ left: 0, top: 0 }} />
      </div>
    </div>
    {highlight && (selection || isWork) && <div key={highlight.kind + focusId} data-controls="" data-pinned={!!selection}
      className={isWork ? styles.previewCard : styles.collectionCard}>
      {renderDetail(highlight, !!selection)}
    </div>}
  </div>;
}
