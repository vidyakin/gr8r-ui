/* QR-код как встроенный SVG: без сети и внешних картинок, поэтому одинаково виден в предпросмотре и в PDF воркера
   (страница PDF не ходит в сеть). Кодирование — библиотека qrcode-generator (байтовый режим, уровень коррекции M). */
import qrcode from 'qrcode-generator';

/** Квадратный SVG с QR-кодом для текста (обычно ссылка). Размер задаёт контейнер: SVG масштабируется по viewBox */
export function qrSvg(text: string): string {
  const q = qrcode(0, 'M');
  q.addData(text, 'Byte');
  q.make();
  const n = q.getModuleCount();
  const quiet = 2;
  const size = n + quiet * 2;
  let path = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (q.isDark(r, c)) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
