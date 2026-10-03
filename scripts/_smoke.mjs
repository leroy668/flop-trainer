/**
 * 冒烟测试：把 driver 注入 flop-trainer.html，用 headless Chrome 抓取渲染后的 DOM，
 * 验证“后续听牌”面板真的渲染出来了（数字由单元测试锁定）。
 * 用法：npm run build:single && node scripts/_smoke.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
// 可选第一个参数：指定要冒烟的 HTML 文件（默认用本地打包产物）。
const input = process.argv[2] ?? path.join(root, 'flop-trainer.html');
const html = readFileSync(input, 'utf8');

const driver = `
<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    var toggle = document.querySelector('.switch input');
    if (toggle && !toggle.checked) toggle.click();
    setTimeout(function () {
      var panels = [].slice.call(document.querySelectorAll('section.panel'));
      var drawPanel = panels.filter(function (p) {
        var h = p.querySelector('h2');
        return h && h.textContent.indexOf('后续听牌') >= 0;
      })[0];
      var txt = function (el) { return el ? el.innerText.replace(/\\s+/g, ' ').trim() : null; };
      var pre = document.createElement('pre');
      pre.id = 'smoke-marker';
      pre.textContent = JSON.stringify({
        heroCards: [].map.call(document.querySelectorAll('.board__group'), function (g) { return txt(g); }),
        heroType: txt(document.querySelector('.hero-type')),
        drawPanelTitle: txt(drawPanel ? drawPanel.querySelector('h2') : null),
        heroRows: [].map.call(document.querySelectorAll('.draw'), function (el) { return txt(el); }),
        partitions: drawPanel ? [].map.call(drawPanel.querySelectorAll('.overall-list__item'), function (el) { return txt(el); }) : [],
        tableHead: txt(document.querySelector('.draw-table__head')),
        tableRows: [].map.call(document.querySelectorAll('.draw-table__row'), function (el) { return txt(el); }),
        summary: [].map.call(document.querySelectorAll('.draw-summary__row'), function (el) { return txt(el); }),
        legend: txt(document.querySelector('.draw-tip')),
        colors: {
          turn: (function () { var e = document.querySelector('.draw__stat .pct--neutral'); return e ? getComputedStyle(e).color : null; })(),
          river: (function () { var e = document.querySelector('.draw__stat .pct--danger'); return e ? getComputedStyle(e).color : null; })(),
          joint: (function () { var e = document.querySelector('.draw-table__cell .pct--info'); return e ? getComputedStyle(e).color : null; })(),
        },
        panelCount: panels.length,
      }, null, 2);
      document.body.appendChild(pre);
    }, 900);
  }, 400);
});
</script>
`;

const injected = html.replace('<div id="root"></div>', `<div id="root"></div>${driver}`);
const target = path.join(tmpdir(), `smoke-${Date.now()}.html`);
writeFileSync(target, injected, 'utf8');

const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const dump = execFileSync(
  chrome,
  [
    '--headless=new',
    '--disable-gpu',
    '--virtual-time-budget=20000',
    '--allow-file-access-from-files',
    '--dump-dom',
    `file:///${target.replace(/\\/g, '/')}`,
  ],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);

const match = dump.match(/<pre id="smoke-marker">([\s\S]*?)<\/pre>/);
if (!match) {
  console.log('NO MARKER');
  console.log(dump.slice(-2000));
  process.exit(1);
}
const json = match[1]
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"');
console.log(json);
