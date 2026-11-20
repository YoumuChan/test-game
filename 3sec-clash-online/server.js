'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocket, WebSocketServer } = require('ws');

const PLAN_MS = 15000;
const TICK_MS = 100;
const HITSTOP_MS = 150;
const PLAY_START_MS = 500;
const TURN_PAUSE_MS = 1000;
const ROUND_PAUSE_MS = 3500;
const DIFFICULTIES = new Set(['easy', 'normal', 'hard']);

const CARDS = [
  { id: 1, name: '약공격', cat: 'atk', icon: '🗡️', s: 2, a: 2, r: 4, dmg: 15, short: 'DMG 15 · 빠른 기본 견제', desc: '데미지 15. 선딜이 짧아 안정적으로 상대의 느린 기술을 끊는 기본 견제기.' },
  { id: 2, name: '강공격', cat: 'atk', icon: '🪓', s: 5, a: 3, r: 6, dmg: 35, short: 'DMG 35 · 상쇄 돌파 가능', desc: '데미지 35. 약공격(15)과 동시 충돌 시 20 차이로 상쇄 돌파! 단, 카운터 피격 시 50 데미지를 입는다.' },
  { id: 3, name: '패링', cat: 'def', icon: '🛡️', s: 1, a: 4, r: 5, dmg: 0, short: '피해 무효 + 25 반격', desc: '판정 중 상대 공격 판정과 충돌 시 피해를 무효화하고 즉시 25 반격 데미지 + 상대 카드 취소 (PARRY!).' },
  { id: 4, name: '회피', cat: 'def', icon: '💨', s: 0, a: 5, r: 3, dmg: 0, short: '무적 · 성공 시 다음 선딜 -2', desc: '판정 중 모든 공격 무적 회피 (DODGE!). 회피에 1회 이상 성공하면 다음 내 슬롯 카드의 선딜을 2틱 감소(최소 0틱).' },
  { id: 5, name: '캔슬', cat: 'util', icon: '⏭️', s: 0, a: 1, r: 0, dmg: 0, short: '직전 후딜 삭제 → 즉시 연계', desc: '직전 슬롯 카드의 남은 후딜을 즉시 종료하고 다음 슬롯 카드를 바로 발동. (1번 슬롯 사용 시 1틱 대기)' },
  { id: 6, name: '잡기', cat: 'spec', icon: '⛓️', s: 3, a: 2, r: 5, dmg: 20, short: 'DMG 20 · 패링/회피 파괴 35', desc: '기본 데미지 20. 상대가 패링 또는 회피 판정 중일 때 적중 시 방어를 뚫고 35 고정 피해 + 3틱 경직 (GUARD BREAK!).' },
  { id: 7, name: '슈퍼아머', cat: 'spec', icon: '🦾', s: 4, a: 3, r: 5, dmg: 25, short: 'DMG 25 · 선딜 피격 무시 돌파', desc: '데미지 25. 선딜 도중 공격을 맞아도 데미지만 입을 뿐 카드가 취소되거나 경직되지 않고 끝까지 공격함 (ARMOR!).' },
  { id: 8, name: '페인트', cat: 'util', icon: '🎭', s: 1, a: 2, r: 1, dmg: 0, short: '패링 낚시 → 상대 후딜 +4', desc: '데미지 0. 판정 구간이 상대의 패링 판정과 겹치면 반격당하지 않고 상대의 남은 패링 후딜을 +4틱 증가시킴 (BAITED!).' },
  { id: 9, name: '가속', cat: 'util', icon: '⚡', s: 0, a: 2, r: 1, dmg: 0, short: '다음 카드 선딜 -2 / 후딜 -2', desc: '데미지 0. 바로 다음 슬롯 카드의 선딜과 후딜을 각각 2틱씩 감소시킴(최소 0틱).' },
  { id: 10, name: '처형', cat: 'atk', icon: '⚰️', s: 4, a: 2, r: 6, dmg: 20, short: 'DMG 20 · 3슬롯/20틱+ 시 45', desc: '기본 데미지 20. 3번 슬롯에 배치되었거나 20틱 이후에 판정이 시작되면 데미지가 45로 폭증(상쇄 돌파 가능).' },
  { id: 11, name: '잔상복사', cat: 'util', icon: '👥', s: 0, a: 1, r: 0, dmg: 0, short: '직전 카드 선딜 -1 재발동', desc: '직전 슬롯에 배치한 카드를 선딜 1틱 감소(최소 0틱)시킨 상태로 한 번 더 발동. (1번 슬롯이거나 직전 카드가 잔상복사면 1틱 대기)' },
  { id: 12, name: '혈투', cat: 'atk', icon: '🩸', s: 1, a: 2, r: 5, dmg: 30, short: '자해 10 · DMG 30 초속 강타', desc: '선딜 시작 첫 틱에 자신의 HP를 10 소모하고(최소 HP 1 유지), 적중 시 30 데미지.' },
  { id: 13, name: '초속찌르기', cat: 'atk', icon: '🏹', s: 1, a: 2, r: 7, dmg: 15, short: 'DMG 15 · 선딜 1틱 속공', desc: '데미지 15. 게임 내 유일한 무페널티 선딜 1틱 속공기.' },
  { id: 14, name: '연타', cat: 'atk', icon: '⚔️', s: 2, a: 4, r: 4, dmg: 20, short: '10×2타 · 패링 관통 가능', desc: '판정 첫 번째 틱과 세 번째 틱에 각각 10 데미지씩 총 2타 공격. 1타가 상대 패링에 막혀도 2타 판정이 이어져 패링을 뚫을 수 있음.' },
  { id: 15, name: '흡혈', cat: 'atk', icon: '🦇', s: 3, a: 3, r: 4, dmg: 15, short: 'DMG 15 · 적중 시 HP +15', desc: '데미지 15. 적중 시 내 HP 15 회복(최대 100).' },
  { id: 16, name: '일섬', cat: 'atk', icon: '⚡', s: 8, a: 3, r: 8, dmg: 55, short: 'DMG 55 · 초고화력 상쇄 돌파', desc: '데미지 55. 선딜이 길지만 적중 시 승부를 결정짓고 35 이하 공격과 정면 충돌 시 상쇄 돌파로 찍어 누르는 필살기.' },
  { id: 17, name: '역경', cat: 'spec', icon: '🔥', s: 3, a: 2, r: 5, dmg: 15, short: 'DMG 15 · 열세 시 선딜1/DMG30', desc: '기본 데미지 15. 카드 시작 시점의 내 HP가 상대 HP보다 낮으면 선딜이 1틱으로 줄고 데미지가 30으로 강화.' },
  { id: 18, name: '봉인', cat: 'spec', icon: '🔒', s: 2, a: 2, r: 4, dmg: 10, short: 'DMG 10 · 다음 유틸 불발+경직3', desc: '데미지 10. 적중 시 상대의 다음 슬롯 카드가 유틸 계열이면 강제 불발 처리 및 3틱 경직 (SEALED!).' },
  { id: 19, name: '시한부적', cat: 'spec', icon: '🧨', s: 1, a: 1, r: 2, dmg: 0, short: '10틱 뒤 25 폭발 (경직 시 취소)', desc: '데미지 0. 발동 후 정확히 10틱 뒤에 상대에게 자동으로 25 데미지 폭발 (BOMB!). 폭발 전에 시전자가 피격 경직을 당하면 취소.' },
  { id: 20, name: '철벽태세', cat: 'def', icon: '🏰', s: 2, a: 5, r: 3, dmg: 0, short: '방어 시 상대후딜+3 · 다음DMG+15', desc: '판정 중 공격 방어 시 반격 데미지 대신 상대 남은 후딜을 +3틱 증가시키고, 내 다음 슬롯 카드의 데미지를 +15 강화.' }
];

