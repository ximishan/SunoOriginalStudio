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

    const debug = document.createElement('pre');
    debug.id = 'librarySyncDebug';
    debug.style.cssText = [
      'display:none',
      'width:100%',
      'max-height:360px',
      'overflow:auto',
      'white-space:pre-wrap',
      'word-break:break-all',
      'margin:10px 0 0',
      'padding:10px 12px',
      'border:1px solid rgba(255,255,255,.12)',
      'border-radius:8px',
      'background:rgba(0,0,0,.28)',
      'font-size:12px',
      'line-height:1.5',
      'color:rgba(255,255,255,.86)'
    ].join(';');

    refresh.insertAdjacentElement('afterend', slot);
    slot.insertAdjacentElement('afterend', limit);
    limit.insertAdjacentElement('afterend', btn);
    btn.insertAdjacentElement('afterend', status);
    actions.insertAdjacentElement('afterend', debug);

    btn.onclick = async () => {
      btn.disabled = true;
      slot.disabled = true;
      limit.disabled = true;
      status.textContent = '正在读取 Suno 最新作品，多轮检查缺失歌曲……';
      status.className = 'small warn';
      debug.style.display = 'block';
      debug.textContent = `开始同步\n账号：${slot.value}\n范围：最近${limit.value}个\n`;
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
        const lines = Array.isArray(result.diagnostics) ? result.diagnostics : [];
        debug.textContent = lines.length ? lines.join('\n') : '同步完成，但后端没有返回诊断日志。';
        console.log('[Suno同步诊断]\n' + debug.textContent);

        try {
          const tab = $('tabLibrary');
          if (tab) tab.click();
          await new Promise(resolve => setTimeout(resolve, 150));
          if ($('libraryRefresh') && !$('libraryRefresh').disabled) $('libraryRefresh').click();
        } catch {}
      } catch (e) {
        const message = e?.message || String(e);
        status.textContent = message.split('\n')[0];
        status.className = 'small err';
        debug.textContent = message;
        console.error('[Suno同步失败]', e);
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
