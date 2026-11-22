/* Просмотр скриншота крупно: картинка вырастает из миниатюры (FLIP), Esc, клик по фону или крестик закрывают */
export function initZoom() {
  const dlg = document.querySelector<HTMLDialogElement>('.h-zoom');
  const img = dlg?.querySelector<HTMLImageElement>('.h-zoom-img');
  const cap = dlg?.querySelector<HTMLElement>('.h-zoom-cap');
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  let from: HTMLElement | null = null;
  let closing = false;

  const flip = (a: DOMRect, b: DOMRect) =>
    `translate(${a.left + a.width / 2 - (b.left + b.width / 2)}px, ${a.top + a.height / 2 - (b.top + b.height / 2)}px) scale(${a.width / b.width})`;

  const open = (btn: HTMLElement) => {
    if (!dlg || !img || !cap) return;
    from = btn;
    img.src = btn.dataset.zoom!;
    img.alt = btn.dataset.alt ?? '';
    cap.textContent = btn.dataset.alt ?? '';
    dlg.showModal();
    document.documentElement.classList.add('h-zoom-lock');
    if (reduced()) return;
    const a = btn.querySelector('img')!.getBoundingClientRect();
    const b = img.getBoundingClientRect();
    img.animate([{ transform: flip(a, b), borderRadius: '16px' }, { transform: 'none', borderRadius: '12px' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
    dlg.animate([{ backgroundColor: 'rgba(14,16,22,0)' }, { backgroundColor: 'rgba(14,16,22,.82)' }], { duration: 320, easing: 'ease-out' });
    cap.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 180, fill: 'backwards' });
  };

  const close = async () => {
    if (!dlg || !img || closing || !dlg.open) return;
    closing = true;
    const thumb = from?.querySelector('img');
    if (!reduced() && thumb) {
      const a = thumb.getBoundingClientRect();
      const b = img.getBoundingClientRect();
      const anims = [
        img.animate([{ transform: 'none' }, { transform: flip(a, b), borderRadius: '16px' }], { duration: 340, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' }),
        dlg.animate([{ backgroundColor: 'rgba(14,16,22,.82)' }, { backgroundColor: 'rgba(14,16,22,0)' }], { duration: 300, easing: 'ease-in', fill: 'forwards' }),
        cap!.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: 'forwards' }),
      ];
      await Promise.all(anims.map(x => x.finished)).catch(() => {});
      anims.forEach(x => x.cancel());
    }
    dlg.close();
    document.documentElement.classList.remove('h-zoom-lock');
    from?.focus();
    closing = false;
  };

  document.querySelectorAll<HTMLElement>('.h-mp-zoom').forEach(b => b.addEventListener('click', () => open(b)));
  dlg?.querySelector('.h-zoom-close')?.addEventListener('click', close);
  dlg?.addEventListener('click', e => { if (e.target === dlg || e.target === dlg.querySelector('.h-zoom-fig')) close(); });
  dlg?.addEventListener('cancel', e => { e.preventDefault(); close(); });
}
