import { isEan13 } from '../barcode';

const L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
const G = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
const R = L.map(s => [...s].map(c => c === '0' ? '1' : '0').join(''));
const PARITY = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function ean13Svg(code: string): string {
  if (!isEan13(code)) throw new Error('Invalid EAN-13');
  const parity = PARITY[Number(code[0])]!;
  const bits = '101' + [...code.slice(1, 7)].map((d, i) => (parity[i] === 'L' ? L : G)[Number(d)]).join('') + '01010' + [...code.slice(7)].map(d => R[Number(d)]).join('') + '101';
  const bars = [...bits].map((bit, i) => bit === '1' ? `<rect x="${i + 11}" y="0" width="1" height="50"/>` : '').join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 117 62" role="img" aria-label="${code}"><rect width="117" height="62" fill="white"/><g fill="black">${bars}</g><text x="58.5" y="60" text-anchor="middle" font-size="9" font-family="monospace">${code}</text></svg>`;
}

export type LabelFormat = '58x40' | '43x25' | 'a6' | 'a4';
export interface LabelItem { name: string; sku: string; barcode: string; price: string; copies: number }
export function renderLabels(items: LabelItem[], format: LabelFormat): string {
  const sizes: Record<LabelFormat, [number, number]> = { '58x40': [58, 40], '43x25': [43, 25], a6: [105, 148], a4: [70, 42] };
  const [w, h] = sizes[format];
  const labels = items.flatMap(item => Array.from({ length: Math.min(1000, Math.max(0, Math.floor(item.copies))) }, () => `<article><strong>${escape(item.name)}</strong><span>${escape(item.sku)}</span>${ean13Svg(item.barcode)}<b>${escape(item.price)}</b></article>`)).join('');
  const page = format === 'a4' ? 'A4' : `${w}mm ${h}mm`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:${page};margin:0}*{box-sizing:border-box}body{margin:0;display:flex;flex-wrap:wrap;font-family:sans-serif;color:#000}article{width:${w}mm;height:${h}mm;padding:2mm;display:flex;flex-direction:column;align-items:center;justify-content:space-between;overflow:hidden;break-inside:avoid;text-align:center}strong{font-size:${format === '43x25' ? 9 : 12}pt;line-height:1.1;overflow:hidden}span{font-size:8pt}svg{width:80%;min-height:0;flex:1}b{font-size:${format === 'a6' ? 28 : 13}pt}</style></head><body>${labels}</body></html>`;
}