const CARD_MAP = {};
CARDS.forEach(c => { CARD_MAP[c.id] = c; });

const CAT_INFO = {
  atk: { label: '공격', color: '#ff4d4d' },
  def: { label: '방어', color: '#4da6ff' },
  util: { label: '유틸', color: '#4dff88' },
  spec: { label: '특수', color: '#b84dff' }
};

const ATTACK_IDS = new Set([1, 2, 6, 7, 10, 12, 13, 14, 15, 16, 17, 18]);

function createFighterState(side, cards, hp, energyBonus) {
  return {
    side,
    hp,
    slots: cards,
    slotIdx: -1,
    card: null,
    origCard: null,
    phase: 'idle',
    phaseTick: 0,
    sLen: 0,
    aLen: 0,
    rLen: 0,
    stunLen: 0,
    activeStartTick: 0,
    hasHit: false,
    hasTriggered: false,
    dmgBonus: 0,
    nextDmgBonus: energyBonus ? 5 : 0,
    nextStartupRed: energyBonus ? 1 : 0,
    nextRecoveryRed: 0,
    sealNextUtil: false,
    isDesperation: false,
    bombs: [],
    pendingStun: 0,
    pendingEndActive: false,
    needNextSlot: true,
    hitsLanded: 0,
    idleTicks: 0
  };
}

function startNextSlot(f, opp, tick, events) {
  f.needNextSlot = false;
  f.slotIdx++;
  if (f.slotIdx >= f.slots.length) {
    f.card = null;
    f.origCard = null;
    f.phase = 'idle';
    f.phaseTick = 0;
    return;
  }
  const baseCard = CARD_MAP[f.slots[f.slotIdx]];
  f.origCard = baseCard;

  if (f.sealNextUtil) {
    f.sealNextUtil = false;
    if (baseCard.cat === 'util') {
      f.card = baseCard;
      f.phase = 'stun';
      f.phaseTick = 0;
      f.stunLen = 3;
      f.hasHit = true;
      f.hasTriggered = true;
      if (events) events.push({ type: 'SEALED!', side: f.side, hitstop: true, color: '#c084fc' });
      return;
    }
  }

  let effCard = baseCard;
  let copyRed = 0;
  if (baseCard.id === 11) {
    if (f.slotIdx > 0 && f.slots[f.slotIdx - 1] !== 11) {
      effCard = CARD_MAP[f.slots[f.slotIdx - 1]];
      copyRed = 1;
    }
  }

  let sLen = effCard.s;
  let aLen = effCard.a;
  let rLen = effCard.r;
  f.isDesperation = false;
  if (effCard.id === 17 && f.hp < opp.hp) {
    sLen = 1;
    f.isDesperation = true;
  }

  sLen = Math.max(0, sLen - f.nextStartupRed - copyRed);
  rLen = Math.max(0, rLen - f.nextRecoveryRed);
  f.dmgBonus = f.nextDmgBonus;
  f.nextStartupRed = 0;
  f.nextRecoveryRed = 0;
  f.nextDmgBonus = 0;

  if (effCard.id === 12) {
    const selfCost = Math.min(10, Math.max(0, f.hp - 1));
    if (selfCost > 0) {
      f.hp -= selfCost;
      if (events) events.push({ type: 'BLOOD', side: f.side, dmg: selfCost, color: '#ff4d4d' });
    }
  }

  f.card = effCard;
  f.sLen = sLen;
  f.aLen = aLen;
  f.rLen = rLen;
  f.hasHit = false;
  f.hasTriggered = false;
  f.phaseTick = 0;

  if (sLen > 0) {
    f.phase = 'startup';
  } else if (aLen > 0) {
    f.phase = 'active';
    f.activeStartTick = tick;
  } else if (rLen > 0) {
    f.phase = 'recovery';
  } else {
    f.phase = 'idle';
  }
}

function isAttackActiveNow(f) {
  if (f.phase !== 'active' || !f.card) return false;
  if (!ATTACK_IDS.has(f.card.id)) return false;
  if (f.card.id === 14) {
    return f.phaseTick === 0 || f.phaseTick === 2;
  }
  return !f.hasHit;
}

function calcAttackDamage(att, def) {
  let dmg = att.card.dmg;
  if (att.card.id === 10) {
    dmg = (att.slotIdx === 2 || att.activeStartTick >= 20) ? 45 : 20;
  } else if (att.card.id === 14) {
    dmg = 10;
  } else if (att.card.id === 17) {
    dmg = att.isDesperation ? 30 : 15;
  }
  dmg += att.dmgBonus;
  const isCounter = def.phase === 'startup';
  if (isCounter && def.card && def.card.id === 2) {
    dmg = Math.max(50, dmg);
  }
  return { dmg, isCounter };
}

