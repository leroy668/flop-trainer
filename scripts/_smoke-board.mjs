/**
 * 临时冒烟：检查 #/board-textures 牌面结构图鉴页（枚举 + 分组 + 查询 + 样式）。
 *   node scripts/_smoke-board.mjs [--level=shape] [--suit=两色] [--pair=带对]
 *                                 [--query=AKQ] [--lookup=AsKsQd] [--size=1200x900]
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
window.location.hash = '#/board-textures';
window.addEventListener('load', function () {
  var LEVEL = ${JSON.stringify(option('level'))};
  var SUIT = ${JSON.stringify(option('suit'))};
  var PAIR = ${JSON.stringify(option('pair'))};
  var QUERY = ${JSON.stringify(option('query'))};
  var LOOKUP = ${JSON.stringify(option('lookup'))};
  var tries = 0;
  var txt = function (el) { return el ? el.innerText.replace(/\\s+/g, ' ').trim() : null; };
  function setInput(el, value) {
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function finish(payload) {
    var pre = document.createElement('pre');
    pre.id = 'smoke-board';
    pre.textContent = JSON.stringify(payload, null, 2);
    document.body.appendChild(pre);
  }
  function poll() {
    var rows = document.querySelectorAll('.tax-row');
    if (!rows.length && tries < 600) { tries += 1; return setTimeout(poll, 50); }
    var out = { tries: tries };
    var tabs = document.querySelectorAll('.tax-tabs button');
    out.tabs = [].map.call(tabs, txt);
    if (LEVEL) {
      var map = { strategic: 0, shape: 1, coarse: 2, '策略牌面': 0, '牌面形状': 1, '形状 × 花色': 2 };
      var index = map[LEVEL] !== undefined ? map[LEVEL] : null;
      var hit = index !== null
        ? tabs[index]
        : [].find.call(tabs, function (b) { return txt(b).indexOf(LEVEL) >= 0; });
      if (hit) hit.click();
    }
    var groups = document.querySelectorAll('.tax-groups button');
    out.groupButtons = [].map.call(groups, txt);
    if (SUIT) {
      var suit = [].find.call(groups, function (b) { return txt(b).indexOf(SUIT) >= 0; });
      if (suit) suit.click();
    }
    if (PAIR) {
      var pair = [].find.call(groups, function (b) {
        return txt(b).indexOf(PAIR) === 0;
      });
      if (pair) pair.click();
    }
    if (QUERY) {
      var filter = document.querySelector('.board-filter__input');
      if (filter) setInput(filter, QUERY);
    }
    setTimeout(function () {
      var lookupInput = document.querySelector('.board-lookup__input');
      if (LOOKUP && lookupInput) {
        setInput(lookupInput, LOOKUP);
        var buttons = document.querySelectorAll('.board-lookup__row .button');
        if (buttons[0]) buttons[0].click();
      }
    }, 80);
    setTimeout(function () {
      var rows2 = document.querySelectorAll('.tax-row');
      var sections = document.querySelectorAll('.tax-section');
      var first = rows2[0];
      var firstPct = first ? first.querySelector('.tax-row__pct') : null;
      var bar = first ? first.querySelector('.tax-row__bar-fill') : null;
      var chips = first ? first.querySelectorAll('.mini-card') : [];
      var lookupResult = document.querySelector('.board-lookup__result');
      out.title = txt(document.querySelector('h1'));
      out.headerText = txt(document.querySelector('.page__header p'));
      out.rowCount = rows2.length;
      out.sectionNames = [].map.call(sections, txt);
      out.sectionColors = [].map.call(sections, function (s) {
        return getComputedStyle(s).getPropertyValue('--tax-color').trim();
      });
      out.firstRows = [].slice.call(rows2, 0, 6).map(txt);
      out.firstRowPct = txt(firstPct);
      out.firstRowPctStyle = firstPct ? getComputedStyle(firstPct).fontSize + '/' + getComputedStyle(firstPct).fontWeight : null;
      out.firstRowBarWidth = bar ? bar.style.width : null;
      out.firstRowBarColor = bar ? getComputedStyle(bar).backgroundColor : null;
      out.chips = [].map.call(chips, function (c) {
        return txt(c) + ':' + getComputedStyle(c).color;
      });
      out.moreButton = txt(document.querySelector('.board-more'));
      out.moreCount = document.querySelectorAll('.board-more').length;
      out.filterSummary = txt(document.querySelector('.board-filter__summary'));
      out.activeTab = txt(document.querySelector('.tax-tabs .is-active .result-tab__label'));
      out.activeTabHint = txt(document.querySelector('.tax-tabs .is-active .result-tab__hint'));
      out.activeFilters = document.querySelectorAll('.tax-groups .tax-group--active').length;
      out.stackSegs = document.querySelectorAll('.tax-stack__seg').length;
      out.lookupSummary = lookupResult ? txt(lookupResult.querySelector('.board-lookup__summary')) : null;
      out.lookupCards = lookupResult ? [].map.call(lookupResult.querySelectorAll('.mini-card'), txt) : null;
      out.lookupEntries = lookupResult ? [].map.call(lookupResult.querySelectorAll('.board-lookup__entries li'), txt) : null;
      out.lookupError = txt(document.querySelector('.board-lookup__error'));
      out.presetCount = document.querySelectorAll('.board-lookup__preset').length;
      out.noteLines = document.querySelectorAll('.tax-note li').length;
      out.overflowX = document.documentElement.scrollWidth > window.innerWidth;
      out.bodyScrollWidth = document.documentElement.scrollWidth;
      out.innerWidth = window.innerWidth;
      finish(out);
    }, 300);
  }
  poll();
});
</script>
`;

const target = path.join(tmpdir(), `smoke-board-${Date.now()}.html`);
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

const match = dump.match(/<pre id="smoke-board">([\s\S]*?)<\/pre>/);
if (!match) {
  console.log('NO MARKER');
  console.log(dump.slice(-3000));
  process.exit(1);
}
console.log(
  match[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'),
);
