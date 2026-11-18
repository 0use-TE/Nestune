import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const file = new URL('../overlay/lyrics.html', import.meta.url);
const script = fs.readFileSync(file, 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const elements = new Map(), calls = [];
const get = id => {
  if (!elements.has(id)) elements.set(id, { textContent: '', hidden: false, attributes: {}, listeners: {}, style: { transform: '' }, scrollWidth:100, clientWidth:100, icon:{innerHTML:'', setAttribute() {}}, querySelector() {return this.icon;}, setAttribute(name, value) { this.attributes[name] = value; }, addEventListener(type, fn) { this.listeners[type] = fn; }, dataset: { control: id } });
  return elements.get(id);
};
const state = { enabled: true, locked: false, panel: false };
const window = { NestuneKaraoke: { create: () => ({ clear(text) { get('line-content').textContent = text; }, render(line) { get('line-content').textContent = line.text; } }) }, __TAURI_INTERNALS__: { invoke: async (command, payload) => {
  calls.push({ command, payload });
  if (payload.data?.type === 'lyricsSnapshot') return { state: { ...state }, data: null, media: null };
  if (payload.data?.type === 'lyricsLock') state.locked = payload.data.locked;
  if (payload.data?.type === 'lyricsPanel') state.panel = payload.data.panel;
  if (payload.data?.type === 'lyricsEnable') state.enabled = payload.data.enabled;
  return { ...state };
} } };
const body = { classList: { toggle() {} }, dataset: {} };
const controls = ['mode', 'previous', 'toggle', 'next'].map(get);
let idleCallback;
vm.runInNewContext(script, { window, document: { getElementById: get, querySelectorAll: () => controls, body },
  performance: { now: () => 0 }, URLSearchParams, location: {search:''}, setInterval() {},
  clearTimeout() {}, setTimeout(callback, delay) { assert.equal(delay, 3000); idleCallback = callback; } });
await Promise.resolve();
calls.length = 0;
get('drag').listeners.mousedown({ button: 0, target: { closest: () => null } });
assert.equal(calls[0].command, 'lyrics_command');
assert.equal(calls[0].payload.data.type, 'lyricsDrag');
calls.length = 0;
get('drag').listeners.mousedown({ button: 0, target: { closest: () => ({}) } });
assert.equal(calls.length, 0, 'Toolbar buttons must not start dragging');
window.nestuneLyricsData({ id: 'a', title: 'song', lines: [{ t: 0, text: 'first', tr: 'translation' }, { t: 3, text: 'second' }] });
window.nestuneLyricsMedia({ id: 'a', position: 3.5, playing: false });
assert.equal(get('line-content').textContent, 'second');
window.nestuneLyricsMedia({ id: 'a', position: .5, playing: false });
assert.equal(get('line-content').textContent, 'first');
assert.equal(get('translation-content').textContent, 'translation');
await get('lock').onclick();
assert.equal(state.locked, true);
const closedIcon = get('lock').icon.innerHTML;
assert.ok(closedIcon.includes('M8 10V6'));
assert.equal(get('lock').attributes['aria-label'], '解锁歌词位置');
calls.length = 0;
get('drag').listeners.mousedown({ button: 0, target: { closest: () => null } });
assert.equal(calls.length, 0, 'Locked lyrics must not start dragging');
idleCallback();
assert.equal(body.dataset.idle, '');
get('drag').listeners.pointerdown();
assert.equal(body.dataset.idle, undefined);
window.nestuneLyricsMedia({ id: 'a', position: .5, playing: true, mode: 'one' });
assert.equal(get('mode').attributes['aria-label'], '切换播放模式，当前单曲循环');
assert.equal(get('toggle').attributes['aria-label'], '暂停');
for (const item of controls) {
  await item.onclick();
  assert.equal(calls.at(-1).payload.data.type, 'lyricsPlayback');
  assert.equal(calls.at(-1).payload.data.action, item.dataset.control);
}
await get('panel').onclick();
assert.equal(state.panel, true, 'Background remains interactive while locked');
await get('close').onclick();
assert.equal(state.enabled, false, 'Locked lyrics can still be closed');
await get('lock').onclick();
assert.equal(state.locked, false, 'The same lock button also unlocks');
assert.notEqual(get('lock').icon.innerHTML, closedIcon, 'Lock and unlock must render different SVGs');
console.log('Desktop renderer passed: drag wiring, locked drag denial, unlock/background/close while locked, seek and translation');