function simulateMatchup(p1Cards, p2Cards, p1Hp, p2Hp, p1Energy = false, p2Energy = false, recordLog = true) {
  const f1 = createFighterState(0, p1Cards, p1Hp, p1Energy);
  const f2 = createFighterState(1, p2Cards, p2Hp, p2Energy);
  const fighters = [f1, f2];
  const timeline = recordLog ? [] : null;
  let koTick = -1;

  for (let t = 0; t < 30; t++) {
    const events = recordLog ? [] : null;

    for (let s = 0; s < 2; s++) {
      const caster = fighters[s];
      const target = fighters[1 - s];
      if (caster.bombs.length > 0) {
        for (let bi = caster.bombs.length - 1; bi >= 0; bi--) {
          if (caster.bombs[bi].explodeTick === t) {
            caster.bombs.splice(bi, 1);
            target.hp = Math.max(0, target.hp - 25);
            caster.hitsLanded++;
            if (events) {
              events.push({ type: 'BOMB!', side: target.side, actor: caster.side, cardId: 19, dmg: 25, hitstop: true, color: '#f97316' });
            }
          }
        }
      }
    }

    if (f1.hp <= 0 || f2.hp <= 0) {
      koTick = t;
      if (recordLog) {
        events.push({ type: 'K.O.!', side: f1.hp <= 0 && f2.hp <= 0 ? -1 : (f1.hp <= 0 ? 0 : 1), hitstop: true, color: '#facc15' });
        timeline.push({
          tick: t,
          p1: { hp: f1.hp, phase: f1.phase, cardId: f1.card ? f1.card.id : 0, origId: f1.origCard ? f1.origCard.id : 0, slotIdx: f1.slotIdx, phaseTick: f1.phaseTick, bombs: f1.bombs.map(b => b.explodeTick - t) },
          p2: { hp: f2.hp, phase: f2.phase, cardId: f2.card ? f2.card.id : 0, origId: f2.origCard ? f2.origCard.id : 0, slotIdx: f2.slotIdx, phaseTick: f2.phaseTick, bombs: f2.bombs.map(b => b.explodeTick - t) },
          events
        });
      }
      break;
    }

    if (f1.needNextSlot) startNextSlot(f1, f2, t, events);
    if (f2.needNextSlot) startNextSlot(f2, f1, t, events);

    for (let s = 0; s < 2; s++) {
      const f = fighters[s];
      const opp = fighters[1 - s];
      if (f.phase === 'active' && f.card) {
        if (f.card.id === 9 && !f.hasTriggered) {
          f.hasTriggered = true;
          f.nextStartupRed += 2;
          f.nextRecoveryRed += 2;
          if (events) events.push({ type: 'HASTE', side: f.side, color: '#4dff88' });
        }
        if (f.card.id === 19 && !f.hasTriggered) {
          f.hasTriggered = true;
          f.bombs.push({ explodeTick: t + 10 });
          if (events) events.push({ type: 'TALISMAN', side: f.side, color: '#c084fc' });
        }
        if (f.card.id === 8 && !f.hasTriggered && opp.phase === 'active' && opp.card && opp.card.id === 3) {
          f.hasTriggered = true;
          opp.rLen += 4;
          if (events) events.push({ type: 'BAITED!', side: opp.side, actor: f.side, cardId: 8, hitstop: true, color: '#4dff88' });
        }
      }
    }

    const p1Atk = isAttackActiveNow(f1);
    const p2Atk = isAttackActiveNow(f2);

    const resolveSingleHit = (att, def, heavyClashOverride = false) => {
      const attCardId = att.card.id;
      const defParry = def.phase === 'active' && def.card && def.card.id === 3 && !def.hasTriggered;
      const defDodge = def.phase === 'active' && def.card && def.card.id === 4;
      const defIron = def.phase === 'active' && def.card && def.card.id === 20;

      if (att.card.id === 6 && (defParry || defDodge)) {
        att.hasHit = true;
        def.hp = Math.max(0, def.hp - 35);
        def.pendingStun = 3;
        if (def.bombs.length > 0) {
          def.bombs.length = 0;
          if (events) events.push({ type: 'BOMB CANCEL', side: def.side, color: '#94a3b8' });
        }
        att.hitsLanded++;
        if (events) events.push({ type: 'GUARD BREAK!', side: def.side, actor: att.side, cardId: attCardId, dmg: 35, hitstop: true, color: '#d946ef' });
        return;
      }

      if (defParry) {
        if (att.card.id === 14 && att.phaseTick === 0) {
          def.hasTriggered = true;
          def.pendingEndActive = true;
          if (events) events.push({ type: 'PARRY PIERCE', side: def.side, color: '#60a5fa' });
          return;
        }
        att.hasHit = true;
        def.hasTriggered = true;
        def.pendingEndActive = true;
        att.hp = Math.max(0, att.hp - 25);
        att.pendingStun = 2;
        if (att.bombs.length > 0) {
          att.bombs.length = 0;
          if (events) events.push({ type: 'BOMB CANCEL', side: att.side, color: '#94a3b8' });
        }
        def.hitsLanded++;
        if (events) events.push({ type: 'PARRY!', side: att.side, actor: def.side, cardId: 3, dmg: 25, hitstop: true, color: '#38bdf8' });
        return;
      }

      if (defDodge) {
        if (att.card.id !== 14) att.hasHit = true;
        if (!def.hasTriggered) {
          def.hasTriggered = true;
          def.nextStartupRed += 2;
        }
        if (events) events.push({ type: 'DODGE!', side: def.side, actor: def.side, cardId: 4, color: '#38bdf8' });
        return;
      }

      if (defIron) {
        if (att.card.id !== 14) att.hasHit = true;
        att.rLen += 3;
        if (att.card.id !== 14) att.pendingEndActive = true;
        if (!def.hasTriggered) {
          def.hasTriggered = true;
          def.nextDmgBonus += 15;
        }
        if (events) events.push({ type: 'IRON WALL!', side: def.side, actor: def.side, cardId: 20, hitstop: true, color: '#60a5fa' });
        return;
      }

      if (att.card.id !== 14) att.hasHit = true;
      const { dmg, isCounter } = calcAttackDamage(att, def);
      def.hp = Math.max(0, def.hp - dmg);
      att.hitsLanded++;

      if (att.card.id === 15) {
        const heal = Math.min(15, 100 - att.hp);
        att.hp += heal;
        if (events && heal > 0) events.push({ type: 'HEAL', side: att.side, dmg: heal, color: '#4dff88' });
      }
      if (att.card.id === 18) {
        def.sealNextUtil = true;
      }

      const defArmor = def.card && def.card.id === 7 && (def.phase === 'startup' || def.phase === 'active');
      if (defArmor && !heavyClashOverride) {
        if (events) events.push({ type: 'ARMOR!', side: def.side, actor: att.side, cardId: attCardId, dmg, hitstop: dmg >= 25, color: '#c084fc' });
      } else {
        def.pendingStun = Math.max(def.pendingStun, 2);
        if (def.bombs.length > 0) {
          def.bombs.length = 0;
          if (events) events.push({ type: 'BOMB CANCEL', side: def.side, color: '#94a3b8' });
        }
        if (events) {
          const evType = heavyClashOverride ? 'HEAVY CLASH!' : (isCounter ? 'COUNTER!' : 'HIT');
          events.push({
            type: evType,
            side: def.side,
            actor: att.side,
            cardId: attCardId,
            dmg,
            hitstop: heavyClashOverride || isCounter || dmg >= 25 || attCardId === 16,
            color: heavyClashOverride ? '#f97316' : (isCounter ? '#facc15' : '#ff4d4d')
          });
        }
      }
    };

    if (p1Atk && p2Atk) {
      const a1 = f1.card.id === 7;
      const a2 = f2.card.id === 7;
      if (!a1 && !a2) {
        const d1 = calcAttackDamage(f1, f2).dmg;
        const d2 = calcAttackDamage(f2, f1).dmg;
        if (d1 - d2 >= 20) {
          if (f2.card.id !== 14) f2.hasHit = true;
          resolveSingleHit(f1, f2, true);
        } else if (d2 - d1 >= 20) {
          if (f1.card.id !== 14) f1.hasHit = true;
          resolveSingleHit(f2, f1, true);
        } else {
          if (f1.card.id !== 14) f1.hasHit = true;
          if (f2.card.id !== 14) f2.hasHit = true;
          f1.pendingStun = 2;
          f2.pendingStun = 2;
          if (events) events.push({ type: 'CLASH!', side: -1, hitstop: true, color: '#facc15' });
        }
      } else {
        resolveSingleHit(f1, f2, false);
        resolveSingleHit(f2, f1, false);
      }
    } else if (p1Atk) {
      resolveSingleHit(f1, f2, false);
    } else if (p2Atk) {
      resolveSingleHit(f2, f1, false);
    }

    if (f1.phase === 'idle') f1.idleTicks++;
    if (f2.phase === 'idle') f2.idleTicks++;

    const koNow = f1.hp <= 0 || f2.hp <= 0;
    if (koNow) {
      koTick = t;
      if (events) {
        events.push({ type: 'K.O.!', side: f1.hp <= 0 && f2.hp <= 0 ? -1 : (f1.hp <= 0 ? 0 : 1), hitstop: true, color: '#facc15' });
      }
    }

    if (recordLog) {
      timeline.push({
        tick: t,
        p1: { hp: f1.hp, phase: f1.phase, cardId: f1.card ? f1.card.id : 0, origId: f1.origCard ? f1.origCard.id : 0, slotIdx: f1.slotIdx, phaseTick: f1.phaseTick, bombs: f1.bombs.map(b => b.explodeTick - t) },
        p2: { hp: f2.hp, phase: f2.phase, cardId: f2.card ? f2.card.id : 0, origId: f2.origCard ? f2.origCard.id : 0, slotIdx: f2.slotIdx, phaseTick: f2.phaseTick, bombs: f2.bombs.map(b => b.explodeTick - t) },
        events
      });
    }

    if (koNow) break;

    for (let s = 0; s < 2; s++) {
      const f = fighters[s];
      if (f.pendingStun > 0) {
        f.card = null;
        f.phase = 'stun';
        f.phaseTick = 0;
        f.stunLen = f.pendingStun;
        f.pendingStun = 0;
        f.pendingEndActive = false;
      } else if (f.pendingEndActive) {
        f.pendingEndActive = false;
        if (f.slotIdx + 1 < f.slots.length && f.slots[f.slotIdx + 1] === 5) {
          f.needNextSlot = true;
        } else if (f.rLen > 0) {
          f.phase = 'recovery';
          f.phaseTick = 0;
        } else {
          f.needNextSlot = true;
        }
      } else if (f.phase === 'startup') {
        f.phaseTick++;
        if (f.phaseTick >= f.sLen) {
          f.phase = 'active';
          f.phaseTick = 0;
          f.activeStartTick = t + 1;
        }
      } else if (f.phase === 'active') {
        f.phaseTick++;
        if (f.phaseTick >= f.aLen) {
          if (f.slotIdx + 1 < f.slots.length && f.slots[f.slotIdx + 1] === 5) {
            f.needNextSlot = true;
          } else if (f.rLen > 0) {
            f.phase = 'recovery';
            f.phaseTick = 0;
          } else {
            f.needNextSlot = true;
          }
        }
      } else if (f.phase === 'recovery') {
        f.phaseTick++;
        if (f.phaseTick >= f.rLen) {
          f.needNextSlot = true;
        }
      } else if (f.phase === 'stun') {
        f.phaseTick++;
        if (f.phaseTick >= f.stunLen) {
          f.needNextSlot = true;
        }
      }
    }
  }

  return {
    p1Hp: f1.hp,
    p2Hp: f2.hp,
    p1Hits: f1.hitsLanded,
    p2Hits: f2.hitsLanded,
    p1NextEnergy: f1.idleTicks >= 10,
    p2NextEnergy: f2.idleTicks >= 10,
    koTick,
    timeline
  };
}

