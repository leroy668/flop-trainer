/**
 * 冒烟测试：把 driver 注入 HTML，用 headless Chrome 跑起来，抓渲染后的 DOM。
 *
 * 选项：
 *   <html 路径>          要冒烟的 HTML（默认 flop-trainer.html）
 *   --answer=first|all   先自动答题再检查（first=只选第一个牌型，all=全选）
 *   --deal=1|2           在结果页点「发转牌」/「发河牌」，1=到转牌圈，2=到河牌圈
 *   --undo=1|2           发完牌后再点「↩ 回到…」收回上一街，1=退回一街，2=退回两街
 *   --stop=1             发完牌后停在新一街的作答页，只抓答题态 DOM（查牌面下方的收回按钮）
 *   --tab=<序号>         只点开第 N 个选项卡（0 起算）
 *   --shot=<png 路径>    截图而不是打 DOM（配合 --tab 用）
 *   --size=WxH           视口大小（默认 1200x900，手机用 390x844）
 *
 * 例：
 *   npm run build:single && node scripts/_smoke.mjs
 *   node scripts/_smoke.mjs --answer=all
 *   node scripts/_smoke.mjs --deal=1 --answer=all
 *   node scripts/_smoke.mjs --deal=2 --undo=2 --answer=all   # 发到河牌再退回翻牌圈
 *   node scripts/_smoke.mjs --size=390x844 --tab=1 --shot="$TEMP/tabs.png"
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

const answerMode = option('answer');
const deals = Number(option('deal') ?? 0);
const undos = Number(option('undo') ?? 0);
const stopAfterDeal = option('stop') === '1';
const tabIndex = option('tab') === null ? null : Number(option('tab'));
const shot = option('shot');
const [winW, winH] = (option('size') ?? '1200x900').split('x');
const root = path.resolve(import.meta.dirname, '..');
const input = args.find((arg) => !arg.startsWith('--')) ??
  path.join(root, 'flop-trainer.html');
const html = readFileSync(input, 'utf8');

const driver = `
<script>
window.addEventListener('load', function () {
  var ANSWER_MODE = ${JSON.stringify(answerMode)};
  var TAB_INDEX = ${JSON.stringify(tabIndex)};
  var DEALS_LEFT = ${JSON.stringify(Number.isFinite(deals) ? deals : 0)};
  var UNDOS_LEFT = ${JSON.stringify(Number.isFinite(undos) ? undos : 0)};
  var DEALS_TOTAL = DEALS_LEFT;
  var UNDOS_DONE = 0;
  var STOP_AFTER_DEAL = ${JSON.stringify(stopAfterDeal)};
  var TICK_LIMIT = 80 + DEALS_LEFT * 40;
  var txt = function (el) { return el ? el.innerText.replace(/\\s+/g, ' ').trim() : null; };
  var marker = function (payload) {
    var pre = document.createElement('pre');
    pre.id = 'smoke-marker';
    pre.textContent = JSON.stringify(payload, null, 2);
    document.body.appendChild(pre);
  };

  setTimeout(function () {
    var toggle = document.querySelector('.switch input');
    if (!ANSWER_MODE && toggle && !toggle.checked) toggle.click();
    setTimeout(ANSWER_MODE ? autoAnswer : reachedResult, ANSWER_MODE ? 250 : 700);
  }, 300);

  function dealButton() {
    return [].slice.call(document.querySelectorAll('.actions--sticky .button'))
      .filter(function (b) { return b.innerText.indexOf('发') === 0; })[0] || null;
  }

  function undoButton() {
    return [].slice.call(document.querySelectorAll('.actions--sticky .button'))
      .filter(function (b) { return b.innerText.indexOf('↩') === 0; })[0] || null;
  }

  /** 结果页就绪：先按需发下一条街 / 收回上一街，再遍历选项卡。 */
  function reachedResult() {
    var deal = dealButton();
    if (DEALS_LEFT > 0 && deal) {
      DEALS_LEFT -= 1;
      deal.click();
      // 转牌 / 河牌要重新枚举一遍（990 个组合），多等一会儿。
      setTimeout(function () {
        if (STOP_AFTER_DEAL && DEALS_LEFT === 0) { captureAnswering(); return; }
        if (ANSWER_MODE) autoAnswer(); else reachedResult();
      }, 900);
      return;
    }
    var undo = undoButton();
    if (UNDOS_LEFT > 0 && undo) {
      UNDOS_LEFT -= 1;
      UNDOS_DONE += 1;
      undo.click();
      setTimeout(reachedResult, 500);
      return;
    }
    if (TAB_INDEX === null) walkTabs();
    else openTabs();
  }

  /** 发完牌后不继续作答，只抓当前答题页的牌面与收回按钮。 */
  function captureAnswering() {
    var bar = document.querySelector('.street-undo .button');
    if (UNDOS_LEFT > 0 && bar) {
      UNDOS_LEFT -= 1;
      UNDOS_DONE += 1;
      log.push(txt(bar));
      bar.click();
      setTimeout(captureAnswering, 400);
      return;
    }
    marker({
      mode: 'answering',
      viewport: [window.innerWidth, window.innerHeight],
      street: txt(document.querySelector('.street-badge')),
      header: txt(document.querySelector('.page__header p')),
      scenario: txt(document.querySelector('.board')),
      emptyBoards: document.querySelectorAll('.card--empty').length,
      highlighted: [].map.call(
        document.querySelectorAll('.board__group--new .board__label'),
        txt,
      ),
      undone: UNDOS_DONE,
      step: txt(document.querySelector('.steps__item.is-active')),
      summary: txt(document.querySelector('.result-summary')),
      undoBar: txt(document.querySelector('.street-undo')),
      undoButtonInBoard: !!document.querySelector('.street-undo .button'),
      undoButtons: [].map.call(
        document.querySelectorAll('.street-undo .button, .actions--sticky .button'),
        txt,
      ),
    });
  }

  function openTabs() {
    var tabs = document.querySelectorAll('.result-tab');
    if (TAB_INDEX === null) {
      walkTabs();
      return;
    }
    if (tabs[TAB_INDEX]) tabs[TAB_INDEX].click();
    setTimeout(function () {
      marker({
        mode: 'reveal',
        viewport: [window.innerWidth, window.innerHeight],
        tab: txt(tabs[TAB_INDEX]),
        panelsRendered: document.querySelectorAll('.result .panel').length,
        body: txt(document.querySelector('.app')),
      });
    }, 250);
  }

  // ---- 自动答题（只为了走到结果页，策略很粗糙）----
  var ticks = 0;
  var log = [];
  function act(el, delay) {
    log.push(el.innerText);
    el.click();
    setTimeout(autoAnswer, delay);
  }

  function autoAnswer() {
    ticks += 1;
    if (document.querySelector('.result-tabs')) {
      setTimeout(reachedResult, 250);
      return;
    }
    if (ticks > TICK_LIMIT) {
      marker({ mode: ANSWER_MODE, stuck: true, log: log.slice(0, 40),
        body: txt(document.body).slice(0, 700) });
      return;
    }
    var heading = document.querySelector('.panel h2');
    var text = heading ? heading.innerText : '';
    if (text.indexOf('哪些牌型类别') >= 0) {
      var chips = [].slice.call(document.querySelectorAll('.type-selector .chip'));
      if (ANSWER_MODE === 'all') {
        var pending = chips.filter(function (chip) {
          return !chip.classList.contains('chip--selected') && !chip.disabled;
        })[0];
        if (pending) { act(pending, 60); return; }
      } else if (!window.__pickedCategory) {
        window.__pickedCategory = true;
        var first = chips.filter(function (chip) { return !chip.disabled; })[0];
        if (first) { act(first, 60); return; }
      }
    } else {
      // 一个选项组一个选项组地填，避免在同一个组里反复改选绕圈。
      var groups = [].slice.call(document.querySelectorAll('.range-selector'));
      for (var g = 0; g < groups.length; g += 1) {
        if (groups[g].querySelector('.chip--selected')) continue;
        var option = groups[g].querySelector('.chip:not([disabled])');
        if (option) { act(option, 60); return; }
      }
    }
    // 只认作答区里的按钮，避免点到页头的「换一题」。
    var button = [].slice.call(document.querySelectorAll('.actions .button'))
      .filter(function (b) { return !b.disabled && b.innerText.indexOf('发') !== 0; })[0];
    if (button) { act(button, 150); return; }
    reachedResult();
  }

  // ---- 依次点开每个选项卡，抓每块内容 ----
  function walkTabs() {
    var steps = [];
    var index = 0;

    function capture() {
      var tab = document.querySelectorAll('.result-tab')[index - 1];
      var panel = document.querySelector('.result-panel');
      steps.push({
        tab: tab ? txt(tab) : null,
        activeTabs: document.querySelectorAll('.result-tab.is-active').length,
        heading: txt(panel ? panel.querySelector('h2') : null),
        panelsRendered: document.querySelectorAll('.result .panel').length,
        answerLines: [].map.call(document.querySelectorAll('.result .answer-line'), txt),
        sample: panel ? txt(panel).slice(0, 200) : null,
        textLength: panel ? panel.innerText.length : 0,
      });
    }

    function next() {
      if (index > 0) capture();
      var tabs = document.querySelectorAll('.result-tab');
      if (index >= tabs.length) {
        var bar = document.querySelector('.result-tabs');
        marker({
          mode: ANSWER_MODE || 'reveal',
          viewport: [window.innerWidth, window.innerHeight],
          street: txt(document.querySelector('.street-badge')),
          dealt: DEALS_TOTAL - DEALS_LEFT,
          undone: UNDOS_DONE,
          undoLabel: txt(undoButton()),
          header: txt(document.querySelector('.page__header p')),
          scenario: txt(document.querySelector('.board')),
          emptyBoards: document.querySelectorAll('.card--empty').length,
          heroType: txt(document.querySelector('.hero-type')),
          steps: steps,
          tabLabels: [].map.call(tabs, txt),
          tabBar: bar
            ? {
                height: Math.round(bar.getBoundingClientRect().height),
                rows: [].map.call(tabs, function (el) {
                  var r = el.getBoundingClientRect();
                  return [Math.round(r.top), Math.round(r.width)];
                }),
              }
            : null,
          sticky: bar ? getComputedStyle(bar).position : null,
          summary: txt(document.querySelector('.result-summary')),
          flags: [].map.call(
            document.querySelectorAll('.result-tab--ok, .result-tab--bad'),
            function (el) {
              return (el.classList.contains('result-tab--ok') ? 'ok' : 'bad') +
                ':' + getComputedStyle(el).color;
            },
          ),
        });
        return;
      }
      tabs[index].click();
      index += 1;
      setTimeout(next, 200);
    }

    next();
  }
});
</script>
`;

const target = path.join(tmpdir(), `smoke-${Date.now()}.html`);
writeFileSync(
  target,
  html.replace('<div id="root"></div>', `<div id="root"></div>${driver}`),
  'utf8',
);

const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const url = 'file:///' + target.split(path.sep).join('/');
const chromeArgs = [
  '--headless=new',
  '--disable-gpu',
  `--window-size=${winW},${winH}`,
  '--virtual-time-budget=30000',
  '--allow-file-access-from-files',
];
if (shot) {
  chromeArgs.push(`--screenshot=${shot}`);
}
chromeArgs.push('--dump-dom', url);

const dump = execFileSync(chrome, chromeArgs, {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

if (shot) {
  console.log(`screenshot: ${shot}`);
  process.exit(0);
}

const match = dump.match(/<pre id="smoke-marker">([\s\S]*?)<\/pre>/);
if (!match) {
  console.log('NO MARKER');
  console.log(dump.slice(-2000));
  process.exit(1);
}
console.log(
  match[1]
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"'),
);
