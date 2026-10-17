document.addEventListener('DOMContentLoaded', () => {
  const $ = (s) => document.querySelector(s);
  const user = JSON.parse(localStorage.getItem('tradezoraDemoUser') || 'null');
  if (!user) { location.href = 'auth.html'; return; }

  const money = (v) => '$' + Number(v || 0).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
  const balanceEl = $('#balance');
  const nameEl = $('#profileName');
  const emailEl = $('#profileEmail');
  const avatarEl = $('#avatar');
  if (nameEl) nameEl.textContent = user.name || 'Demo Trader';
  if (emailEl) emailEl.textContent = user.email || 'demo@tradezora.local';
  if (avatarEl) avatarEl.textContent = (user.name || 'T')[0].toUpperCase();

  function load() {
    return {
      positions: JSON.parse(localStorage.getItem('tradezoraDemoPositions') || '[]'),
      history: JSON.parse(localStorage.getItem('tradezoraDemoHistory') || '[]')
    };
  }

  function render() {
    const {positions, history} = load();
    if (balanceEl) balanceEl.textContent = money(localStorage.getItem('tradezoraDemoBalance') || 10000);

    const positionsList = $('#positionsList');
    if (positionsList) {
      positionsList.innerHTML = positions.length ? positions.map(p => `
        <div class="position position-page-item">
          <div><strong>${p.type}</strong><span>${String(p.contract || 'CONTRACT').toUpperCase()} • digit ${p.digit} • ${money(p.stake)}</span></div>
          <strong class="open-status">OPEN</strong>
        </div>`).join('') : '<div class="empty">No open positions.</div>';
    }

    const historyList = $('#historyList');
    if (historyList) {
      historyList.innerHTML = history.length ? history.slice().reverse().map(t => `
        <div class="history-item history-page-item">
          <div><strong>${t.type}</strong><span>${String(t.contract || 'CONTRACT').toUpperCase()} • digit ${t.digit} → ${t.finalDigit}</span><small>${new Date(t.settledAt || Date.now()).toLocaleTimeString()}</small></div>
          <strong class="${t.win ? 'win' : 'loss'}">${t.win ? 'WIN +' + money(t.profit) : 'LOSS -' + money(t.stake)}</strong>
        </div>`).join('') : '<div class="empty">No trades yet.</div>';
    }
  }

  render();
  window.addEventListener('tradezora-state-changed', render);
  window.addEventListener('storage', render);

  $('#clearPositions')?.addEventListener('click', () => {
    localStorage.setItem('tradezoraDemoPositions', '[]');
    render();
  });

  const menuBtn = $('#menuBtn'), closeMenu = $('#closeMenu'), sideMenu = $('#sideMenu'), overlay = $('#overlay');
  const openMenu = () => { sideMenu?.classList.add('open'); overlay?.classList.add('show'); };
  const close = () => { sideMenu?.classList.remove('open'); overlay?.classList.remove('show'); };
  menuBtn?.addEventListener('click', openMenu);
  closeMenu?.addEventListener('click', close);
  overlay?.addEventListener('click', close);
  $('#logout')?.addEventListener('click', () => { localStorage.removeItem('tradezoraDemoUser'); location.href = 'auth.html'; });
});