function computePreviewTimeline(slots, myHp, oppHp, energyBonus) {
  const ticks = new Array(30).fill(null);
  const slotInfos = [];
  let t = 0;
  let nextSRed = energyBonus ? 1 : 0;
  let nextRRed = 0;
  let nextDmgBonus = energyBonus ? 5 : 0;

  for (let i = 0; i < slots.length; i++) {
    const base = CARD_MAP[slots[i]];
    let eff = base;
    let copyRed = 0;
    if (base.id === 11 && i > 0 && slots[i - 1] !== 11) {
      eff = CARD_MAP[slots[i - 1]];
      copyRed = 1;
    }
    let sLen = eff.s;
    let desp = false;
    if (eff.id === 17 && myHp < oppHp) {
      sLen = 1;
      desp = true;
    }
    sLen = Math.max(0, sLen - nextSRed - copyRed);
    let rLen = Math.max(0, eff.r - nextRRed);
    const dmgBonus = nextDmgBonus;
    nextSRed = 0;
    nextRRed = 0;
    nextDmgBonus = 0;

    if (eff.id === 9) {
      nextSRed += 2;
      nextRRed += 2;
    }
    const nextIsCancel = (i + 1 < slots.length && slots[i + 1] === 5);
    if (nextIsCancel) {
      rLen = 0;
    }

    const startTick = t;
    const activeStart = t + sLen;
    let effDmg = eff.dmg;
    if (eff.id === 10) effDmg = (i === 2 || activeStart >= 20) ? 45 : 20;
    else if (eff.id === 17) effDmg = desp ? 30 : 15;
    if (effDmg > 0) effDmg += dmgBonus;

    let overflow = startTick >= 30 || (activeStart + eff.a) > 30;
    slotInfos.push({
      slotIdx: i,
      sLen,
      aLen: eff.a,
      rLen,
      effDmg,
      overflow,
      modified: sLen !== base.s || rLen !== base.r || eff.id !== base.id || dmgBonus > 0
    });

    for (let k = 0; k < sLen; k++) {
      if (t < 30) ticks[t] = { phase: 'startup', slotIdx: i };
      t++;
    }
    for (let k = 0; k < eff.a; k++) {
      if (t < 30) ticks[t] = { phase: 'active', slotIdx: i };
      t++;
    }
    for (let k = 0; k < rLen; k++) {
      if (t < 30) ticks[t] = { phase: 'recovery', slotIdx: i };
      t++;
    }
  }

  return {
    ticks,
    slotInfos,
    totalTicks: t,
    idleTicks: Math.max(0, 30 - t),
    hasOverflow: slotInfos.some(x => x.overflow)
  };
}

