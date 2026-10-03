# 德州翻牌圈相对牌力概率训练器

一个纯前端训练器：看到自己的 2 张底牌 + 3 张翻牌后，快速判断

- 哪些牌型能压过我
- 各牌型的大致概率
- 同牌型中比我大的概率
- 具体是什么起手牌（A8 / A3 / 83 …）
- 各有多少组合

> 本版默认对手从剩余 47 张未知牌中**完全随机**获得 2 张牌，共 `C(47,2)=1081` 个等权组合。
> 所有概率都由这 1081 个组合精确枚举得出，**没有任何硬编码**。

项目位于 `poker-trainer/` 子目录，与仓库里原有的菜谱应用完全独立。

---

## 1. 项目目录结构

```text
poker-trainer/
  index.html
  flop-trainer.html            # 打包产物：离线单文件
  package.json
  tsconfig.json
  vite.config.ts
  vite.config.single.ts        # 单文件打包专用构建配置
  scripts/
    inspect.ts                 # 手动打印 Fixture 分析结果
    build-single.mjs           # 生成单文件 HTML
    _smoke.mjs                 # headless Chrome 渲染冒烟测试
  src/
    poker/                     # 纯扑克数学，不依赖 React
      cards.ts                 # 牌、牌堆、剩余牌、场景校验
      evaluator.ts             # 五张牌评价 + 牌型枚举/中文标签
      compare.ts               # 同类别 / 跨类别比较
      combinations.ts          # 枚举 C(47,2)=1081
      grouping.ts              # A8 / 88 / KQ 点数类型聚合
      analyzer.ts              # 核心分析 + 聚合
      draws.ts                 # 后续听牌：转牌 / 河牌补成概率
      randomScenario.ts        # 随机出题
    trainer/
      types.ts                 # 答案、统计、阶段类型
      ranges.ts                # 概率区间 [min,max) 与格式化
      scoring.ts               # 评分与统计更新
    components/
      Card.tsx                 # 牌面显示（红/黑）
      Board.tsx                # Hero + Flop
      HandTypeSelector.tsx     # 牌型多选
      ProbabilityRangeSelector.tsx
      ResultBreakdown.tsx      # 结果页
      ComboDetails.tsx         # 点数类型展开具体花色
      DrawAnalysisPanel.tsx    # 后续听牌面板（结果页内，懒计算）
      ProbabilityText.tsx      # 醒目的百分比 / 组合数徽标
    pages/
      TrainerPage.tsx          # 训练主流程
      DebugPage.tsx            # 仅开发模式：1081 组合枚举查看
    App.tsx
    main.tsx
    styles.css
  tests/
    evaluator.test.ts
    compare.test.ts
    combinations.test.ts
    analyzer.test.ts
    draws.test.ts
    fixtures.test.ts
    ranges.test.ts
    helpers.ts
```

---

## 2. 核心数据结构

```ts
type Rank = '2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'T'|'J'|'Q'|'K'|'A';
type Suit = 's' | 'h' | 'd' | 'c';

interface Card { rank: Rank; suit: Suit; }

interface FlopScenario {
  hero: [Card, Card];
  flop: [Card, Card, Card];
}

enum HandCategory {
  HighCard = 0, OnePair = 1, TwoPair = 2, Trips = 3,
  Straight = 4, Flush = 5, FullHouse = 6, Quads = 7, StraightFlush = 8,
}

interface HandValue {
  category: HandCategory;
  tiebreak: number[]; // 从重要到次要
}
```

`HandValue` 示例：

| 牌面 | category | tiebreak |
| --- | --- | --- |
| `A♠ A♥ K♦ 8♣ 3♦` | `OnePair` | `[14, 13, 8, 3]`（A 对，K/8/3 踢脚） |
| `A♠ A♥ K♦ K♣ Q♦` | `TwoPair` | `[14, 13, 12]` |
| `A♥ 2♠ 3♦ 4♣ 5♥` | `Straight` | `[5]`（5 高顺，A 当 1） |

分析结果：

```ts
interface FlopAnalysis {
  heroHandValue: HandValue;
  totalOpponentCombos: number;        // 恒为 1081
  aheadCount: number; tieCount: number; behindCount: number;
  aheadProbability: number; tieProbability: number; behindProbability: number;
  byCategory: CategoryAnalysis[];     // 9 个牌型
  sameCategory: SameCategoryAnalysis;
  results: OpponentHandResult[];      // 1081 条明细（调试用）
}
```

