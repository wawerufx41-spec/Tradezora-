/* TradeZora shared demo trading engine.
   Keeps continuous demo trading alive while navigating between Trade,
   Positions and History pages. Demo only; no broker/API connection. */
(function () {
  const KEY = 'tradezoraContinuousState';
  const POS = 'tradezoraDemoPositions';
  const HIST = 'tradezoraDemoHistory';
  const BAL = 'tradezoraDemoBalance';
  let busy = false;

  const read = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key) ?? JSON.stringify(fallback)); }
    catch { return fallback; }
  };
  const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));

  function getState() {
    const s = read(KEY, null);
    return s && typeof s === 'object' ? s : { running:false };
  }

  function emit() {
    window.dispatchEvent(new CustomEvent('tradezora-state-changed'));
  }

  function normalizeRiskTarget(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function riskReached(state) {
    const sessionPnl = Number(state.sessionPnl || 0);
    const takeProfit = normalizeRiskTarget(state.takeProfit);
    const stopLoss = normalizeRiskTarget(state.stopLoss);

    if (takeProfit > 0 && sessionPnl >= takeProfit) {
      return 'take-profit';
    }
    if (stopLoss > 0 && sessionPnl <= -stopLoss) {
      return 'stop-loss';
    }
    return null;
  }

  function normalizeMultiplier(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 6;
  }

  function normalizeMaxConsecutiveLosses(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 6;
  }

  function settlePosition(position, now) {
    const closingPrice = Number(localStorage.getItem("tradezoraDemoLastPrice") || 0);
    const finalDigit = Number.isFinite(closingPrice) && closingPrice !== 0
      ? (Math.round(Math.abs(closingPrice) * 100) % 10)
      : Math.floor(Math.random() * 10);
    const type = String(position.type || '').toUpperCase();
    const contract = position.contract;
    const digit = Number(position.digit);
    let win = false;

    if (contract === 'match') {
      win = (finalDigit === digit && type === 'MATCH') ||
            (finalDigit !== digit && type === 'DIFFER');
    } else if (contract === 'even') {
      win = (finalDigit % 2 === 0 && type === 'EVEN') ||
            (finalDigit % 2 !== 0 && type === 'ODD');
    } else if (contract === 'over') {
      // Over/Under use the selected digit as the barrier.
      // OVER N wins when the closing digit is greater than N.
      // UNDER N wins when the closing digit is less than N.
      // Equality is always a loss.
      if (type === 'OVER') {
        win = finalDigit > digit;
      } else if (type === 'UNDER') {
        win = finalDigit < digit;
      }
    }

    const stake = Number(position.stake) || 0;
    const overProfitTable = {
      0: 0.56,
      1: 1.88,
      2: 3.57,
      3: 5.83,
      4: 9.00,
      5: 13.75,
      6: 21.67,
      7: 37.50,
      8: 85.00
    };
    let profit = 0;
    if (win) {
      if (contract === 'over') {
        const barrier = Number(digit);
        const baseProfit = type === 'OVER'
          ? overProfitTable[barrier]
          : overProfitTable[9 - barrier];
        profit = Number.isFinite(baseProfit) ? stake * (baseProfit / 10) : 0;
      } else {
        profit = stake * 0.85;
      }
    }
    let balance = Number(localStorage.getItem(BAL) || 10000);
    if (win) balance += stake + profit;

    localStorage.setItem(BAL, String(balance));

    const history = read(HIST, []);
    history.push({ ...position, finalDigit, win, profit, settledAt: now });
    write(HIST, history.slice(-100));
    localStorage.setItem("tradezoraLastDigitResult", JSON.stringify({
      digit: finalDigit, win: Boolean(win), at: now
    }));

    // Loss progression: the selected multiplier is applied after each loss.
    // With the default 6x / six-loss cycle and a $10 base stake the sequence is:
    // $10 -> $60 -> $360 -> $2,160 -> $12,960 -> $77,760 -> $10.
    // Any win resets immediately to the base stake. A sixth consecutive loss
    // also completes the cycle and resets the next stake to the base stake.
    let state = getState();
    if (state.running) {
      const baseStake = Number(state.baseStake || state.stake || 0);
      const multiplier = normalizeMultiplier(state.multiplier);
      const maxConsecutiveLosses = normalizeMaxConsecutiveLosses(state.maxConsecutiveLosses);
      let consecutiveLosses = Number(state.consecutiveLosses || 0);
      let nextStake = Number(state.stake || baseStake);

      if (win) {
        consecutiveLosses = 0;
        nextStake = baseStake;
      } else {
        consecutiveLosses += 1;
        if (consecutiveLosses >= maxConsecutiveLosses) {
          consecutiveLosses = 0;
          nextStake = baseStake;
        } else {
          nextStake = stake * multiplier;
        }
      }

      state = {
        ...state,
        baseStake,
        multiplier,
        maxConsecutiveLosses,
        consecutiveLosses,
        stake: nextStake
      };
    }

    // Take Profit / Stop Loss are session guards for continuous AUTO trading.
    // The current trade is always allowed to settle; the risk guard only
    // decides whether another AUTO trade may be opened afterwards.
    if (state.running) {
      const tradePnl = win ? profit : -stake;
      const sessionPnl = Number(state.sessionPnl || 0) + tradePnl;
      const updated = { ...state, sessionPnl };
      const reason = riskReached(updated);
      if (reason) {
        updated.running = false;
        updated.nextTradeAt = null;
        updated.stoppedReason = reason;
        updated.stoppedAt = now;
      }
      write(KEY, updated);
    }

    try {
      window.dispatchEvent(new CustomEvent("tradezora-trade-settled", {
        detail: { digit: finalDigit, win: Boolean(win), profit: profit }
      }));
    } catch (e) {}
  }

  function openContinuousTrade(state, now) {
    const stake = Number(state.stake);
    let balance = Number(localStorage.getItem(BAL) || 10000);
    if (!Number.isFinite(stake) || stake <= 0 || stake > balance) {
      const stopped = { ...state, running:false, nextTradeAt:null, stoppedReason:'balance' };
      write(KEY, stopped);
      return false;
    }

    // A newly opened AUTO trade must not inherit the previous trade's
    // green/red result. The result light appears only after settlement.
    localStorage.removeItem("tradezoraLastDigitResult");
    try {
      window.dispatchEvent(new CustomEvent("tradezora-trade-opened", {
        detail: { mode: "AUTO", digit: Number(state.digit), type: state.type }
      }));
    } catch (e) {}

    balance -= stake;
    localStorage.setItem(BAL, String(balance));

    const positions = read(POS, []);
    positions.push({
      id: `ct-${now}-${Math.random().toString(36).slice(2)}`,
      type: state.type,
      stake,
      digit: Number(state.digit),
      contract: state.contract,
      mode: state.mode || 'AUTO',
      openedAt: now,
      settleAt: now + 5000,
      continuous: true,
      multiplier: normalizeMultiplier(state.multiplier),
      consecutiveLosses: Number(state.consecutiveLosses || 0)
    });
    write(POS, positions);

    write(KEY, { ...state, running:true, nextTradeAt:now + 6500 });
    return true;
  }

  function tick() {
    if (busy) return;
    busy = true;
    try {
      const now = Date.now();
      let positions = read(POS, []);
      const remaining = [];
      let changed = false;

      for (const position of positions) {
        if (position.settleAt && Number(position.settleAt) <= now) {
          settlePosition(position, now);
          changed = true;
        } else {
          remaining.push(position);
        }
      }
      if (changed) write(POS, remaining);

      let state = getState();
      const riskReason = state.running ? riskReached(state) : null;
      if (riskReason) {
        write(KEY, { ...state, running:false, nextTradeAt:null, stoppedReason:riskReason, stoppedAt:now });
        state = getState();
        changed = true;
      }
      if (state.running && String(state.mode || '').toUpperCase() === 'MANUAL') {
        write(KEY, { ...state, running:false, nextTradeAt:null });
        state = getState();
        changed = true;
      }
      if (state.running && Number(state.nextTradeAt || 0) <= now) {
        if (openContinuousTrade(state, now)) changed = true;
        state = getState();
      }

      if (changed) emit();
    } finally {
      busy = false;
    }
  }

  const api = {
    getState,
    start(config) {
      if (String(config.mode || '').toUpperCase() === 'MANUAL') {
        return getState();
      }
      const state = {
        running:true,
        type:String(config.type || 'EVEN').toUpperCase(),
        contract:config.contract || 'even',
        digit:Number(config.digit ?? 0),
        baseStake:Number(config.baseStake || config.stake || 1),
        stake:Number(config.stake || 1),
        multiplier:normalizeMultiplier(config.multiplier),
        maxConsecutiveLosses:normalizeMaxConsecutiveLosses(config.maxConsecutiveLosses),
        consecutiveLosses:0,
        mode:config.mode || 'AUTO',
        market:config.market || null,
        takeProfit:normalizeRiskTarget(config.takeProfit),
        stopLoss:normalizeRiskTarget(config.stopLoss),
        sessionPnl:0,
        startedAt:Date.now(),
        stoppedReason:null,
        nextTradeAt:Date.now()
      };
      write(KEY, state);
      tick();
      emit();
      return getState();
    },
    stop() {
      const state = getState();
      write(KEY, { ...state, running:false, nextTradeAt:null, stoppedReason:'manual-stop' });
      emit();
    },
    updateRisk(takeProfit, stopLoss) {
      const state = getState();
      const updated = {
        ...state,
        takeProfit: normalizeRiskTarget(takeProfit),
        stopLoss: normalizeRiskTarget(stopLoss)
      };
      const reason = updated.running ? riskReached(updated) : null;
      if (reason) {
        updated.running = false;
        updated.nextTradeAt = null;
        updated.stoppedReason = reason;
        updated.stoppedAt = Date.now();
      }
      write(KEY, updated);
      emit();
      return getState();
    },
    reset() {
      localStorage.removeItem(KEY);
      emit();
    },
    tick
  };

  window.TradeZoraContinuousEngine = api;
  tick();
  setInterval(tick, 500);
})();
