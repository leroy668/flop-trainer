/**
 * 电脑玩家的「性格画像」（Bot Personas）。
 *
 * 每个人格就是一组生动的人类参数：
 * - 基础风格：紧凶 (TAG)、松凶 (LAG)、平衡策略 (Balanced)、跟注站 (Calling Station)、岩石 (Rock)、疯子 (Maniac)
 * - 战术倾向：起手牌松紧 (tightness)、进攻性 (aggression)、纯诈唬频率 (bluff)、
 *   听牌半诈唬 (semiBluff)、慢打伏击 (trap)、跟注抓诈倾向 (callDown)、3-Bet 反加注 (threeBet)、
 *   翻前进攻方持续下注 (cbet)、过牌-加注倾向 (checkRaise)、下注尺度偏好 (sizing)、偶尔抽风乱来 (spaz)
 *
 * 每个座位拿到哪个人格由 `personaSeed` 做轮转，保证同一桌的性格各不相同且完全可复现。
 */

export interface BotPersona {
  key: string;
  /** 中文昵称，界面直接显示，例如「老张」。 */
  name: string;
  /** 风格标签，例如「紧凶」。 */
  label: string;
  /** 一句话风格与战术说明。 */
  blurb: string;
  /** 起手牌门槛修正：正数 = 更紧，负数 = 更松。 */
  tightness: number;
  /** 进攻性 0~1：越高越爱主动下注 / 加注。 */
  aggression: number;
  /** 没牌时的纯偷鸡概率。 */
  bluff: number;
  /** 手握听牌（同花/顺子听牌）时的半诈唬下注/加注倾向。 */
  semiBluff: number;
  /** 拿到大牌时慢打（过牌 / 跟注设伏）的概率。 */
  trap: number;
  /** 跟注站程度 0~1：越高越不愿意弃牌，越爱抓诈唬。 */
  callDown: number;
  /** 翻牌前 3-Bet 反加注倾向。 */
  threeBet: number;
  /** 翻前作为进攻方时，在翻牌圈进行持续下注 (C-Bet) 的倾向。 */
  cbet: number;
  /** 面对下注时的过牌-加注 (Check-Raise) 倾向。 */
  checkRaise: number;
  /** 下注尺度偏好 0~1：0 = 爱小注 (5)，1 = 爱顶格大注 (20)。 */
  sizing: number;
  /** 偶尔乱来的概率：人类的不确定性与情绪波动。 */
  spaz: number;
}

