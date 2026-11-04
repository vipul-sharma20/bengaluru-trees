export const isEmbedded = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('embed') === '1';

if (isEmbedded) {
  document.documentElement.classList.add('embed-mode');
  // A tall iframe can be partly outside the article viewport when a dialog opens.
  new MutationObserver((changes) => {
    for (const { target } of changes) {
      if (!(target instanceof HTMLDialogElement) || !target.open) continue;
      const visibleFrame = new IntersectionObserver(([entry]) => {
        const { top, height } = entry.intersectionRect;
        if (height > 0) {
          document.documentElement.style.setProperty('--embed-visible-top', `${Math.max(0, top)}px`);
          document.documentElement.style.setProperty('--embed-visible-height', `${height}px`);
        }
        visibleFrame.disconnect();
      });
      visibleFrame.observe(document.documentElement);
    }
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
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
  let frame;
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      // Unlike scrollHeight, this does not grow to fill the iframe's own height.
      const height = Math.ceil(element.getBoundingClientRect().bottom + window.scrollY);
      if (height > 0 && height !== lastHeight) {
        lastHeight = height;
        window.parent.postMessage({ type: 'tree-census:resize', height }, origin);
      }
    });
  };
  new ResizeObserver(schedule).observe(element);
  window.addEventListener('resize', schedule);
  schedule();
}