---

## 3. 核心算法

`analyzeFlopScenario(scenario)` 完全按需求伪代码实现：

```text
52 张牌
  -> 移除 5 张已知牌（Hero 2 + Flop 3）= 47 张
  -> 枚举 C(47,2) = 1081 个对手组合
  -> 对每个组合 evaluateFiveCards([对手2张 + Flop3张])
  -> compareHandValues(对手, Hero)
  -> 聚合成 ahead / tie / behind
  -> 按 9 个牌型聚合，再按类型聚合：常规牌型用底牌点数（A8 / 83），一对用成对点数并区分「配对公共牌 / 口袋对」，同花用高张
  -> 同一牌型内概率完全相同的类型再合并成一行，行名列出全部成员（如「配对公共牌 K / 9 / 6」「8 / 7高同花」）
  -> 同牌型单独聚合，使用条件概率分母 totalCount
```

关键点：

- **A2345 = 5 高顺子**（A 当 1），已覆盖普通顺子与同花顺。
- **同牌型也可能压过 Hero**：训练器判定“能否压过”依据 `category.aheadCount > 0`，而不是 `category > hero.category`。
- 两种概率严格区分：
  - 占全部随机手牌：`aheadCount / 1081`
  - 同牌型条件下领先：`sameCategory.aheadCount / sameCategory.totalCount`
- 概率区间为 `[min, max)`，最后一个区间包含 100%，没有重叠。

### Fixture 输出（手工核对）

`scripts/inspect.ts` 对 `A♠K♦ / A♥8♣3♦` 的实际输出：

```text
Hero: 一对A，K83踢脚
总体: 领先 28 / 平手 6 / 落后 1047 = 1081
概率: 2.59% / 0.56% / 96.85%

能压过 Hero 的牌型:
  两对: 21 组合 (1.94%)
    83: 9 组合 (0.83%)
    A8: 6 组合 (0.56%)
    A3: 6 组合 (0.56%)
  三条: 7 组合 (0.65%)
    88: 3 组合 (0.28%)
    33: 3 组合 (0.28%)
    AA: 1 组合 (0.09%)

同牌型:
  一对 总数 369
  比你大 0 (0.00%) / 平手 6 / 比你小 363
```

- 两对合计 `21 = A8(6) + A3(6) + 83(9)`，与需求第 54~57 条完全一致。
- Blocker 由算法动态计算：剩余 A=2、8=3、3=3，故 A8=2×3=6、A3=2×3=6、83=3×3=9。

### 后续听牌分析（`src/poker/draws.ts`）

回答“我这手听牌到底能补成多少”与“对手拿到听牌并补成的概率有多大”。同样是**精确枚举**，不用蒙特卡洛。

```text
已知 5 张牌（Hero 2 + Flop 3）
  -> 先判断“现在还没有成型”的听牌目标（顺子 / 同花）
  -> 转牌：池子里每张牌逐个试，数出真正能补成的张数 = outs
  -> 河牌：枚举 C(47,2)=1081 个（转牌+河牌）组合，数出能补成的组合数
  -> 转牌 0 张补牌但河牌能补成 => 后门听牌（需要连来两张）
```

关键点：

- **判断“补成”用的是花色张数 / 点数位掩码，不是牌型比较**：葫芦、四条并不包含同花，所以不能用“牌型 ≥ 同花”来判断；顺子同理（预计算 8192 项 `STRAIGHT_MASK_TABLE`，含 A2345 轮子）。
- **只把“现在还没成型”的目标当听牌**：同花听牌要求当前同花色恰好 4 张，顺子听牌要求再加 1 张就能连成 5 张。已成型的牌型不会被当成听牌。
- **Hero 侧分母**：转牌 `47`，河牌 `C(47,2)=1081`（与对手组合数同为 1081，但含义不同）。
- **对手侧分母**：对手手里那 2 张不会再作为后续公共牌，所以牌池只有 `45` 张，转牌 `45`、河牌 `C(45,2)=990`。
- **顺子听牌按补牌点数分类**：1 个点数 = 卡顺（4 张）、2 个点数 = 两头顺（8 张）、≥3 个点数 = 多卡口。
- **对手侧每类听牌的组合数是重叠的**（同一个组合可能既是同花听牌又是顺子听牌），所以额外给出一条不重叠的三分法：`有立即听牌 + 只有后门听牌 + 完全没有听牌 = 1081`。