export const BOT_PERSONAS: readonly BotPersona[] = [
  {
    key: 'tight-aggressive',
    name: '老张',
    label: '紧凶',
    blurb: '只玩优质好牌；一旦动手就坚决施压，有牌就下重注，绝不给对手免费看牌。',
    tightness: 0.08,
    aggression: 0.68,
    bluff: 0.05,
    semiBluff: 0.58,
    trap: 0.24,
    callDown: 0.18,
    threeBet: 0.42,
    cbet: 0.74,
    checkRaise: 0.32,
    sizing: 0.65,
    spaz: 0.01,
  },
  {
    key: 'loose-aggressive',
    name: '小李',
    label: '松凶',
    blurb: '进池范围极宽，善用位置施压；翻牌后高频连开两枪，极爱用听牌大额半诈唬。',
    tightness: -0.06,
    aggression: 0.86,
    bluff: 0.22,
    semiBluff: 0.80,
    trap: 0.10,
    callDown: 0.28,
    threeBet: 0.58,
    cbet: 0.84,
    checkRaise: 0.46,
    sizing: 0.82,
    spaz: 0.06,
  },
  {
    key: 'balanced',
    name: '阿明',
    label: '平衡',
    blurb: '严格按底池赔率与胜率期望办事；攻守平衡，该控池控池，该价值下注绝不手软。',
    tightness: 0.0,
    aggression: 0.60,
    bluff: 0.09,
    semiBluff: 0.50,
    trap: 0.18,
    callDown: 0.22,
    threeBet: 0.40,
    cbet: 0.64,
    checkRaise: 0.28,
    sizing: 0.52,
    spaz: 0.02,
  },
  {
    key: 'calling-station',
    name: '王姐',
    label: '跟注站',
    blurb: '特别喜欢看翻牌，中点什么底对都不舍得弃；极少主动进攻，最爱一路跟注到摊牌。',
    tightness: -0.04,
    aggression: 0.18,
    bluff: 0.02,
    semiBluff: 0.12,
    trap: 0.05,
    callDown: 0.80,
    threeBet: 0.06,
    cbet: 0.26,
    checkRaise: 0.05,
    sizing: 0.30,
    spaz: 0.02,
  },
  {
    key: 'rock',
    name: '老陈',
    label: '岩石',
    blurb: '极端保守谨慎，坐半天等不到一手大牌绝不出手；一旦他主动加注，必定是真家伙！',
    tightness: 0.16,
    aggression: 0.45,
    bluff: 0.01,
    semiBluff: 0.15,
    trap: 0.42,
    callDown: 0.08,
    threeBet: 0.20,
    cbet: 0.48,
    checkRaise: 0.22,
    sizing: 0.78,
    spaz: 0.005,
  },
  {
    key: 'maniac',
    name: '小美',
    label: '疯子',
    blurb: '打法狂放难以预测：动辄顶格加注、空气牌狂推，偶尔拿到坚果又冷血慢打设伏。',
    tightness: -0.12,
    aggression: 0.94,
    bluff: 0.35,
    semiBluff: 0.85,
    trap: 0.08,
    callDown: 0.46,
    threeBet: 0.68,
    cbet: 0.90,
    checkRaise: 0.52,
    sizing: 0.92,
    spaz: 0.14,
  },
];

/** 座位拿到哪个人格：用 personaSeed 做一次轮转，保证同一桌的性格各不相同。 */
export function botPersona(seatIndex: number, personaSeed = 0): BotPersona {
  const shift =
    ((personaSeed % BOT_PERSONAS.length) + BOT_PERSONAS.length) %
    BOT_PERSONAS.length;
  const base = seatIndex <= 0 ? 0 : seatIndex - 1;
  return BOT_PERSONAS[(base + shift) % BOT_PERSONAS.length];
}

/* ------------------------------------------------------------------ */
/* 兼容旧接口：界面与旧代码调用                                        */
/* ------------------------------------------------------------------ */

export interface BotStyle {
  label: string;
  /** 跟注需要的额外胜率余量。 */
  callMargin: number;
  /** 主动加注所需的胜率。 */
  raiseThreshold: number;
  /** 没牌时偷鸡的概率。 */
  bluff: number;
}

/** 把人格换算成「跟注余量 / 加注门槛」，方便界面与旧代码使用。 */
export function personaStyle(persona: BotPersona): BotStyle {
  return {
    label: persona.label,
    callMargin: Math.max(0, 0.11 - persona.callDown * 0.14 + persona.tightness * 0.2),
    raiseThreshold: 0.78 - persona.aggression * 0.18,
    bluff: persona.bluff,
  };
}

export const BOT_STYLES: readonly BotStyle[] = BOT_PERSONAS.map(personaStyle);

export function botStyle(seatIndex: number, personaSeed = 0): BotStyle {
  return personaStyle(botPersona(seatIndex, personaSeed));
}

/** 给界面用的一句话说明：这个座位是什么性格、在用什么口径。 */
export function botProfile(seatIndex: number, personaSeed = 0): string {
  const persona = botPersona(seatIndex, personaSeed);
  const style = personaStyle(persona);
  return `${persona.label}·${persona.name}（跟注余量 ${(style.callMargin * 100).toFixed(0)}%、偷鸡 ${(style.bluff * 100).toFixed(0)}%）`;
}
