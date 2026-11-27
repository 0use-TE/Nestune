type Layer = 'dialog' | 'page';
const stacks: Record<Layer, (() => void)[]> = { dialog: [], page: [] };

export function registerOverlay(close: () => void, layer: Layer = 'dialog') {
  const stack = stacks[layer];
  stack.push(close);
  return () => {
    const index = stack.indexOf(close);
    if (index >= 0) stack.splice(index, 1);
  };
}

export function dismissTopOverlay(layer: Layer = 'dialog') {
  const close = stacks[layer].at(-1);
  if (!close) return false;
  close();
  return true;
}

export function isTopOverlay(close: () => void) {
  return stacks.dialog.at(-1) === close;
}