class OpponentModel {
  constructor() {
    this.decay = 0.82;
    this.slotCardFreq = [{}, {}, {}];
    this.lenFreq = [0, 0.3, 0.4, 0.3];
    this.turnsObserved = 0;
  }
  reset() {
    this.slotCardFreq = [{}, {}, {}];
    this.lenFreq = [0, 0.3, 0.4, 0.3];
    this.turnsObserved = 0;
  }
  observe(p1Slots) {
    this.turnsObserved++;
    for (let s = 0; s < 3; s++) {
      const m = this.slotCardFreq[s];
      for (const k in m) m[k] *= this.decay;
    }
    for (let l = 1; l <= 3; l++) this.lenFreq[l] *= this.decay;
    if (p1Slots.length >= 1 && p1Slots.length <= 3) {
      this.lenFreq[p1Slots.length] += 1;
    }
    for (let i = 0; i < p1Slots.length; i++) {
      const id = p1Slots[i];
      this.slotCardFreq[i][id] = (this.slotCardFreq[i][id] || 0) + 1;
    }
  }
  predictDistribution(p1Perms) {
    const n = p1Perms.length;
    const weights = new Float64Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const seq = p1Perms[i];
      let w = 0.25 + (this.lenFreq[seq.length] || 0.2);
      for (let s = 0; s < seq.length; s++) {
        w *= (1 + (this.slotCardFreq[s][seq[s]] || 0) * 2.2);
      }
      weights[i] = w;
      sum += w;
    }
    if (sum <= 0) {
      weights.fill(1 / n);
    } else {
      for (let i = 0; i < n; i++) weights[i] /= sum;
    }
    return weights;
  }
}

function estimateMinStartOfLast(seq, myHp, oppHp) {
  let t = 0;
  let nextSRed = 0;
  let nextRRed = 0;
  for (let i = 0; i < seq.length - 1; i++) {
    let c = CARD_MAP[seq[i]];
    let copyRed = 0;
    if (c.id === 11 && i > 0 && seq[i - 1] !== 11) {
      c = CARD_MAP[seq[i - 1]];
      copyRed = 1;
    }
    let s = c.s;
    if (c.id === 17 && myHp < oppHp) s = 1;
    s = Math.max(0, s - nextSRed - copyRed);
    let r = Math.max(0, c.r - nextRRed);
    nextSRed = 0;
    nextRRed = 0;
    if (c.id === 9) { nextSRed += 2; nextRRed += 2; }
    if (c.id === 4) { nextSRed += 2; }
    const nextIsCancel = (i + 1 < seq.length && seq[i + 1] === 5);
    t += s + c.a + (nextIsCancel ? 0 : r);
  }
  return t;
}

function generateValidPerms(hand, myHp, oppHp) {
  const perms = [];
  const n = hand.length;
  for (let i = 0; i < n; i++) {
    perms.push([hand[i]]);
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const p2 = [hand[i], hand[j]];
      if (estimateMinStartOfLast(p2, myHp, oppHp) < 30) {
        perms.push(p2);
        for (let k = 0; k < n; k++) {
          if (k === i || k === j) continue;
          const p3 = [hand[i], hand[j], hand[k]];
          if (estimateMinStartOfLast(p3, myHp, oppHp) < 30) {
            perms.push(p3);
          }
        }
      }
    }
  }
  return perms;
}

function sampleFromProbs(probs) {
  let r = Math.random();
  for (let i = 0; i < probs.length; i++) {
    r -= probs[i];
    if (r <= 0) return i;
  }
  return probs.length - 1;
}

