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
    blurb: '打法稳重，只玩顺手的好牌；有牌时爱下小注探路，极少轻易梭哈。',
    tightness: 0.05,
    aggression: 0.38,
    bluff: 0.03,
    semiBluff: 0.30,
    trap: 0.35,
    callDown: 0.35,
    threeBet: 0.15,
    cbet: 0.40,
    checkRaise: 0.15,
    sizing: 0.25,
    spaz: 0.005,
  },
  {
    key: 'loose-aggressive',
    name: '小李',
    label: '活泼',
    blurb: '打牌活跃，喜欢多看翻牌，经常下 5 或 10 试探，偶尔诈唬但绝不无脑送死。',
    tightness: -0.05,
    aggression: 0.45,
    bluff: 0.10,
    semiBluff: 0.45,
    trap: 0.20,
    callDown: 0.40,
    threeBet: 0.20,
    cbet: 0.45,
    checkRaise: 0.20,
    sizing: 0.35,
    spaz: 0.02,
  },
  {
    key: 'balanced',
    name: '阿明',
    label: '随和',
    blurb: '典型的休闲朋友风格：平跟看牌、友好过牌、中牌就跟注或下个小注娱乐。',
    tightness: 0.0,
    aggression: 0.30,
    bluff: 0.05,
    semiBluff: 0.25,
    trap: 0.25,
    callDown: 0.45,
    threeBet: 0.10,
    cbet: 0.35,
    checkRaise: 0.10,
    sizing: 0.20,
    spaz: 0.01,
  },
  {
    key: 'calling-station',
    name: '王姐',
    label: '爱跟',
    blurb: '喜欢凑热闹看牌，只要手上有张小对子就一路跟到底，基本不主动下重注。',
    tightness: -0.06,
    aggression: 0.12,
    bluff: 0.01,
    semiBluff: 0.08,
    trap: 0.15,
    callDown: 0.85,
    threeBet: 0.02,
    cbet: 0.15,
    checkRaise: 0.05,
    sizing: 0.15,
    spaz: 0.01,
  },
  {
    key: 'rock',
    name: '老陈',
    label: '老实',
    blurb: '谨小慎微，没有把握绝不乱加注，经常过牌或便宜看牌，极少冒险。',
    tightness: 0.12,
    aggression: 0.25,
    bluff: 0.01,
    semiBluff: 0.10,
    trap: 0.40,
    callDown: 0.30,
    threeBet: 0.08,
    cbet: 0.30,
    checkRaise: 0.10,
    sizing: 0.20,
    spaz: 0.002,
  },
  {
    key: 'casual',
    name: '小赵',
    label: '随性',
    blurb: '随性打牌，爱过牌控池，喜欢花小筹码看河牌，绝不轻易推全下。',
    tightness: -0.02,
    aggression: 0.32,
    bluff: 0.06,
    semiBluff: 0.28,
    trap: 0.25,
    callDown: 0.50,
    threeBet: 0.12,
    cbet: 0.32,
    checkRaise: 0.12,
    sizing: 0.22,
    spaz: 0.01,
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
