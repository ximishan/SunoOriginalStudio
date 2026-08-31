(() => {
  if (window.__sunoLibrarySyncInstalled) return;
  window.__sunoLibrarySyncInstalled = true;

  const $ = id => document.getElementById(id);

  function ensureUi() {
    const refresh = $('libraryRefresh');
    if (!refresh || $('librarySyncSuno')) return;
    const actions = refresh.parentElement;
    if (!actions) return;

    const slot = document.createElement('select');
    slot.id = 'librarySyncSlot';
    slot.style.width = '110px';
    slot.innerHTML = '<option value="1">同步账号1</option><option value="2">同步账号2</option><option value="3">同步账号3</option>';

    const limit = document.createElement('select');
    limit.id = 'librarySyncLimit';
    limit.style.width = '120px';
    limit.innerHTML = '<option value="20">最近20个</option><option value="50" selected>最近50个</option><option value="100">最近100个</option><option value="200">最近200个</option>';

    const btn = document.createElement('button');
    btn.id = 'librarySyncSuno';
    btn.className = 'secondary';
    btn.textContent = '同步 Suno 歌曲';

    const status = document.createElement('span');
    status.id = 'librarySyncStatus';
    status.className = 'small';
    status.style.marginLeft = '4px';

    refresh.insertAdjacentElement('afterend', slot);
    slot.insertAdjacentElement('afterend', limit);
    limit.insertAdjacentElement('afterend', btn);
    btn.insertAdjacentElement('afterend', status);

    btn.onclick = async () => {
      btn.disabled = true;
      slot.disabled = true;
      limit.disabled = true;
      status.textContent = '正在读取 Suno 最新作品，多轮检查缺失歌曲……';
      status.className = 'small warn';
      try {
        const result = await window.demoApi.syncSunoSongs({
          slot: slot.value,
          limit: Number(limit.value || 50),
          rounds: 6,
          waitMs: 4000,
          stopAfterStableRounds: 3,
        });
        status.textContent = `账号${result.slot}：扫描${result.scanned}个，执行${result.rounds || 1}轮，补回${result.imported}个。`;
        status.className = result.imported ? 'small oktxt' : 'small';

        // Force the visible library to reload after the backend has written recovered clips.
        try {
          const tab = $('tabLibrary');
          if (tab) tab.click();
          await new Promise(resolve => setTimeout(resolve, 150));
          if ($('libraryRefresh') && !$('libraryRefresh').disabled) $('libraryRefresh').click();
        } catch {}
      } catch (e) {
        status.textContent = e?.message || String(e);
        status.className = 'small err';
      } finally {
        btn.disabled = false;
        slot.disabled = false;
        limit.disabled = false;
      }
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureUi, { once: true });
  else ensureUi();
  setTimeout(ensureUi, 500);
})();