经典数字（全部由枚举得出，测试里逐一锁定）：

| 听牌 | 补牌 | 转牌补成 | 到河牌补成 |
| --- | --- | --- | --- |
| 同花听牌（4 张同花） | 9 | `9/47 = 19.15%` | `378/1081 = 34.97%` |
| 两头顺（8 张补牌） | 8 | `8/47 = 17.02%` | `340/1081 = 31.45%` |
| 卡顺（4 张补牌） | 4 | `4/47 = 8.51%` | `178/1081 = 16.47%` |
| 后门同花（3 张同花） | 0 | `0%` | `C(10,2)=45/1081 = 4.16%` |

---

## 4. 训练页面流程

1. **显示牌面**：Hero 两张、Flop 三张，并显示 Hero 当前牌型（不泄露概率）。
2. **选择压制牌型**：8 个成牌型多选（一对及以上，不含「高牌」）；同牌型更大的组合也算正确。
3. **确认牌型**后，对每个已选牌型选择「该牌型且压过你」的概率区间（分母 1081）。
4. **同牌型判断**：在“对手与 Hero 同牌型”的条件下，选择「比你大」的概率区间（分母为同牌型总数）。仅当 Hero 是成牌时才出现；Hero 是高牌时本题跳过（题量变为 2 步，直接提交）。
5. **提交并揭晓**：展示总体、各牌型明细、点数类型与具体花色组合、同牌型明细，以及**后续听牌分析**。
6. 顶部统计：牌型判断正确率、概率区间正确率、同牌型判断正确率、连续正确次数。

### 后续听牌面板

结果页底部有「后续听牌（转牌 / 河牌）」面板，分两块：

- **你的听牌**：每个听牌一行，列出补牌点数与具体补牌（如 `2♠ 6♠ …`），以及「转牌 `n/47`」「到河牌 `n/1081`」两种成牌概率；后门听牌会打上「后门 · 转牌补不成，需连来两张」标签；多于一种听牌时再给一行「至少补成一种听牌」的并集。
- **对手的听牌**：先给不重叠的三分法（有立即听牌 / 只有后门听牌 / 完全没有听牌），再按听牌类型列组合数与占比，以及「转牌补成（平均）」「到河牌补成（平均）」「拿到且补成」三个指标；最后一行为标题数字——「随机对手拿到听牌并在河牌前补成」的概率（括号内是只看“有听牌”时的条件概率）。

颜色约定：**红色 = 该类听牌占全部 1081 个组合；蓝色 = 拿到该类听牌后的平均补成率；紫色 = 对手拿到该类听牌且到河牌真的补成**。

这一面板只在结果页渲染（由 `ResultBreakdown` 挂载），做题时不会触发枚举，因此**不会拖慢答题**。同花听牌行会带花色（如「同花听牌 ♠」）。

### 直接看答案开关

右上角有「**直接看答案**」开关（选择会记入 localStorage）：

- **打开时**：跳过第 2~4 步，直接按未作答方式渲染结果页（隐藏所有「你的估计 / ✓ 正确 / ✗ 错误」等内容），也**不计入任何统计**。
- 打开状态下点「下一题」仍是直接看答案，只是换一组牌。
- **关掉时**：回到当前这题的选择流程，之前已填的答案仍在，可继续作答。

答案在提交前完全不显示；结果页每次展开的花色组合都来自实际枚举。

---

## 5. 测试运行方式

```bash
cd poker-trainer
npm install
npm test            # 等价于 vitest run
npm run test:watch  # 监听模式
```

覆盖点：

- 52 张唯一牌、剩余 47 张、场景去重校验
- 9 种牌型识别、级别顺序、全部 Tie Break
- 作答只覆盖 8 种成牌（一对及以上）；`高牌` 不要求选择与猜概率，也不参与评分（结果页仍展示其精确数字）
- Hero 自己是高牌时，「同牌型」一题同样跳过（不计入统计，题量退化为 2 步）
- `AAK83 > AAQ83`、`AAKKQ > AAQQK`、相同两对比较踢脚
- `A2345` 为 5 高顺子且 `23456 > A2345`
- 完全平手返回 0
- 1081 组合无重复、无同一张牌重复、无 Blocker 泄漏
- 各类一致性：`ahead+tie+behind=1081`、牌型 ahead 之和 = 总 ahead、点数类型之和 = 牌型 ahead、同牌型三项之和 = 同牌型总数
- 概率区间边界 0 / 1% / 3% / 10% / 35% / 100% 无重叠（共 5 档：0～1%、1～3%、3～10%、10～35%、35～100%）
- Fixture：两对 21、A8=6、A3=6、83=9、三条 7
- 评分：高牌被排除在漏选/多选/满分判定之外，即使它能压过 Hero
- Property Test：随机 1000 个场景全部满足不变量

