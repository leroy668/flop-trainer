/**
 * 临时冒烟：检查 #/flop-types 牌型图鉴页（枚举 + 渲染 + 样式）。
 *   node scripts/_smoke-tax.mjs [--view=detail] [--group=made] [--size=1200x900]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const option = (name) => {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const root = path.resolve(import.meta.dirname, '..');
const input = args.find((arg) => !arg.startsWith('--')) ?? path.join(root, 'flop-trainer.html');
const html = readFileSync(input, 'utf8');
const [winW, winH] = (option('size') ?? '1200x900').split('x');

const driver = `
<script>
window.location.hash = '#/flop-types';
window.addEventListener('load', function () {
  var VIEW = ${JSON.stringify(option('view'))};
  var GROUP = ${JSON.stringify(option('group'))};
  var tries = 0;
  var txt = function (el) { return el ? el.innerText.replace(/\\s+/g, ' ').trim() : null; };
  function finish(payload) {
    var pre = document.createElement('pre');
    pre.id = 'smoke-tax';
    pre.textContent = JSON.stringify(payload, null, 2);
    document.body.appendChild(pre);
  }
  function poll() {
    var rows = document.querySelectorAll('.tax-row');
    if (!rows.length && tries < 600) { tries += 1; return setTimeout(poll, 50); }
    var out = { tries: tries };
    if (VIEW) {
      var tabs = document.querySelectorAll('.tax-tabs button');
      out.tabs = [].map.call(tabs, txt);
      tabs[VIEW === 'detail' ? 1 : 0].click();
    }
    if (GROUP) {
      var groups = document.querySelectorAll('.tax-groups button');
      out.groupButtons = [].map.call(groups, txt);
      var hit = [].find.call(groups, function (b) { return txt(b).indexOf(GROUP) >= 0; });
      if (hit) hit.click();
    }
    setTimeout(function () {
      var toggle = document.querySelector('.tax-row__toggle');
      if (toggle) toggle.click();
    }, 60);
    setTimeout(function () {
      var rows2 = document.querySelectorAll('.tax-row');
      var sections = document.querySelectorAll('.tax-section');
      var pcts = document.querySelectorAll('.tax-row__pct');
      var first = rows2[0];
      var firstPct = first ? first.querySelector('.tax-row__pct') : null;
      var bar = first ? first.querySelector('.tax-row__bar-fill') : null;
      var chips = first ? first.querySelectorAll('.mini-card') : [];
      out.title = txt(document.querySelector('h1'));
      out.headerText = txt(document.querySelector('.page__header p'));
      out.rowCount = rows2.length;
      out.sectionNames = [].map.call(sections, txt);
      out.firstRows = [].slice.call(rows2, 0, 6).map(txt);
      out.firstRowPct = txt(firstPct);
      out.firstRowPctStyle = firstPct ? getComputedStyle(firstPct).fontSize + '/' + getComputedStyle(firstPct).fontWeight : null;
      out.firstRowBarWidth = bar ? bar.style.width : null;
      out.chips = [].map.call(chips, txt);
      out.chipColors = [].map.call(chips, function (c) { return getComputedStyle(c).color; });
      out.expandButton = txt(document.querySelector('.tax-row__toggle'));
      out.members = [].map.call(
        document.querySelectorAll('.tax-members li'),
        txt,
      ).slice(0, 4);
      out.memberCount = document.querySelectorAll('.tax-members li').length;
      out.legend = txt(document.querySelector('.tax-legend'));
      out.noteLines = [].map.call(document.querySelectorAll('.tax-note li'), txt).length;
      out.activeTab = txt(document.querySelector('.tax-tabs .is-active .result-tab__label'));
      out.stackSegs = document.querySelectorAll('.tax-stack__seg').length;
      out.overflowX = document.documentElement.scrollWidth > window.innerWidth;
      out.bodyScrollWidth = document.documentElement.scrollWidth;
      out.innerWidth = window.innerWidth;
      finish(out);
    }, 250);
  }
  poll();
});
</script>
`;

const target = path.join(tmpdir(), `smoke-tax-${Date.now()}.html`);
writeFileSync(target, html.replace('<div id="root"></div>', `<div id="root"></div>${driver}`), 'utf8');

const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const url = 'file:///' + target.split(path.sep).join('/');
const dump = execFileSync(
  chrome,
  [
    '--headless=new',
    '--disable-gpu',
    `--window-size=${winW},${winH}`,
    '--virtual-time-budget=60000',
    '--allow-file-access-from-files',
    '--dump-dom',
    url,
  ],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);

const match = dump.match(/<pre id="smoke-tax">([\s\S]*?)<\/pre>/);
if (!match) {
  console.log('NO MARKER');
  console.log(dump.slice(-3000));
  process.exit(1);
}
console.log(
  match[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'),
);