function chooseAIMove(aiHand, p1Hand, p1Hp, p2Hp, p1Energy, p2Energy, difficulty, oppModel) {
  const aiPerms = generateValidPerms(aiHand, p2Hp, p1Hp);
  if (difficulty === 'easy') {
    const simplePool = aiPerms.filter(p => p.length <= 2);
    const pool = (simplePool.length > 0 && Math.random() < 0.65) ? simplePool : aiPerms;
    return {
      cards: pool[Math.floor(Math.random() * pool.length)],
      meta: `쉬움 AI · 직관적 기본 수 선택 (${pool.length}개 후보)`
    };
  }

  const p1Perms = generateValidPerms(p1Hand, p1Hp, p2Hp);
  const nA = aiPerms.length;
  const nP = p1Perms.length;
  const payoff = new Float32Array(nA * nP);
  const killInfo = new Float32Array(nA);

  for (let i = 0; i < nA; i++) {
    const aiSeq = aiPerms[i];
    let quickKills = 0;
    for (let j = 0; j < nP; j++) {
      const res = simulateMatchup(p1Perms[j], aiSeq, p1Hp, p2Hp, p1Energy, p2Energy, false);
      const dmgToP1 = p1Hp - res.p1Hp;
      const dmgToP2 = p2Hp - res.p2Hp;
      let score = dmgToP1 - dmgToP2 + res.p2Hits * 4 + (res.p2NextEnergy ? 5 : 0);
      if (res.p1Hp <= 0 && res.p2Hp > 0) {
        score += 500 + (30 - res.koTick) * 6;
        quickKills += (30 - res.koTick) / 30;
      } else if (res.p2Hp <= 0 && res.p1Hp > 0) {
        score -= 500;
      }
      payoff[i * nP + j] = score;
    }
    killInfo[i] = quickKills / nP;
  }

  if (difficulty === 'normal') {
    const scored = [];
    for (let i = 0; i < nA; i++) {
      let sum = 0;
      const base = i * nP;
      for (let j = 0; j < nP; j++) sum += payoff[base + j];
      scored.push({ idx: i, avg: sum / nP });
    }
    scored.sort((a, b) => b.avg - a.avg);
    const topK = scored.slice(0, Math.min(4, scored.length));
    const weights = new Float64Array(topK.length);
    let wSum = 0;
    for (let i = 0; i < topK.length; i++) {
      const w = Math.exp((topK[i].avg - topK[0].avg) / 14);
      weights[i] = w;
      wSum += w;
    }
    for (let i = 0; i < weights.length; i++) weights[i] /= wSum;
    const pick = topK[sampleFromProbs(weights)];
    return {
      cards: aiPerms[pick.idx],
      meta: `보통 AI · ${nA}×${nP} 기댓값 균형 분석 완료`
    };
  }

  const regretA = new Float64Array(nA);
  const regretP = new Float64Array(nP);
  const stratSumA = new Float64Array(nA);
  const stratA = new Float64Array(nA);
  const stratP = new Float64Array(nP);
  const utilA = new Float64Array(nA);
  const utilP = new Float64Array(nP);
  const ITERS = 300;

  for (let iter = 0; iter < ITERS; iter++) {
    let sumA = 0;
    for (let i = 0; i < nA; i++) {
      const r = regretA[i] > 0 ? regretA[i] : 0;
      stratA[i] = r;
      sumA += r;
    }
    if (sumA > 0) {
      for (let i = 0; i < nA; i++) stratA[i] /= sumA;
    } else {
      stratA.fill(1 / nA);
    }

    let sumP = 0;
    for (let j = 0; j < nP; j++) {
      const r = regretP[j] > 0 ? regretP[j] : 0;
      stratP[j] = r;
      sumP += r;
    }
    if (sumP > 0) {
      for (let j = 0; j < nP; j++) stratP[j] /= sumP;
    } else {
      stratP.fill(1 / nP);
    }

    let valA = 0;
    for (let i = 0; i < nA; i++) {
      let u = 0;
      const base = i * nP;
      for (let j = 0; j < nP; j++) u += payoff[base + j] * stratP[j];
      utilA[i] = u;
      valA += stratA[i] * u;
    }
    for (let i = 0; i < nA; i++) {
      regretA[i] += utilA[i] - valA;
      stratSumA[i] += stratA[i];
    }

    let valP = 0;
    for (let j = 0; j < nP; j++) {
      let u = 0;
      for (let i = 0; i < nA; i++) u -= payoff[i * nP + j] * stratA[i];
      utilP[j] = u;
      valP += stratP[j] * u;
    }
    for (let j = 0; j < nP; j++) {
      regretP[j] += utilP[j] - valP;
    }
  }

  const nashDist = new Float64Array(nA);
  let nSum = 0;
  for (let i = 0; i < nA; i++) nSum += stratSumA[i];
  for (let i = 0; i < nA; i++) nashDist[i] = nSum > 0 ? stratSumA[i] / nSum : 1 / nA;

  const p1Habit = oppModel.predictDistribution(p1Perms);
  const snipeScores = new Float64Array(nA);
  let maxSnipe = -1e9;
  for (let i = 0; i < nA; i++) {
    let s = 0;
    const base = i * nP;
    for (let j = 0; j < nP; j++) s += payoff[base + j] * p1Habit[j];
    snipeScores[i] = s;
    if (s > maxSnipe) maxSnipe = s;
  }

  const snipeDist = new Float64Array(nA);
  let sSum = 0;
  const temp = 12;
  for (let i = 0; i < nA; i++) {
    const e = Math.exp(Math.max(-40, (snipeScores[i] - maxSnipe) / temp));
    snipeDist[i] = e;
    sSum += e;
  }
  for (let i = 0; i < nA; i++) snipeDist[i] /= sSum;

  const finalDist = new Float64Array(nA);
  let fSum = 0;
  const killMode = p1Hp <= 15;
  for (let i = 0; i < nA; i++) {
    let w = 0.7 * nashDist[i] + 0.3 * snipeDist[i];
    if (killMode) {
      w *= (1 + killInfo[i] * 14);
    }
    finalDist[i] = w;
    fSum += w;
  }
  for (let i = 0; i < nA; i++) finalDist[i] /= fSum;

  const pickIdx = sampleFromProbs(finalDist);
  return {
    cards: aiPerms[pickIdx],
    meta: killMode
      ? `어려움 AI · 킬각 포착! (${nA}×${nP} 매트릭스 · RM 300회)`
      : `어려움 AI · RM 300회(70%) + 습관저격(30%) [${nA}×${nP}]`
  };
}

