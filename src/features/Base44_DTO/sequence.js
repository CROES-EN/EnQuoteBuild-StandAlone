export const RETRO_SEQUENCE = ["ArrowLeft", "ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight", "ArrowUp"];

export function createSecretSequence(open, now = Date.now) {
  let position = 0;
  let lastKey = 0;
  return (event) => {
    const target = event.target;
    if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey ||
        target?.isContentEditable || target?.closest?.("input, textarea, select, [role='textbox'], [contenteditable]")) {
      position = 0;
      return;
    }
    const time = now();
    if (time - lastKey > 2000) position = 0;
    lastKey = time;
    if (event.key === RETRO_SEQUENCE[position]) position++;
    else position = event.key === RETRO_SEQUENCE[0] ? 1 : 0;
    if (position === RETRO_SEQUENCE.length) {
      position = 0;
      event.preventDefault();
      open();
    }
  };
}
