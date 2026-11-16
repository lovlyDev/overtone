// Векторные варианты логотипа Overtone: плоская геометрия и точная палитра.
const fs = require('node:fs');
const path = require('node:path');
const out = path.resolve(__dirname, '../output/logo-concepts');
fs.mkdirSync(out, { recursive: true });
const variants = [
  { id: '01', name: 'Внешняя гармоника', bounds: [12.5, 13.5, 86.5, 87.5], shape: '<circle cx="43" cy="57" r="27"/><path d="M43 17 A40 40 0 0 1 83 57"/>' },
  { id: '02', name: 'Два тона', bounds: [7.5, 13.5, 86.5, 92.5], shape: '<circle cx="38" cy="62" r="27"/><circle cx="70" cy="30" r="13"/>' },
  { id: '03', name: 'Раздвоенный верх', bounds: [14.5, 7.5, 85.5, 85.5], shape: '<path d="M50 26 A28 28 0 1 0 78 54 C78 38 67 26 50 26 M50 11 C70 11 82 26 82 43"/>' },
  { id: '04', name: 'Внутренняя гармоника', bounds: [14.5, 14.5, 85.5, 85.5], shape: '<path d="M25.49 29.43 A32 32 0 1 0 74.51 29.43 M35 33 A15.53 15.53 0 0 1 65 33"/>' },
];
const palettes = { amber: ['#FFB800', '#121212'], white: ['#FFFFFF', '#000000'], black: ['#000000', '#FFFFFF'] };
function mark(v, color) {
  const [x1,y1,x2,y2] = v.bounds;
  const s = 70 / Math.max(x2-x1,y2-y1);
  return `<g transform="translate(50 50) scale(${s}) translate(${-(x1+x2)/2} ${-(y1+y2)/2})" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">${v.shape}</g>`;
}
function svg(w,h,view,content) { return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${view}">${content}</svg>\n`; }
for (const v of variants) {
  const dir = path.join(out, v.id);
  fs.mkdirSync(dir, { recursive: true });
  for (const [palette,[fg,bg]] of Object.entries(palettes)) {
    fs.writeFileSync(path.join(dir, `mark-${palette}-1024.svg`), svg(1024,1024,'0 0 100 100',`<rect width="100" height="100" fill="${bg}"/>${mark(v,fg)}`));
    fs.writeFileSync(path.join(dir, `app-${palette}-1024.svg`), svg(1024,1024,'0 0 100 100',`<rect width="100" height="100" rx="20" fill="${bg}"/>${mark(v,fg)}`));
    fs.writeFileSync(path.join(dir, `horizontal-${palette}.svg`), svg(1600,400,'0 0 400 100',`<rect width="400" height="100" fill="${bg}"/>${mark(v,fg)}<text x="112" y="68" fill="${fg}" font-family="Manrope, Inter Tight, Segoe UI, sans-serif" font-size="62" font-weight="600" letter-spacing="-2">overtone</text>`));
  }
}
fs.writeFileSync(path.join(out, 'README.md'), '# Overtone — четыре варианта\n\n' + variants.map(v=>`${v.id}. ${v.name}`).join('\n') + '\n\nВ каждой папке: знак 1024×1024 с полями минимум 15%, горизонтальная версия и иконка со скруглением. Три палитры: amber, white, black. SVG — плоские векторные оригиналы. В горизонтальной версии текст остаётся редактируемым; шрифт зависит от установленных Manrope / Inter Tight / Segoe UI. Листы preview — эскизы imagegen и могут немного отличаться от точной векторной геометрии. Проверка читаемости на реальном 16×16 ещё не выполнена.\n');
console.log(out);