function dealHand() {
  const atkPool = CARDS.filter(c => c.cat === 'atk').map(c => c.id);
  const defUtilPool = CARDS.filter(c => c.cat === 'def' || c.cat === 'util').map(c => c.id);
  const allPool = CARDS.map(c => c.id);

  const shuffle = arr => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  };

  const hand = [];
  const sAtk = shuffle(atkPool);
  hand.push(sAtk[0], sAtk[1]);

  const sDU = shuffle(defUtilPool.filter(id => !hand.includes(id)));
  hand.push(sDU[0]);

  const rem = shuffle(allPool.filter(id => !hand.includes(id)));
  hand.push(rem[0], rem[1]);

  return shuffle(hand);
}

const rooms = new Map();
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/assets/duelists.webp', ['assets/duelists.webp', 'image/webp']]
]);

const server = http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  const route = req.url.split('?')[0];
  if (route === '/cards.json') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ cards: CARDS, categories: CAT_INFO, attacks: [...ATTACK_IDS] }));
    return;
  }
  const asset = assets.get(route);
  if (!asset) {
    res.writeHead(404).end();
    return;
  }
  fs.readFile(path.join(__dirname, 'public', asset[0]), (error, data) => {
    if (error) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': asset[1], 'Content-Length': data.length });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false });

server.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (req.url !== '/play' || !host || (origin && origin !== 'https://' + host && origin !== 'http://' + host)) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return;
  }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
});

