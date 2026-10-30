/* LumiBinary shared AUTO engine.
   Runs from every app page that includes this file. State and ledgers remain
   separated between Demo and Real Test. This is browser-based automation: it
   resumes on the next page load, but it is not a server-side background worker. */
(function () {
  'use strict';

  if (window.__lumiBinaryEngineInstalled) return;
  window.__lumiBinaryEngineInstalled = true;

  const API_BASE = 'https://tradezora-backend-1.onrender.com';
  const TICK_MS = 500;
  const DEMO_SETTLEMENT_MS = 5000;
  const AUTO_REOPEN_DELAY_MS = 6500;
  const LOCK_KEY = 'lumiBinaryAutoEngineLeader';
  const OWNER = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const LOCK_TTL_MS = 4000;
  let busy = false;
  let intervalId = null;

  const KEYS = {
    demo: {
      state: 'tradezoraContinuousState',
      positions: 'tradezoraDemoPositions',
      history: 'tradezoraDemoHistory',
      balance: 'tradezoraDemoBalance'
    },
    real: {
      state: 'tradezoraRealSandboxAutoState',
      positions: 'tradezoraSandboxPositions',
      history: 'tradezoraSandboxHistory',
      balance: null
    }
  };

  const read = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (_) { return fallback; }
  };
  const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const getMode = (requested) => requested === 'real' || requested === 'demo'
    ? requested
    : (localStorage.getItem('tradezoraAccountMode') === 'real' ? 'real' : 'demo');
  const keysFor = (mode) => KEYS[getMode(mode)];
  const getAuthToken = () => localStorage.getItem('tradezoraAuthToken') ||
    localStorage.getItem('session_token') || localStorage.getItem('sessionToken') || '';

  function getState(requestedMode) {
    const keys = keysFor(requestedMode);
    const state = read(keys.state, null);
    return state && typeof state === 'object' ? state : { running: false };
  }

  function emit() {
    window.dispatchEvent(new CustomEvent('tradezora-state-changed'));
  }

  function emitError(message, mode) {
    window.dispatchEvent(new CustomEvent('tradezora-engine-error', {
      detail: { message: String(message || 'AUTO trading encountered an error.'), accountMode: getMode(mode) }
    }));
  }

  function acquireLeaderLock() {
    const now = Date.now();
    const existing = read(LOCK_KEY, null);
    if (existing && existing.owner !== OWNER && Number(existing.expiresAt || 0) > now) return false;
    write(LOCK_KEY, { owner: OWNER, expiresAt: now + LOCK_TTL_MS });
    const confirmed = read(LOCK_KEY, null);
    return Boolean(confirmed && confirmed.owner === OWNER);
  }

  function releaseLeaderLock() {
    const existing = read(LOCK_KEY, null);
    if (existing && existing.owner === OWNER) localStorage.removeItem(LOCK_KEY);
  }

  async function apiPost(path, body) {
    const token = getAuthToken();
    if (!token) throw new Error('Your session has expired. Sign in again to continue AUTO trading.');
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      throw new Error(data.error || data.message || `Trading service returned ${response.status}.`);
    }
    return data;
  }

  function getNaturalDigit() {
    const price = Number(localStorage.getItem('tradezoraDemoLastPrice') || 0);
    if (!Number.isFinite(price) || price <= 0) return null;
    return Math.round(Math.abs(price) * 100) % 10;
  }

  function calculateWin(contract, type, barrier, finalDigit) {
    const side = String(type || '').toUpperCase();
    if (contract === 'even') return (finalDigit % 2 === 0 && side === 'EVEN') || (finalDigit % 2 !== 0 && side === 'ODD');
    if (contract === 'match') return (finalDigit === barrier && side === 'MATCH') || (finalDigit !== barrier && side === 'DIFFER');
    if (contract === 'over') return (finalDigit > barrier && side === 'OVER') || (finalDigit < barrier && side === 'UNDER');
    return false;
  }

  async function requestDemoOutcome(position, naturalDigit) {
    const contract = String(position.contract || '').toLowerCase();
    const type = String(position.type || '').toUpperCase();
    const supported = (contract === 'even' && ['EVEN', 'ODD'].includes(type)) ||
      (contract === 'match' && ['MATCH', 'DIFFER'].includes(type)) ||
      (contract === 'over' && ['OVER', 'UNDER'].includes(type));
    if (!supported) return null;
    const token = getAuthToken();
    if (!token) return { error: true };
    try {
      const response = await fetch(`${API_BASE}/api/demo/outcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
        body: JSON.stringify({
          accountMode: 'demo', mode: String(position.mode || 'AUTO').toUpperCase(),
          contract, type, digit: Number(position.digit), naturalDigit
        })
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.success && data.override === false) return null;
      if (!response.ok || !data.success || data.override !== true) return { error: true };
      const finalDigit = Number(data.finalDigit);
      if (!Number.isInteger(finalDigit) || finalDigit < 0 || finalDigit > 9) return { error: true };
      const actualWin = calculateWin(contract, type, Number(position.digit), finalDigit);
      if (actualWin !== Boolean(data.win)) return { error: true };
      return { finalDigit, win: actualWin };
    } catch (_) { return { error: true }; }
  }

  function updateSessionAfterSettlement(mode, state, position, win, profit, now) {
    const stake = Number(position.stake) || 0;
    const tradePnl = win ? Number(profit || 0) : -stake;
    const sessionPnl = Number(state.sessionPnl || 0) + tradePnl;
    const sessionWins = Number(state.sessionWins ?? state.wins ?? 0) + (win ? 1 : 0);
    const sessionLosses = Number(state.sessionLosses ?? state.losses ?? 0) + (win ? 0 : 1);
    const sessionTrades = Number(state.sessionTrades || 0) + 1;

    const multiplier = Math.min(10, Math.max(1, Number(position.multiplier || state.multiplier || 1)));
    const maxRecoveryAttempts = multiplier > 1 ? multiplier : 0;
    const step = Math.max(0, Math.min(maxRecoveryAttempts, Number(position.recoveryStep ?? (position.recoveryApplied ? 1 : 0)) || 0));
    const nextRecoveryStep = win ? 0 : (step < maxRecoveryAttempts ? step + 1 : 0);
    const consecutiveLosses = win ? 0 : Number(state.consecutiveLosses || 0) + 1;
    const baseStake = Number(position.baseStake || state.baseStake || state.stake || stake);
    const updated = {
      ...state,
      sessionPnl,
      sessionWins,
      sessionLosses,
      sessionTrades,
      consecutiveLosses,
      recoveryStep: nextRecoveryStep,
      recoveryPending: nextRecoveryStep > 0,
      currentStake: win ? baseStake : Number(Math.min(baseStake * Math.pow(multiplier, consecutiveLosses), 1000).toFixed(2))
    };

    // Demo's recovery-step rules and Real Test's multiplier progression both
    // use the same persisted counters; the stored base stake remains unchanged.
    const takeProfit = Number(updated.takeProfit || 0);
    const stopLoss = Number(updated.stopLoss || 0);
    const maxLosses = Number(updated.maxConsecutiveLosses || 0);
    let reason = null;
    if (takeProfit > 0 && sessionPnl >= takeProfit) reason = 'take-profit';
    else if (stopLoss > 0 && sessionPnl <= -stopLoss) reason = 'stop-loss';
    else if (maxLosses > 0 && consecutiveLosses >= maxLosses) reason = 'consecutive-losses';

    if (reason && updated.running) {
      updated.running = false;
      updated.nextTradeAt = null;
      updated.stoppedReason = reason;
      updated.stoppedAt = now;
      updated.lastSessionResult = {
        sessionPnl, sessionTrades, sessionWins, sessionLosses,
        winRate: sessionTrades > 0 ? Math.round((sessionWins / sessionTrades) * 100) : 0
      };
    }
    return { state: updated, tradePnl };
  }

  async function settleDemoPosition(position, now) {
    const keys = KEYS.demo;
    const closingPrice = Number(localStorage.getItem('tradezoraDemoLastPrice') || 0);
    let finalDigit = Number.isFinite(closingPrice) && closingPrice !== 0
      ? (Math.round(Math.abs(closingPrice) * 100) % 10)
      : Math.floor(Math.random() * 10);
    const contract = String(position.contract || '').toLowerCase();
    const type = String(position.type || '').toUpperCase();
    const barrier = Number(position.digit);
    let win = calculateWin(contract, type, barrier, finalDigit);

    const controlled = await requestDemoOutcome(position, finalDigit);
    if (controlled?.error) {
      emitError('Demo settlement paused because the outcome-control service did not confirm the result.', 'demo');
      return false;
    }
    if (controlled) { finalDigit = controlled.finalDigit; win = controlled.win; }

    const stake = Number(position.stake) || 0;
    const overProfitTable = { 0: 0.56, 1: 1.88, 2: 3.57, 3: 5.83, 4: 9.00, 5: 13.75, 6: 21.67, 7: 37.50, 8: 85.00 };
    let profit = 0;
    if (win) {
      if (contract === 'over') {
        const rate = type === 'OVER' ? overProfitTable[barrier] : overProfitTable[9 - barrier];
        profit = Number.isFinite(rate) ? stake * (rate / 10) : 0;
      } else profit = stake * 0.85;
    }

    let balance = Number(localStorage.getItem(keys.balance) || 10000);
    if (win) balance += stake + profit;
    localStorage.setItem(keys.balance, String(balance));

    const history = read(keys.history, []);
    history.push({ ...position, finalDigit, win, profit, settledAt: now });
    write(keys.history, history.slice(-100));

    const currentState = getState('demo');
    const updated = updateSessionAfterSettlement('demo', currentState, position, win, profit, now);
    write(keys.state, updated.state);
    localStorage.setItem('tradezoraLastDigitResult', JSON.stringify({ digit: finalDigit, win: Boolean(win), at: now }));
    window.dispatchEvent(new CustomEvent('tradezora-trade-settled', {
      detail: {
        digit: finalDigit, win: Boolean(win), profit, tradePnl: updated.tradePnl,
        sessionPnl: updated.state.sessionPnl, sessionWins: updated.state.sessionWins,
        sessionLosses: updated.state.sessionLosses, sessionTrades: updated.state.sessionTrades,
        accountMode: 'demo', mode: position.mode || 'AUTO', stake
      }
    }));
    return true;
  }

  async function openDemoTrade(state, now) {
    const keys = KEYS.demo;
    const baseStake = Number(state.baseStake ?? state.stake);
    const multiplier = Math.min(10, Math.max(1, Number(state.multiplier || 1)));
    const maxRecoveryAttempts = multiplier > 1 ? multiplier : 0;
    const recoveryStep = Math.max(0, Math.min(maxRecoveryAttempts, Number(state.recoveryStep || 0)));
    const recoveryApplied = recoveryStep > 0 && multiplier > 1;
    const stake = recoveryApplied ? baseStake * Math.pow(multiplier, recoveryStep) : baseStake;
    const balance = Number(localStorage.getItem(keys.balance) || 10000);
    if (!Number.isFinite(stake) || stake <= 0 || stake > balance) {
      write(keys.state, { ...state, running: false, nextTradeAt: null, stoppedReason: 'balance', stoppedAt: now });
      return false;
    }

    localStorage.removeItem('tradezoraLastDigitResult');
    window.dispatchEvent(new CustomEvent('tradezora-trade-opened', {
      detail: { mode: 'AUTO', accountMode: 'demo', contract: state.contract, digit: Number(state.digit), type: state.type }
    }));
    localStorage.setItem(keys.balance, String(balance - stake));

    const positions = read(keys.positions, []);
    positions.push({
      id: `ct-${now}-${Math.random().toString(36).slice(2)}`,
      type: state.type, stake, baseStake, multiplier, recoveryApplied, recoveryStep,
      digit: Number(state.digit), contract: state.contract, mode: 'AUTO',
      openedAt: now, settleAt: now + DEMO_SETTLEMENT_MS, continuous: true,
      autoSessionId: state.sessionId || null, market: state.market || null
    });
    write(keys.positions, positions);
    write(keys.state, { ...state, baseStake, stake: baseStake, multiplier, recoveryStep,
      recoveryPending: false, running: true, nextTradeAt: now + AUTO_REOPEN_DELAY_MS });
    emit();
    return true;
  }

  async function openRealTrade(state, now) {
    const stake = Number(state.currentStake || state.stake);
    const contract = String(state.contract || 'match').toLowerCase();
    const type = String(state.type || 'MATCH').toUpperCase();
    const digit = Number(state.digit);
    if (!Number.isFinite(stake) || stake < 1) throw new Error('Real Test AUTO requires a stake of at least $1.00.');
    if (contract === 'over' && ((type === 'OVER' && digit === 9) || (type === 'UNDER' && digit === 0))) {
      throw new Error(type === 'OVER' ? 'Over 9 cannot be traded.' : 'Under 0 cannot be traded.');
    }

    localStorage.removeItem('tradezoraLastDigitResult');
    window.dispatchEvent(new CustomEvent('tradezora-trade-opened', {
      detail: { mode: 'AUTO', accountMode: 'real', contract, digit, type }
    }));
    const data = await apiPost('/api/sandbox/trades/open', { contract, type, digit, stake });
    if (!data.trade || !data.trade.id) throw new Error('Trading service did not return a valid trade ID.');

    const fundingSource = data.fundingSource || data.trade.funding_source || 'test';
    const position = {
      id: `sandbox-${data.trade.id}`,
      serverTradeId: Number(data.trade.id),
      accountMode: 'real', fundingSource, type, stake, digit, contract,
      mode: 'AUTO', autoSessionId: state.sessionId || null,
      openedAt: now, settleAt: now + DEMO_SETTLEMENT_MS,
      continuous: true, market: state.market || null
    };
    const positions = read(KEYS.real.positions, []);
    if (!positions.some(item => item.id === position.id)) positions.push(position);
    write(KEYS.real.positions, positions);
    write(KEYS.real.state, { ...state, running: true, nextTradeAt: now + AUTO_REOPEN_DELAY_MS });
    emit();
    return true;
  }

  async function settleRealPosition(position, now) {
    const naturalDigit = getNaturalDigit();
    if (!Number.isInteger(naturalDigit)) throw new Error('Waiting for the latest market quote before settling this Real Test position.');
    const settled = await apiPost(`/api/sandbox/trades/${Number(position.serverTradeId)}/settle`, { naturalDigit });
    const positions = read(KEYS.real.positions, []);
    const idx = positions.findIndex(item => item.id === position.id);
    if (idx < 0) return true;

    positions.splice(idx, 1);
    const fundingSource = settled.fundingSource || position.fundingSource || 'test';
    const finalTrade = {
      ...position, fundingSource,
      finalDigit: Number(settled.finalDigit),
      win: Boolean(settled.win),
      profit: Number(settled.profit || 0),
      settledAt: now,
      sandboxOnly: settled.sandbox_only === true
    };
    const history = read(KEYS.real.history, []);
    history.push(finalTrade);
    write(KEYS.real.history, history.slice(-100));
    write(KEYS.real.positions, positions);

    if (Number.isFinite(Number(settled.balance))) {
      const cacheKey = fundingSource === 'real' ? 'tradezoraRealLastBalance' : 'tradezoraSandboxLastBalance';
      localStorage.setItem(cacheKey, String(Number(settled.balance)));
    }

    const state = getState('real');
    let sessionState = state;
    let tradePnl = finalTrade.win ? finalTrade.profit : -Number(finalTrade.stake || 0);
    if (finalTrade.mode === 'AUTO' && finalTrade.autoSessionId && finalTrade.autoSessionId === state.sessionId) {
      sessionState = updateSessionAfterSettlement('real', state, finalTrade, finalTrade.win, finalTrade.profit, now).state;
      write(KEYS.real.state, sessionState);
    }

    localStorage.setItem('tradezoraLastDigitResult', JSON.stringify({ digit: finalTrade.finalDigit, win: finalTrade.win, at: now }));
    window.dispatchEvent(new CustomEvent('tradezora-trade-settled', {
      detail: {
        digit: finalTrade.finalDigit, win: finalTrade.win, profit: finalTrade.profit,
        stake: finalTrade.stake, tradePnl,
        sessionPnl: sessionState.sessionPnl,
        sessionWins: sessionState.sessionWins,
        sessionLosses: sessionState.sessionLosses,
        sessionTrades: sessionState.sessionTrades,
        mode: finalTrade.mode, autoSessionId: finalTrade.autoSessionId,
        accountMode: 'real', sandboxOnly: finalTrade.sandboxOnly, fundingSource
      }
    }));
    emit();
    return true;
  }

  function stopState(mode, reason, now) {
    const keys = keysFor(mode);
    const state = getState(mode);
    const stopped = { ...state, running: false, nextTradeAt: null, stoppedReason: reason, stoppedAt: now || Date.now() };
    if (reason === 'take-profit' || reason === 'stop-loss' || reason === 'consecutive-losses') {
      const trades = Number(stopped.sessionTrades || 0);
      stopped.lastSessionResult = {
        sessionPnl: Number(stopped.sessionPnl || 0),
        sessionTrades: trades,
        sessionWins: Number(stopped.sessionWins || 0),
        sessionLosses: Number(stopped.sessionLosses || 0),
        winRate: trades > 0 ? Math.round((Number(stopped.sessionWins || 0) / trades) * 100) : 0
      };
    }
    write(keys.state, stopped);
    emit();
    return stopped;
  }

  async function tick() {
    if (busy || !acquireLeaderLock()) return;
    busy = true;
    const mode = getMode();
    try {
      const keys = keysFor(mode);
      const now = Date.now();
      if (mode === 'demo') {
        const positions = read(keys.positions, []);
        const remaining = [];
        let changed = false;
        for (const position of positions) {
          if (position.settleAt && Number(position.settleAt) <= now) {
            const settled = await settleDemoPosition(position, now);
            if (settled === false) remaining.push({ ...position, settleAt: now + 1200 });
            changed = true;
          } else remaining.push(position);
        }
        if (changed) write(keys.positions, remaining);

        let state = getState('demo');
        if (state.running && String(state.mode || '').toUpperCase() === 'MANUAL') {
          write(keys.state, { ...state, running: false, nextTradeAt: null });
          state = getState('demo');
          changed = true;
        }
        if (state.running && Number(state.nextTradeAt || 0) <= now) {
          await openDemoTrade(state, now);
          changed = true;
        }
        if (changed) emit();
      } else {
        const positions = read(keys.positions, []);
        const due = positions.find(position => position.continuous && Number(position.settleAt || 0) <= now);
        if (due) {
          try {
            await settleRealPosition(due, now);
          } catch (error) {
            const latest = read(keys.positions, []);
            const index = latest.findIndex(item => item.id === due.id);
            if (index >= 0) {
              latest[index] = { ...latest[index], settleAt: now + 1500 };
              write(keys.positions, latest);
            }
            emitError(error.message, 'real');
          }
        }

        const state = getState('real');
        const stillHasAutoPosition = read(keys.positions, []).some(position => position.continuous && position.mode === 'AUTO');
        if (state.running && !stillHasAutoPosition && Number(state.nextTradeAt || 0) <= now) {
          try {
            await openRealTrade(state, now);
          } catch (error) {
            stopState('real', /fund|balance|stake/i.test(error.message) ? 'balance' : 'api-error', now);
            emitError(error.message, 'real');
          }
        }
      }
    } catch (error) {
      emitError(error.message || 'AUTO engine tick failed.', mode);
    } finally {
      busy = false;
    }
  }

  const api = {
    getState,
    start(config = {}) {
      const mode = getMode(config.accountMode);
      const keys = keysFor(mode);
      const stake = Number(config.stake || 1);
      const state = {
        running: true,
        accountMode: mode,
        type: String(config.type || 'MATCH').toUpperCase(),
        contract: String(config.contract || 'match').toLowerCase(),
        digit: Number(config.digit ?? 0),
        stake,
        baseStake: Number(config.baseStake ?? stake),
        currentStake: stake,
        multiplier: Math.min(10, Math.max(1, Number(config.multiplier || 1))),
        recoveryStep: 0,
        recoveryPending: false,
        maxConsecutiveLosses: Number(config.maxConsecutiveLosses || 6),
        consecutiveLosses: 0,
        takeProfit: Number(config.takeProfit || 0),
        stopLoss: Number(config.stopLoss || 0),
        sessionPnl: 0,
        sessionWins: 0,
        sessionLosses: 0,
        sessionTrades: 0,
        mode: 'AUTO',
        market: config.market || null,
        sessionId: `${mode}-auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        nextTradeAt: Date.now(),
        stoppedReason: null,
        stoppedAt: null,
        lastSessionResult: null
      };
      write(keys.state, state);
      tick();
      emit();
      return getState(mode);
    },
    stop(requestedMode) {
      const mode = getMode(requestedMode);
      const state = getState(mode);
      write(keysFor(mode).state, { ...state, running: false, nextTradeAt: null, stoppedReason: 'user', stoppedAt: Date.now() });
      emit();
    },
    reset(requestedMode) {
      localStorage.removeItem(keysFor(requestedMode).state);
      emit();
    },
    resetSession(requestedMode) {
      const mode = getMode(requestedMode);
      const state = getState(mode);
      write(keysFor(mode).state, {
        ...state, sessionPnl: 0, sessionWins: 0, sessionLosses: 0,
        sessionTrades: 0, consecutiveLosses: 0, recoveryStep: 0,
        recoveryPending: false, stoppedReason: null, stoppedAt: null,
        lastSessionResult: null
      });
      emit();
    },
    updateRisk(takeProfit, stopLoss, requestedMode) {
      const mode = getMode(requestedMode);
      const state = getState(mode);
      write(keysFor(mode).state, {
        ...state,
        takeProfit: Number.isFinite(Number(takeProfit)) && Number(takeProfit) > 0 ? Number(takeProfit) : 0,
        stopLoss: Number.isFinite(Number(stopLoss)) && Number(stopLoss) > 0 ? Number(stopLoss) : 0
      });
      emit();
    },
    tick
  };

  window.TradeZoraContinuousEngine = api;

  if (!intervalId) intervalId = window.setInterval(tick, TICK_MS);
  window.addEventListener('pagehide', () => { if (!busy) releaseLeaderLock(); });
  window.addEventListener('storage', event => {
    if (event.key === 'tradezoraAccountMode' || event.key === KEYS.demo.state || event.key === KEYS.real.state) tick();
  });
  tick();
})();
