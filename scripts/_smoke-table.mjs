/**
 * 临时冒烟：检查 #/table 模拟牌桌页（发牌、下注、自动出牌、结算、补码、筹码守恒）。
 *   node scripts/_smoke-table.mjs [--strategy=call|fold|allin] [--hands=3] [--size=1200x900]
 *   node scripts/_smoke-table.mjs --once     只报告初始状态，不自动打牌
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
const flag = (name) => args.includes(`--${name}`);
const root = path.resolve(import.meta.dirname, '..');
const input =
  args.find((arg) => !arg.startsWith('--') && arg.endsWith('.html')) ??
  path.join(root, 'flop-trainer.html');
const html = readFileSync(input, 'utf8');
const [winW, winH] = (option('size') ?? '1200x900').split('x');

const driver = `
<script>
window.location.hash = '#/table';
var errors = [];
window.addEventListener('error', function (e) { errors.push(String(e.message)); });
window.addEventListener('unhandledrejection', function (e) {
  errors.push('rejection: ' + String(e.reason && e.reason.message || e.reason));
});
var STRATEGY = ${JSON.stringify(option('strategy') ?? 'call')};
var HANDS = ${Number(option('hands') ?? 3)};
var ONCE = ${flag('once') ? 'true' : 'false'};
var SPEED = ${JSON.stringify(option('speed'))};
var finalSeats = 0;
function txt(el) { return el ? el.innerText.replace(/\\s+/g, ' ').trim() : null; }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function chipSum() {
  var stacks = [].map.call(document.querySelectorAll('.seat__stack-value'), function (el) {
    return Number(txt(el));
  });
  var pot = Number(txt(document.querySelector('.table-pot__value'))) || 0;
  return stacks.reduce(function (a, b) { return a + b; }, 0) + pot;
}
function finish(payload) {
  var pre = document.createElement('pre');
  pre.id = 'smoke-table';
  pre.textContent = JSON.stringify(payload, null, 2);
  document.body.appendChild(pre);
}
(async function run() {
  var tries = 0;
  while (document.querySelectorAll('.seat').length < 4 && tries < 200) {
    tries += 1;
    await sleep(50);
  }
  var out = { tries: tries, strategy: STRATEGY };
  if (SPEED) {
    var chips = [].slice.call(document.querySelectorAll('.table-toolbar .chip'));
    var hit = chips.find(function (c) { return txt(c) === SPEED; });
    if (hit) hit.click();
    out.speed = SPEED;
    out.speedHit = Boolean(hit);
  }
  out.title = txt(document.querySelector('h1'));
  out.header = txt(document.querySelector('.page__header p'));
  out.seatNames = [].map.call(document.querySelectorAll('.seat__name'), txt);
  out.seatCount = document.querySelectorAll('.seat').length;
  out.dealerBadge = txt(document.querySelector('.seat__badge--dealer'));
  out.badges = [].map.call(document.querySelectorAll('.seat__badge'), txt);
  out.heroCards = document.querySelectorAll('.seat--hero .card:not(.card--hidden)').length;
  out.hiddenCardsAtStart = document.querySelectorAll('.seat .card--hidden').length;
  out.boardSlots = document.querySelectorAll('.table-board .card').length;
  out.pot = txt(document.querySelector('.table-pot__value'));
  out.street = txt(document.querySelector('.street-badge'));
  out.logLines = document.querySelectorAll('.table-log li').length;
  out.ruleLines = document.querySelectorAll('.tax-note li').length;
  out.heroEquityPanel = txt(document.querySelector('.table-equity'));
  out.toolbarChips = [].map.call(document.querySelectorAll('.table-toolbar .chip'), txt);

  var buttons = [].slice.call(document.querySelectorAll('.table-button'));
  out.firstButtons = [].map.call(buttons, function (b) { return txt(b); });
  out.firstButtonsAllIn = buttons.some(function (b) {
    return b.classList.contains('table-button--allin');
  });

  out.potOddsHint = txt(document.querySelector('.table-actions .muted.small'));
  var seatsEl = document.querySelector('.seats');
  var heroCard = document.querySelector('.seat--hero .card');
  var heroSeat = document.querySelector('.seat--hero');
  var btn = document.querySelector('.table-button') || document.querySelector('.table-actions .actions .button');
  out.layout = {
    seatColumns: seatsEl ? getComputedStyle(seatsEl).gridTemplateColumns : null,
    heroSeatWidth: heroSeat ? Math.round(heroSeat.getBoundingClientRect().width) : null,
    boardCardWidth: heroCard ? Math.round(heroCard.getBoundingClientRect().width) : null,
    buttonWidth: btn ? Math.round(btn.getBoundingClientRect().width) : null,
    buttonFontSize: btn ? getComputedStyle(btn).fontSize : null,
  };

  out.overflowX = document.documentElement.scrollWidth > window.innerWidth;
  out.bodyScrollWidth = document.documentElement.scrollWidth;
  out.innerWidth = window.innerWidth;
  out.boardCardSize = (function () {
    var el = document.querySelector('.table-board .card');
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return [Math.round(r.width), Math.round(r.height)];
  })();
  // 开关状态要能落到 localStorage（下次打开还是这个设置）。
  var revealSwitch = document.querySelector('.table-switch--reveal input');
  var equitySwitch = document.querySelector('.table-switch--equity input');
  out.botCardsHiddenBefore = document.querySelectorAll('.seat .card--hidden').length;
  if (revealSwitch) {
    revealSwitch.click();
    await sleep(60);
    out.revealStored = window.localStorage.getItem('flop-trainer:table-reveal');
    out.botCardsHiddenAfterReveal = document.querySelectorAll('.seat .card--hidden').length;
    revealSwitch.click();
    await sleep(60);
    out.revealStoredBack = window.localStorage.getItem('flop-trainer:table-reveal');
  }
  if (equitySwitch) {
    equitySwitch.click();
    await sleep(60);
    out.equityPanelAfterOff = Boolean(document.querySelector('.table-equity'));
    equitySwitch.click();
    await sleep(60);
    out.equityStored = window.localStorage.getItem('flop-trainer:table-equity');
  }
  var fastChip = [].slice
    .call(document.querySelectorAll('.table-toolbar .chip'))
    .find(function (c) { return txt(c) === '快'; });
  if (fastChip) {
    fastChip.click();
    await sleep(60);
    out.delayStored = window.localStorage.getItem('flop-trainer:table-delay');
    var normalChip = [].slice
      .call(document.querySelectorAll('.table-toolbar .chip'))
      .find(function (c) { return txt(c) === '正常'; });
    if (normalChip) normalChip.click();
  }
  out.headerLinks = [].map.call(
    document.querySelectorAll('.page__header-actions a'),
    function (a) { return txt(a) + '→' + a.getAttribute('href'); },
  );
  out.preflopHint = txt(document.querySelector('.table-actions .actions .muted.small'));
  if (ONCE) { out.errors = errors; return finish(out); }

  var chips = chipSum();
  var injections = 0;
  var losses = 0;
  var handsPlayed = 0;
  var preflopAllInButtons = 0;
  var allInClicks = 0;
  var folds = 0;
  var hints = [];
  var maxPot = 0;
  var maxSeats = 0;
  var samples = [];
  var sawFlop = 0, sawTurn = 0, sawRiver = 0, sawShowdown = 0;

  for (var step = 0; step < 20000; step += 1) {
    var live = [].slice.call(document.querySelectorAll('.table-button'));
    if (live.length > 0) {
      var street = txt(document.querySelector('.table-pot .street-badge'));
      var allinButton = live.find(function (b) {
        return b.classList.contains('table-button--allin');
      });
      if (allinButton && street === '翻牌前') preflopAllInButtons += 1;
      if (street === '翻牌圈') sawFlop += 1;
      else if (street === '转牌圈') sawTurn += 1;
      else if (street === '河牌圈') sawRiver += 1;
      var pick = null;
      var byClass = function (name) {
        return live.find(function (b) { return b.classList.contains('table-button--' + name); });
      };
      if (STRATEGY === 'fold') pick = byClass('fold');
      else if (STRATEGY === 'allin') {
        pick = allinButton || byClass('call') || byClass('check') || byClass('fold');
        if (pick === allinButton) allInClicks += 1;
      } else if (STRATEGY === 'random') {
        // 随机打法：把合法动作全点一遍，专门用来撞崩溃与非法状态。
        pick = live[Math.floor(Math.random() * live.length)];
        if (pick === allinButton) allInClicks += 1;
        if (pick && pick.classList.contains('table-button--fold')) folds += 1;
      } else pick = byClass('check') || byClass('call') || byClass('fold');
      var hint = txt(document.querySelector('.table-actions .actions .muted.small'));
      if (hint && hints.indexOf(street + ' | ' + hint) < 0) hints.push(street + ' | ' + hint);
      if (samples.length < 6) {
        samples.push(street + ' | ' + [].map.call(live, txt).join(' / ') + ' → ' + txt(pick));
      }
      pick.click();
      await sleep(20);
    } else {
      var nextButton = [].slice
        .call(document.querySelectorAll('.table-actions .actions .button'))
        .find(function (b) { return txt(b).indexOf('下一手') >= 0; });
      if (nextButton) {
        handsPlayed += 1;
        if (txt(document.querySelector('.seat__hand'))) sawShowdown += 1;
        if (handsPlayed >= HANDS) break;
        nextButton.click();
        await sleep(30);
      } else {
        await sleep(40);
      }
    }
    var now = chipSum();
    if (now < chips) losses += chips - now;
    if (now > chips) injections += now - chips;
    chips = now;
    maxPot = Math.max(maxPot, Number(txt(document.querySelector('.table-pot__value'))) || 0);
    maxSeats = Math.max(maxSeats, document.querySelectorAll('.seat').length);
  }

  out.handsPlayed = handsPlayed;
  out.folds = folds;
  out.hints = hints.slice(0, 4);
  out.maxPot = maxPot;
  out.maxSeats = maxSeats;
  out.finalSeats = document.querySelectorAll('.seat').length;
  out.marker = 'done';
  out.samples = samples;
  out.preflopAllInButtons = preflopAllInButtons;
  out.allInClicks = allInClicks;
  out.sawFlop = sawFlop > 0;
  out.sawTurn = sawTurn > 0;
  out.sawRiver = sawRiver > 0;
  out.sawShowdown = sawShowdown;
  out.injections = injections;
  out.losses = losses;
  out.finalChips = chips;
  out.finalSeatStacks = [].map.call(document.querySelectorAll('.seat__stack-value'), function (el) {
    return Number(txt(el));
  });
  out.finalHand = txt(document.querySelector('.table-actions h2'));
  out.finalAwards = [].map.call(document.querySelectorAll('.table-awards li'), txt);
  out.finalSummary = txt(document.querySelector('.table-result__summary'));
  out.finalDeltas = [].map.call(document.querySelectorAll('.seat__delta'), txt);
  out.revealedCards = document.querySelectorAll('.seat:not(.seat--folded) .card:not(.card--hidden)').length;
  out.logTail = [].slice.call(document.querySelectorAll('.table-log li'), 0, 8).map(txt);
  out.overflowX = document.documentElement.scrollWidth > window.innerWidth;
  out.bodyScrollWidth = document.documentElement.scrollWidth;
  out.innerWidth = window.innerWidth;
  out.errors = errors;
  finish(out);
})();
</script>
`;

const target = path.join(tmpdir(), `smoke-table-${Date.now()}.html`);
writeFileSync(target, html.replace('<div id="root"></div>', `<div id="root"></div>${driver}`), 'utf8');

const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const url = 'file:///' + target.split(path.sep).join('/');
const dump = execFileSync(
  chrome,
  [
    '--headless=new',
    '--disable-gpu',
    `--window-size=${winW},${winH}`,
    '--virtual-time-budget=600000',
    '--allow-file-access-from-files',
    '--dump-dom',
    url,
  ],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);

const match = dump.match(/<pre id="smoke-table">([\s\S]*?)<\/pre>/);
if (!match) {
  console.log('NO MARKER');
  console.log(dump.slice(-4000));
  process.exit(1);
}
console.log(
  match[1]
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"'),
);