function send(socket, message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(room, message) {
  for (const player of room.players) send(player.socket, message);
}

function schedule(room, delay, task) {
  clearTimeout(room.timer);
  room.timer = setTimeout(task, Math.max(0, delay));
}

function schedulePlanDeadline(room) {
  schedule(room, room.deadline - Date.now(), () => {
    if (room.phase !== 'plan') return;
    if (Date.now() < room.deadline) schedulePlanDeadline(room);
    else resolveClash(room);
  });
}

function makePlayer(socket) {
  return { socket, hp: 100, wins: 0, energy: false, hand: [], slots: [], locked: false, revision: 0, rematch: false };
}

function makeRoom(socket, mode, code, difficulty) {
  const room = {
    mode, code, difficulty,
    players: mode === 'ai' ? [makePlayer(socket), makePlayer(null)] : [makePlayer(socket)],
    model: mode === 'ai' ? new OpponentModel() : null,
    phase: 'waiting',
    round: 1, turn: 1, cycle: 0,
    deadline: 0, timer: null
  };
  socket.room = room;
  return room;
}

function stopRoom(room, leavingSocket) {
  room.phase = 'closed';
  clearTimeout(room.timer);
  if (room.code) rooms.delete(room.code);
  for (const { socket } of room.players) {
    if (!socket) continue;
    socket.room = null;
    if (socket !== leavingSocket) send(socket, { type: 'opponent_left' });
  }
}

function getSeat(room, socket) {
  return room.players.findIndex(player => player.socket === socket);
}

function serializeFighter(player) {
  return { hp: player.hp, wins: player.wins, energy: player.energy, hand: player.hand };
}

function startMatch(room) {
  room.round = 1;
  for (const player of room.players) {
    player.rematch = false;
    player.wins = 0;
  }
  room.model?.reset();
  startRound(room);
}

function startRound(room) {
  for (const player of room.players) {
    player.hp = 100;
    player.energy = false;
  }
  room.turn = 1;
  startPlan(room, true);
}

function startPlan(room, newRound = false) {
  room.phase = 'plan';
  room.cycle++;
  room.deadline = Date.now() + PLAN_MS;
  room.replayUsed = false;
  for (const player of room.players) {
    player.hand = dealHand();
    player.slots = [];
    player.locked = false;
    player.revision = 0;
  }
  broadcast(room, {
    type: 'plan', cycle: room.cycle, round: room.round, turn: room.turn,
    deadline: room.deadline, serverTime: Date.now(), newRound,
    fighters: room.players.map(serializeFighter)
  });
  schedulePlanDeadline(room);
}

function publishSelection(room, index, countChanged) {
  const player = room.players[index];
  const opponent = room.players[1 - index];
  send(player.socket, {
    type: 'selection', cycle: room.cycle,
    slots: player.slots, revision: player.revision, locked: player.locked,
    preview: computePreviewTimeline(player.slots, player.hp, opponent.hp, player.energy)
  });
  if (countChanged) {
    send(opponent.socket, { type: 'opponent_count', cycle: room.cycle, count: player.slots.length });
  }
}

function resolveClash(room) {
  if (room.phase !== 'plan') return;
  room.phase = 'clash';
  const [p1, p2] = room.players;
  const startHp = room.players.map(player => player.hp);
  let aiMeta = '';
  if (room.mode === 'ai') {
    const move = chooseAIMove(p2.hand, p1.hand, p1.hp, p2.hp, p1.energy, p2.energy, room.difficulty, room.model);
    p2.slots = move.cards;
    aiMeta = move.meta;
  }
  for (const player of room.players) {
    if (player.slots.length === 0) player.slots = [player.hand[0]];
  }
  room.model?.observe(p1.slots);
  const result = simulateMatchup(p1.slots, p2.slots, p1.hp, p2.hp, p1.energy, p2.energy);
  const timeline = result.timeline;
  const finalTick = timeline.at(-1);
  while (timeline.length < 30) {
    timeline.push({
      tick: timeline.length,
      p1: { ...finalTick.p1, phase: 'idle', cardId: 0, origId: 0, slotIdx: -1, phaseTick: 0, bombs: [] },
      p2: { ...finalTick.p2, phase: 'idle', cardId: 0, origId: 0, slotIdx: -1, phaseTick: 0, bombs: [] },
      events: []
    });
  }
  const duration = timeline.reduce((ms, tick) => ms + TICK_MS + (tick.events.some(event => event.hitstop) ? HITSTOP_MS : 0), 0);
  room.lastDuration = duration;
  const playAt = Date.now() + PLAY_START_MS;
  broadcast(room, {
    type: 'clash', cycle: room.cycle, slots: room.players.map(player => player.slots),
    startHp, timeline, aiMeta, playAt, serverTime: Date.now()
  });
  schedule(room, playAt + duration - Date.now(), () => {
    p1.hp = result.p1Hp;
    p2.hp = result.p2Hp;
    if (p1.hp <= 0 || p2.hp <= 0) {
      finishRound(room);
      return;
    }
    p1.energy = result.p1NextEnergy;
    p2.energy = result.p2NextEnergy;
    room.phase = 'turn_pause';
    broadcast(room, { type: 'turn_end', cycle: room.cycle, energy: [p1.energy, p2.energy] });
    schedule(room, TURN_PAUSE_MS, () => {
      room.turn++;
      startPlan(room);
    });
  });
}

function finishRound(room) {
  const [p1, p2] = room.players;
  const winner = p1.hp <= 0 && p2.hp <= 0 ? -1 : p2.hp <= 0 ? 0 : 1;
  if (winner !== -1) room.players[winner].wins++;
  for (const player of room.players) player.energy = false;
  const matchOver = p1.wins === 2 || p2.wins === 2;
  room.phase = matchOver ? 'match_end' : 'round_end';
  const nextRound = room.round + (winner !== -1 && !matchOver ? 1 : 0);
  const nextAt = !matchOver && room.mode === 'online' ? Date.now() + ROUND_PAUSE_MS : null;
  room.nextRound = nextRound;
  broadcast(room, {
    type: 'round_end', cycle: room.cycle, winner, matchOver,
    wins: [p1.wins, p2.wins], nextRound, nextAt, serverTime: Date.now()
  });
  if (nextAt !== null) schedule(room, nextAt - Date.now(), () => advanceRound(room));
}

function advanceRound(room) {
  room.round = room.nextRound;
  startRound(room);
}

function selectCards(room, index, msg) {
  const player = room.players[index];
  if (player.locked || !Number.isSafeInteger(msg.revision) || msg.revision <= player.revision) return;
  if (!Array.isArray(msg.slots) || msg.slots.length > 3 || new Set(msg.slots).size !== msg.slots.length) return;
  if (msg.slots.some(id => !player.hand.includes(id))) return;
  if (msg.type === 'lock' && msg.slots.length === 0) return;
  const countChanged = player.slots.length !== msg.slots.length;
  player.slots = msg.slots;
  player.revision = msg.revision;
  player.locked = msg.type === 'lock';
  publishSelection(room, index, countChanged);
  if ((room.mode === 'ai' && player.locked) || room.players.every(item => item.locked)) resolveClash(room);
}

function assignRoom(socket, msg) {
  if (socket.room) return;
  if (msg.type === 'ai') {
    const difficulty = DIFFICULTIES.has(msg.difficulty) ? msg.difficulty : 'normal';
    const room = makeRoom(socket, 'ai', null, difficulty);
    send(socket, { type: 'seat', seat: 0, mode: 'ai', code: null, difficulty });
    startMatch(room);
    return;
  }
  if (msg.type === 'create') {
    if (rooms.size >= 1000) {
      send(socket, { type: 'notice', text: '빈 방이 없습니다. 잠시 후 다시 시도하세요.' });
      return;
    }
    let code;
    do {
      code = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    } while (rooms.has(code));
    const room = makeRoom(socket, 'online', code);
    rooms.set(code, room);
    send(socket, { type: 'seat', seat: 0, mode: 'online', code, waiting: true });
    return;
  }
  const room = typeof msg.code === 'string' && /^\d{4}$/.test(msg.code) ? rooms.get(msg.code) : undefined;
  if (room?.phase !== 'waiting') {
    send(socket, { type: 'notice', text: room ? '이미 대전이 시작된 방입니다.' : '방을 찾을 수 없습니다. 방 코드를 확인하세요.' });
    return;
  }
  room.players.push(makePlayer(socket));
  socket.room = room;
  send(socket, { type: 'seat', seat: 1, mode: 'online', code: room.code });
  startMatch(room);
}

function handleMessage(socket, msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'clock' && Number.isFinite(msg.sent)) {
    send(socket, { type: 'clock', sent: msg.sent, serverTime: Date.now() });
    return;
  }
  if (['create', 'join', 'ai'].includes(msg.type)) {
    assignRoom(socket, msg);
    return;
  }
  const room = socket.room;
  if (!room) return;
  if (msg.type === 'leave') {
    stopRoom(room, socket);
    return;
  }
  if (msg.cycle !== room.cycle) return;
  const index = getSeat(room, socket);
  if (room.mode === 'ai' && msg.type === 'difficulty' && DIFFICULTIES.has(msg.difficulty)) {
    room.difficulty = msg.difficulty;
  }
  if (room.phase === 'plan') {
    if (Date.now() >= room.deadline) {
      resolveClash(room);
    } else if (msg.type === 'select' || msg.type === 'lock') {
      selectCards(room, index, msg);
    } else if (msg.type === 'replay' && room.mode === 'ai' && room.turn > 1 && !room.replayUsed) {
      room.replayUsed = true;
      room.deadline += room.lastDuration;
      schedulePlanDeadline(room);
      send(socket, { type: 'deadline', cycle: room.cycle, deadline: room.deadline });
    }
  } else if (room.phase === 'round_end' && msg.type === 'next_round' && room.mode === 'ai') {
    advanceRound(room);
  } else if (room.phase === 'match_end' && msg.type === 'rematch') {
    room.players[index].rematch = true;
    if (room.mode === 'ai' || room.players.every(player => player.rematch)) {
      startMatch(room);
    } else {
      broadcast(room, { type: 'rematch_status', cycle: room.cycle, ready: room.players.map(player => player.rematch) });
    }
  }
}

wss.on('connection', socket => {
  socket.alive = true;
  socket.messageWindow = Date.now();
  socket.messageCount = 0;
  socket.on('pong', () => { socket.alive = true; });
  socket.on('error', () => socket.terminate());
  socket.on('close', () => {
    if (socket.room) stopRoom(socket.room, socket);
  });
  socket.on('message', (raw, binary) => {
    if (binary) return;
    const now = Date.now();
    if (now - socket.messageWindow >= 1000) {
      socket.messageWindow = now;
      socket.messageCount = 0;
    }
    if (++socket.messageCount > 60) {
      socket.close(1008, 'Rate limit');
      return;
    }
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    handleMessage(socket, msg);
  });
});

setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.alive) {
      socket.terminate();
      continue;
    }
    socket.alive = false;
    if (socket.readyState === WebSocket.OPEN) socket.ping();
  }
}, 5000).unref();

const port = Number(process.env.PORT || 3000);
server.listen(port, '0.0.0.0', () => {
  console.log('3SEC CLASH listening on port ' + server.address().port);
});