---

## 6. 本地启动方式与单文件打包

```bash
cd poker-trainer
npm install
npm run dev       # 开发服务器（开发模式下可见「调试」入口）
npm run build     # 类型检查 + 生产构建
npm run preview   # 预览生产构建
npm run build:single   # 打包成可随处分发的单文件 HTML
```

### 单文件 HTML（离线双击即可运行）

```bash
npm run build:single
```

执行后会生成：

```text
poker-trainer/flop-trainer.html
```

该文件特点：

- JS / CSS 全部内联，**没有任何外部资源请求，不依赖网络**
- 使用经典 `IIFE` 脚本并置于 `</body>` 之前，`file://` 直接双击即可运行
- 使用 Hash 路由，不需要 Web 服务器
- 体积约 306 KB，可直接拷贝到 U 盘 / 聊天工具 / 邮件分发
- 开发专属的 `/debug` 调试页不会出现在分发包中

打包过程由 `scripts/build-single.mjs` 完成：先用 `vite.config.single.ts` 构建单入口 IIFE，
再把 `app.css` 与 `app.js` 内联进 `index.html`。

用 headless Chrome 验证渲染结果（会打印结果页与听牌面板的真实文字）：

```bash
npm run build:single
npm run smoke                # 需要本机装有 Chrome
```

开发模式下访问 `/debug`（Hash 路由为 `#/debug`）：

- 输入 Hero / Flop（如 `As Kd`、`Ah 8c 3d`）
- 查看完整 1081 组合
- 按领先关系 / 牌型 / 点数类型筛选

手动打印分析：

```bash
npx vite-node scripts/inspect.ts
```

### 手机上访问（独立 GitHub Pages 站点）

本项目是一个**独立仓库 + 独立站点**，不依赖任何后端：

| 项目 | 值 |
| --- | --- |
| 仓库 | `https://github.com/leroy668/flop-trainer` |
| 线上地址 | `https://leroy668.github.io/flop-trainer/` |
| 发布方式 | GitHub Actions 自动构建单文件 HTML 并发布（`.github/workflows/deploy-pages.yml`） |
| 触发条件 | push 到 `main`，或在 Actions 页面手动 `workflow_dispatch` |

之所以能这么简单，是因为产物本身就是**自包含的单文件 HTML**：CSS / JS 全部内联、无任何外部请求，所以 CI 只需要把 `flop-trainer.html` 复制成 `index.html` 上传即可，不需要服务器、不需要数据库。

每次 push 到 `main` 时，工作流会依次：

1. `npm ci` 安装依赖
2. `npm test` 跑全部单元测试（数学结果不正确则**不会**发布）
3. `npm run build:single` 打包单文件
4. 复制为 `pages-dist/index.html` 并上传为 Pages 制品

本地手动验证（不发布）：

```bash
npm run build:single
# 直接双击 poker-trainer/flop-trainer.html 即可，与线上完全一致
```

补充说明：

- `flop-trainer.html`（仓库内）是**产出物快照**，方便直接从 GitHub 下载或转发
- 手机浏览器添加书签 / 添加到主屏幕后可当离线 App 使用

---

## 7. 已完成 / 未完成功能清单

### 已完成

