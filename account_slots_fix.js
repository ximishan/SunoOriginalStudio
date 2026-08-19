(() => {
  const SLOTS = ['1', '2', '3'];
  let refreshGeneration = 0;

  // renderer.js may already have an old refresh in flight. Replace the whole
  // container so that any late append from the old refresh goes to a detached
  // node and can never duplicate/reorder the visible three account slots.
  const oldRoot = document.getElementById('accounts');
  if (!oldRoot) return;
  const root = oldRoot.cloneNode(false);
  oldRoot.replaceWith(root);

  function renderFixedSlots() {
    root.innerHTML = SLOTS.map(slot => `
      <div class="account" id="account-slot-${slot}" data-slot="${slot}">
        <div>
          <span class="dot" data-role="dot"></span>账号 ${slot}
          <div class="small" data-role="state">检测中…</div>
        </div>
        <button class="secondary" data-role="button">登录</button>
      </div>
    `).join('');

    for (const slot of SLOTS) {
      const row = document.getElementById(`account-slot-${slot}`);
      const button = row?.querySelector('[data-role="button"]');
      if (!button) continue;
      button.onclick = async () => {
        try {
          await window.demoApi.openLogin(slot);
          if (typeof log === 'function') log(`已打开 Suno 账号 ${slot} 登录窗口。`);
        } catch (error) {
          if (typeof log === 'function') log(error?.message || String(error), 'err');
        }
      };
    }
  }

  function updateOneSlot(slot, state, generation) {
    if (generation !== refreshGeneration) return;
    const row = document.getElementById(`account-slot-${slot}`);
    if (!row) return;

    const loggedIn = Boolean(state?.loggedIn);
    const verificationActive = Boolean(state?.verificationActive);
    const dot = row.querySelector('[data-role="dot"]');
    const text = row.querySelector('[data-role="state"]');
    const button = row.querySelector('[data-role="button"]');

    if (dot) dot.classList.toggle('ok', loggedIn);
    if (text) text.textContent = verificationActive ? '待验证' : (loggedIn ? '已登录' : '未登录');
    if (button) button.textContent = loggedIn ? '打开' : '登录';
  }

  async function refreshFixedAccounts() {
    const generation = ++refreshGeneration;
    renderFixedSlots();

    await Promise.all(SLOTS.map(async slot => {
      let state;
      try {
        state = await window.demoApi.accountStatus(slot);
      } catch {
        state = { loggedIn: false, verificationActive: false };
      }
      updateOneSlot(slot, state, generation);
    }));
  }

  // Replace all later calls to the old refreshAccounts implementation.
  try { window.refreshAccounts = refreshFixedAccounts; } catch {}
  try { refreshAccounts = refreshFixedAccounts; } catch {}

  const refreshButton = document.getElementById('refreshAccounts');
  if (refreshButton) refreshButton.onclick = refreshFixedAccounts;

  // Show all three slots immediately, then update each status independently.
  refreshFixedAccounts();
})();
