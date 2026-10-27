// ?overflow in the URL lists elements wider than the screen (layout check only).
export function overflowReport() {
  if (!location.search.includes('overflow')) return;
  setTimeout(() => {
    const W = document.documentElement.clientWidth;
    const bad: string[] = [];
    document.querySelectorAll<HTMLElement>('.content .fn').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.right > W + 1 && r.width > 0) {
        const kids = Array.from(el.children).some((c) => (c as HTMLElement).getBoundingClientRect().right > W + 1);
        if (!kids) bad.push(`${el.dataset.name || el.className.slice(0, 30)} w=${Math.round(r.width)} r=${Math.round(r.right)} | ${el.getAttribute('style')?.slice(0, 120)}`);
      }
    });
    const box = document.createElement('pre');
    box.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999;background:#fff;color:#000;font:11px monospace;white-space:pre-wrap;max-height:100vh;overflow:auto;padding:8px';
    box.textContent = `W=${W} overflow leaves: ${bad.length}\n` + bad.slice(0, 40).join('\n');
    document.body.appendChild(box);
  }, 1500);
}
