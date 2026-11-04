export const isEmbedded = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('embed') === '1';

if (isEmbedded) document.documentElement.classList.add('embed-mode');

export function openDialog(dialog) {
  if (!isEmbedded) {
    dialog.showModal();
    return;
  }
  // Position in the article's visible slice before native autofocus can scroll it.
  const visibleFrame = new IntersectionObserver(([entry]) => {
    visibleFrame.disconnect();
    const { top, height } = entry.intersectionRect;
    if (height > 0) {
      document.documentElement.style.setProperty('--embed-visible-top', `${Math.max(0, top)}px`);
      document.documentElement.style.setProperty('--embed-visible-height', `${height}px`);
    }
    dialog.showModal();
  });
  visibleFrame.observe(document.documentElement);
}

// This channel carries public layout information only; it never accepts commands.
export function embedParentOrigin(search) {
  const override = new URLSearchParams(search).get('parentOrigin');
  if (override === null) return 'https://vipul.xyz';
  try {
    const url = new URL(override);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.origin === override && (url.protocol === 'https:' || (local && url.protocol === 'http:'))) return url.origin;
  } catch { /* Invalid overrides disable height messages. */ }
  return null;
}

export function reportEmbedHeight(element) {
  if (!isEmbedded || window.parent === window) return;
  const origin = embedParentOrigin(window.location.search);
  if (!origin) return;
  let lastHeight = 0;
  let timer;
  const schedule = () => {
    if (timer) return;
    // Animation frames can be suspended in an iframe below the article fold.
    timer = setTimeout(() => {
      timer = null;
      // Unlike scrollHeight, this does not grow to fill the iframe's own height.
      const height = Math.ceil(element.getBoundingClientRect().bottom + window.scrollY);
      if (height > 0 && height !== lastHeight) {
        lastHeight = height;
        window.parent.postMessage({ type: 'tree-census:resize', height }, origin);
      }
    });
  };
  new ResizeObserver(schedule).observe(element);
  // Offscreen frames can also defer ResizeObserver delivery after async content loads.
  new MutationObserver(schedule).observe(element, {
    subtree: true, childList: true, characterData: true, attributes: true,
  });
  window.addEventListener('resize', schedule);
  schedule();
}
