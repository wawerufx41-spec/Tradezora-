/* TradeZora shared demo trading engine.
   Keeps continuous demo trading alive while navigating between Trade,
   Positions and History pages. Demo only; no broker/API connection. */
(function () {
  const KEY = 'tradezoraContinuousState';
  const POS = 'tradezoraDemoPositions';
  const HIST = 'tradezoraDemoHistory';
  const BAL = 'tradezoraDemoBalance';
  let busy = false;
  const API_BASE = "https://tradezora-backend-1.onrender.com";
  function getAuthToken() {
    return localStorage.getItem("tradezoraAuthToken") ||
      localStorage.getItem("session_token") ||
      localStorage.getItem("sessionToken") || "";
  }
  async function requestDemoOutcome(position, naturalDigit) {
    if (String(position.contract || '').toLowerCase() !== 'even' || !['EVEN', 'ODD'].includes(String(position.type || '').toUpperCase())) return null;
    const token = getAuthToken();
    if (!token) return { error: true };
    try {
      const response = await fetch(`${API_BASE}/api/demo/outcome`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}`, "Accept": "application/json" },
        body: JSON.stringify({ accountMode: "demo", mode: String(position.mode || "AUTO").toUpperCase(), contract: position.contract, type: position.type, digit: Number(position.digit), naturalDigit })
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.success && data.override === false) return null; // explicitly disabled by admin
      if (!response.ok || !data.success || data.override !== true) return { error: true };
      const finalDigit = Number(data.finalDigit);
      if (!Number.isInteger(finalDigit) || finalDigit < 0 || finalDigit > 9) return { error: true };
      const type = String(position.type || '').toUpperCase();
      const actualWin = (finalDigit % 2 === 0 && type === 'EVEN') || (finalDigit % 2 !== 0 && type === 'ODD');
      if (actualWin !== Boolean(data.win)) return { error: true };
      return { finalDigit, win: actualWin };
    } catch (_) { return { error: true }; }
  }

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

  async function settlePosition(position, now) {
    const closingPrice = Number(localStorage.getItem("tradezoraDemoLastPrice") || 0);
    let finalDigit = Number.isFinite(closingPrice) && closingPrice !== 0
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
      if (type === 'OVER') {
        win = finalDigit > digit;
      } else if (type === 'UNDER') {
        win = finalDigit < digit;
      }
    }

    const controlledOutcome = await requestDemoOutcome(position, finalDigit);
    if (controlledOutcome?.error) {
      window.dispatchEvent(new CustomEvent('tradezora-settlement-error', { detail: { message: 'Even/Odd demo settlement paused because the outcome-control service did not confirm the result.' } }));
      return false;
    }
    if (controlledOutcome) {
      finalDigit = controlledOutcome.finalDigit;
      win = controlledOutcome.win;
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

    const currentState = getState();
    const positionWasRecovery = Boolean(position.recoveryApplied);
    const selectedMultiplier = Math.min(10, Math.max(1, Number(position.multiplier || currentState.multiplier || 1)));
    const nextRecovery = !positionWasRecovery && !win && selectedMultiplier > 1;

    // Track realized demo session P/L and results when each position settles.
    // A win returns stake + profit to balance, so realized P/L is profit;
    // a loss forfeits the stake already deducted when the position opened.
    const tradePnl = win ? profit : -stake;
    const sessionPnl = Number(currentState.sessionPnl || 0) + tradePnl;
    const sessionWins = Number(currentState.sessionWins ?? currentState.wins ?? 0) + (win ? 1 : 0);
    const sessionLosses = Number(currentState.sessionLosses ?? currentState.losses ?? 0) + (win ? 0 : 1);
    const sessionTrades = Number(currentState.sessionTrades || 0) + 1;
    write(KEY, {
      ...currentState,
      recoveryPending: nextRecovery,
      sessionPnl,
      sessionWins,
      sessionLosses,
      sessionTrades
    });

    localStorage.setItem("tradezoraLastDigitResult", JSON.stringify({
      digit: finalDigit, win: Boolean(win), at: now
    }));

    try {
      window.dispatchEvent(new CustomEvent("tradezora-trade-settled", {
        detail: {
          digit: finalDigit,
          win: Boolean(win),
          profit,
          tradePnl,
          sessionPnl,
          sessionWins,
          sessionLosses,
          sessionTrades
        }
      }));
    } catch (e) {}
    return true;
  }

  function openContinuousTrade(state, now) {
    const baseStake = Number(state.baseStake ?? state.stake);
    const selectedMultiplier = Math.min(10, Math.max(1, Number(state.multiplier || 1)));
    const recoveryApplied = Boolean(state.recoveryPending) && selectedMultiplier > 1;
    const stake = recoveryApplied ? baseStake * selectedMultiplier : baseStake;
    let balance = Number(localStorage.getItem(BAL) || 10000);
    if (!Number.isFinite(stake) || stake <= 0 || stake > balance) {
      const stopped = { ...state, running:false, nextTradeAt:null, stoppedReason:'balance' };
      write(KEY, stopped);
      return false;
    }

    const nextState = {
      ...state,
      baseStake,
      stake: baseStake,
      multiplier: selectedMultiplier,
      recoveryPending: false
    };

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
      baseStake,
      multiplier: selectedMultiplier,
      recoveryApplied,
      digit: Number(state.digit),
      contract: state.contract,
      mode: state.mode || 'AUTO',
      openedAt: now,
      settleAt: now + 5000,
      continuous: true
    });
    write(POS, positions);

    write(KEY, { ...nextState, running:true, nextTradeAt:now + 6500 });
    return true;
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const now = Date.now();
      let positions = read(POS, []);
      const remaining = [];
      let changed = false;

      for (const position of positions) {
        if (position.settleAt && Number(position.settleAt) <= now) {
          const settled = await settlePosition(position, now);
          if (settled === false) remaining.push(position);
          else changed = true;
        } else {
          remaining.push(position);
        }
      }
      if (changed) write(POS, remaining);

      let state = getState();
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
        stake:Number(config.stake || 1),
        baseStake:Number(config.baseStake ?? config.stake ?? 1),
        multiplier:Math.min(10, Math.max(1, Number(config.multiplier || 1))),
        recoveryPending:false,
        mode:config.mode || 'AUTO',
        market:config.market || null,
        nextTradeAt:Date.now()
      };
      write(KEY, state);
      tick();
      emit();
      return getState();
    },
    stop() {
      const state = getState();
      write(KEY, { ...state, running:false, nextTradeAt:null });
      emit();
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