- [x] 随机生成 Hero + Flop，无重复牌
- [x] 正确识别 Hero 五张牌牌力（含所有牌型与踢脚）
- [x] 生成剩余 47 张牌
- [x] 枚举准确的 1081 个对手组合
- [x] 每个组合的正确牌型与领先 / 平手 / 落后判定
- [x] 总体领先 / 平手 / 落后概率
- [x]「总体牌力」里的「领先牌型构成」每行同时给出两种概率：**红色 = 该牌型占全部 1081**，**蓝色 = 占该牌型总数**（即同牌型中比你大的比例），鼠标悬停可看到 `aheadCount / totalCount` 的具体分子分母
- [x] 按牌型统计领先组合数量
- [x] 依据 `aheadCount > 0` 判断哪些牌型实际能压过 Hero
- [x] 概率区间训练（`[min, max)`，无重叠）
- [x] 同牌型条件概率（正确的分母 `totalCount`）
- [x] 领先组合聚合为 A8 / A3 / 83 等点数类型
- [x]「一对」按成对点数分类（一对A / 一对K ...），并区分「配对公共牌」与「口袋对」
- [x]「同花」按高张分类为 **A高同花 / K高同花 …**（否则三张公共牌同花色时会拆成最多 45 行、每行仅 1 个组合）
- [x] **通用「同概率合并」**：同一牌型内概率（组合数）完全相同的类型合并成一行，行名仍列出全部成员，所以不丢信息
  - 一对：「配对公共牌 K / 9 / 6」= 342 个、「口袋对 A / J / T / 8 / 5 / 4 / 3 / 2」= 48 个；概率不同的各自成行（如「口袋对 Q / 7」= 6 个）
  - 同花：「8 / 7高同花」= 4 个（各 2 个）；「A高同花」= 9 个单独一行
  - 两对：「75 / 74 / 54」= 27 个；三条：「77 / 55 / 44」= 9 个；同花顺：「86 / 63」；高牌：「AK / AQ」
  - 合并只在同一二级分类内进行（「配对公共牌」不会与「口袋对」混行），且必为排序后相邻行
  - 合并的行会额外给出一行独立的「单个」卡片（左侧橙色标条 + 淡黄底），内部把两个值分成两个胶囊便于区分：`单个组合数 [114 个组合]`（白底虚线、灰字）与 `单个占全部 [10.55%]`（**淡紫底 + 紫色字**）；在「同牌型内部」还会多一个 `单个占同牌型 [X%]`（淡蓝底 + 蓝色字）。因为同一行内每个成员概率相同，所以单个组合数 = 合计 ÷ 成员个数
  - 颜色约定：**红字 = 合计占全部**、**紫字 = 单个占全部**、**蓝字 = 占同牌型**（合计 / 单个用胶囊底色区分）
  - 未合并的行 memberCount = 1，它显示的合计概率本身就已经是单个概率
  - 「能压过你的牌型」与「同牌型内部」两个区域使用同一套规则
- [x] 显示每组组合数与占全部概率
- [x] 展开查看具体花色组合（动态 Blocker）
- [x] Fixture `A♠K♦ / A♥8♣3♦`：两对 21，其中 A8=6、A3=6、83=9
- [x] **后续听牌分析**（结果页，「后续听牌（转牌 / 河牌）」面板）：
  - [x] 自己的听牌：补牌点数与具体补牌、转牌 `n/47`、到河牌 `n/1081`、并集「至少补成一种」
  - [x] 后门听牌单独标记（转牌 0 张补牌）
  - [x] 对手的听牌：不重叠三分法（有立即听牌 / 只有后门 / 无听牌）+ 每类听牌的「组合数 / 占比 / 平均转牌补成率 / 平均到河牌补成率 / 拿到且补成」
  - [x] 标题数字：随机对手拿到听牌并在河牌前补成（含条件概率）
  - [x] 只在结果页懒计算，不影响答题速度
- [x] 核心算法全部有自动测试（149 个用例，含 1000 场景 Property Test 与「合并行内成员概率相同」随机 Property Test）
- [x] 提交前不泄露答案
- [x] 开发模式调试页
- [x] UI 全中文、红黑花色、移动端 / 桌面端适配
- [x] 不含任何下注策略
- [x] 单文件 HTML 离线打包（`flop-trainer.html`，双击即可运行，已用 headless Chrome 验证完整流程）

### 未完成（按需求明确延后）

- [ ] 题目分布控制 `generateScenario({ tags })`：已保留 `ScenarioTag` 与 `options` 扩展点，第一版纯随机
- [ ] 对手 Range / 加权概率（第二阶段）
- [ ] 转牌威胁训练（第三阶段，听牌概率已在结果页展示）
- [ ] 账号系统与持久化统计（第一版仅内存状态）
- [ ] GTO / EV / 底池赔率 / Position / SPR / Bluff / Range 推测
