const $ = (id) => document.getElementById(id);
let currentTask = null;
let selectedDeaiFiles = [];
let deaiOutputDir = '';
let deaiRunning = false;
let songLibrary = { songs: [], rootDir: '' };
let selectedSongIds = new Set();
let libraryBusy = false;

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

function appendLog(id, text, cls = '') {
  const box = $(id);
  if (!box) return;
  const time = new Date().toLocaleTimeString();
  box.innerHTML += `\n<span class="${cls}">[${time}] ${escapeHtml(String(text))}</span>`;
  box.scrollTop = box.scrollHeight;
}
function log(text, cls = '') { appendLog('log', text, cls); }
function deaiLog(text, cls = '') { appendLog('deaiLog', text, cls); }
function libraryLog(text, cls = '') { appendLog('libraryLog', text, cls); }

function switchView(view) {
  const views = ['original', 'library', 'deai'];
  for (const name of views) {
    $(`${name}View`).classList.toggle('hidden', name !== view);
    const tabId = name === 'original' ? 'tabOriginal' : name === 'library' ? 'tabLibrary' : 'tabDeai';
    $(tabId).classList.toggle('active', name === view);
  }
  if (view === 'library') loadSongLibrary(false);
}

$('tabOriginal').onclick = () => switchView('original');
$('tabLibrary').onclick = () => switchView('library');
$('tabDeai').onclick = () => switchView('deai');

async function refreshAccounts() {
  const root = $('accounts');
  root.innerHTML = '';
  for (const slot of ['1','2','3']) {
    let st;
    try { st = await window.demoApi.accountStatus(slot); }
    catch { st = { loggedIn:false }; }
    const div = document.createElement('div');
    div.className = 'account';
    const stateText = st.verificationActive ? '待验证' : (st.loggedIn ? '已登录' : '未登录');
    div.innerHTML = `<div><span class="dot ${st.loggedIn ? 'ok' : ''}"></span>账号 ${slot}<div class="small">${stateText}</div></div><button class="secondary">${st.loggedIn ? '打开' : '登录'}</button>`;
    div.querySelector('button').onclick = async () => {
      await window.demoApi.openLogin(slot);
      log(`已打开 Suno 账号 ${slot} 登录窗口。`);
    };
    root.appendChild(div);
  }
}

function renderTask(task) {
  const root = $('taskArea');
  if (!task) { root.innerHTML = '还没有提交任务。'; return; }
  const tracks = task.tracks || task.clipIds?.map(id => ({id,status:'submitted',url:`https://suno.com/song/${id}`})) || [];
  root.innerHTML = `<div><b>${escapeHtml(task.title || '未命名')}</b></div><div class="small">账号 ${escapeHtml(String(task.slot || ''))} · ${escapeHtml(task.submittedAt || '')}</div>` + tracks.map((t, i) => `
    <div class="track">
      <div><div>版本 ${i+1}</div><div class="status ${t.status === 'complete' ? 'oktxt' : t.status === 'error' ? 'err' : ''}">${escapeHtml(t.status || 'submitted')} ${t.duration ? `· ${Number(t.duration).toFixed(1)}s` : ''}</div>${t.error ? `<div class="small err">${escapeHtml(t.error)}</div>` : ''}</div>
      <button class="secondary" data-url="${escapeHtml(t.url)}">打开</button>
    </div>`).join('');
  root.querySelectorAll('button[data-url]').forEach(btn => btn.onclick = () => window.demoApi.openSong(btn.dataset.url));
}

$('refreshAccounts').onclick = refreshAccounts;

if (window.demoApi.onVerificationState) {
  window.demoApi.onVerificationState((state) => {
    const msg = state?.message || '';
    if (state?.state === 'required') {
      log(`检测到账号 ${state.slot} 需要 Suno 人机验证：${msg}`, 'err');
      refreshAccounts();
    } else if (state?.state === 'waiting') {
      log(msg || '等待人机验证完成……');
    } else if (state?.state === 'passed') {
      log(msg || '人机验证已通过，正在自动继续。', 'oktxt');
      refreshAccounts();
    }
  });
}

$('submitBtn').onclick = async () => {
  const payload = {
    title: $('title').value,
    lyrics: $('lyrics').value,
    stylePrompt: $('style').value,
    negativeStyle: $('negativeStyle').value,
    slot: $('slot').value,
    modelVersion: $('model').value,
    vocalGender: $('gender').value,
    weirdness: Number($('weirdness').value),
    styleInfluence: Number($('styleInfluence').value),
  };
  $('submitBtn').disabled = true;
  try {
    log(`开始提交：${payload.title || '未填写歌名'} / 账号 ${payload.slot}`);
    currentTask = await window.demoApi.submitOriginal(payload);
    renderTask(currentTask);
    $('refreshTaskBtn').disabled = false;
    await window.demoApi.saveSongSubmission({ task: currentTask, input: payload });
    log(`提交成功，${currentTask.clipIds.length} 个版本已加入歌曲列表。`, 'oktxt');
    await loadSongLibrary(false);
    switchView('library');
  } catch (e) {
    log(e?.message || e, 'err');
    alert(e?.message || String(e));
  } finally {
    $('submitBtn').disabled = false;
  }
};

$('refreshTaskBtn').onclick = async () => {
  if (!currentTask) return;
  $('refreshTaskBtn').disabled = true;
  try {
    log('正在刷新任务状态……');
    currentTask = await window.demoApi.refreshTask(currentTask);
    renderTask(currentTask);
    const allDone = (currentTask.tracks || []).every(t => /^(complete|completed)$/i.test(t.status || ''));
    log(allDone ? '当前任务的所有版本都已完成。' : '任务状态已刷新。', allDone ? 'oktxt' : '');
    await loadSongLibrary(true);
  } catch (e) {
    log(e?.message || e, 'err');
  } finally {
    $('refreshTaskBtn').disabled = false;
  }
};

function generationBadge(status) {
  const raw = String(status || 'submitted').toLowerCase();
  if (raw === 'complete' || raw === 'completed') return ['已生成', 'ok'];
  if (raw === 'error' || raw === 'failed') return ['生成失败', 'err'];
  return [raw === 'submitted' ? '已提交' : raw, 'warn'];
}
function wavBadge(status) {
  const map = {
    not_downloaded: ['未下载', ''], downloading: ['下载中', 'warn'], downloaded: ['已下载', 'ok'], error: ['下载失败', 'err'],
  };
  return map[status] || [status || '未下载', ''];
}
function deaiBadge(status) {
  const map = {
    not_processed: ['未处理', ''], waiting: ['等待处理', 'warn'], processing: ['处理中', 'warn'], complete: ['已完成', 'ok'], error: ['处理失败', 'err'],
  };
  return map[status] || [status || '未处理', ''];
}
function localBadge(status) {
  const map = {
    not_saved: ['未保存', ''], saving: ['保存中', 'warn'], saved: ['已保存', 'ok'], error: ['保存失败', 'err'],
  };
  return map[status] || [status || '未保存', ''];
}
function badgeHtml(pair) {
  return `<span class="badge ${pair[1] || ''}">${escapeHtml(pair[0])}</span>`;
}
function isSongComplete(song) {
  return /^(complete|completed)$/i.test(String(song.generationStatus || ''));
}

function renderSongLibrary() {
  const songs = songLibrary.songs || [];
  $('libraryRoot').textContent = songLibrary.rootDir || '未设置';
  $('libraryCount').textContent = `${songs.length} 首`;
  const body = $('songTableBody');
  if (!songs.length) {
    body.innerHTML = '<tr><td colspan="8" class="library-empty">还没有歌曲。提交原创后会自动出现在这里。</td></tr>';
    return;
  }
  body.innerHTML = songs.map(song => {
    const canSelect = isSongComplete(song) && song.deaiStatus !== 'processing';
    const checked = selectedSongIds.has(song.clipId) ? 'checked' : '';
    const g = generationBadge(song.generationStatus);
    const w = wavBadge(song.wavStatus);
    const d = deaiBadge(song.deaiStatus);
    const l = localBadge(song.localStatus);
    const err = song.lastError ? `<div class="small err" style="margin-top:4px;max-width:260px">${escapeHtml(song.lastError)}</div>` : '';
    return `<tr>
      <td><input class="check song-check" type="checkbox" data-clip="${escapeHtml(song.clipId)}" ${checked} ${canSelect ? '' : 'disabled'} /></td>
      <td class="title-cell"><b>${escapeHtml(song.title || '未命名')}</b><div class="small">版本 ${song.version || 1} · ${escapeHtml(String(song.clipId).slice(0,8))}${song.duration ? ` · ${Number(song.duration).toFixed(1)}s` : ''}</div>${err}</td>
      <td>账号 ${escapeHtml(song.slot)}</td>
      <td>${badgeHtml(g)}</td>
      <td>${badgeHtml(w)}</td>
      <td>${badgeHtml(d)}</td>
      <td>${badgeHtml(l)}</td>
      <td><div class="inline-actions"><button class="secondary" data-open-suno="${escapeHtml(song.clipId)}">Suno</button>${song.localDir ? `<button class="secondary" data-open-local="${escapeHtml(song.clipId)}">本地</button>` : ''}</div></td>
    </tr>`;
  }).join('');

  body.querySelectorAll('.song-check').forEach(box => {
    box.onchange = () => {
      if (box.checked) selectedSongIds.add(box.dataset.clip);
      else selectedSongIds.delete(box.dataset.clip);
      syncMasterCheck();
    };
  });
  body.querySelectorAll('[data-open-suno]').forEach(btn => btn.onclick = () => window.demoApi.openSong(`https://suno.com/song/${btn.dataset.openSuno}`));
  body.querySelectorAll('[data-open-local]').forEach(btn => btn.onclick = async () => {
    try { await window.demoApi.openSongLocalDir(btn.dataset.openLocal); }
    catch (e) { libraryLog(e?.message || e, 'err'); }
  });
  syncMasterCheck();
}

function syncMasterCheck() {
  const enabled = [...document.querySelectorAll('.song-check:not(:disabled)')];
  const checked = enabled.filter(x => x.checked);
  $('libraryMasterCheck').checked = enabled.length > 0 && checked.length === enabled.length;
  $('libraryMasterCheck').indeterminate = checked.length > 0 && checked.length < enabled.length;
}

async function loadSongLibrary(refreshFromSuno = false) {
  try {
    songLibrary = refreshFromSuno ? await window.demoApi.refreshSongLibrary() : await window.demoApi.listSongs();
    const existingIds = new Set((songLibrary.songs || []).map(x => x.clipId));
    selectedSongIds = new Set([...selectedSongIds].filter(id => existingIds.has(id)));
    renderSongLibrary();
  } catch (e) {
    libraryLog(e?.message || e, 'err');
  }
}

$('libraryRefresh').onclick = async () => {
  if (libraryBusy) return;
  libraryBusy = true;
  $('libraryRefresh').disabled = true;
  try {
    libraryLog('正在刷新所有歌曲的 Suno 状态……');
    await loadSongLibrary(true);
    libraryLog('歌曲状态已刷新。', 'oktxt');
  } finally {
    libraryBusy = false;
    $('libraryRefresh').disabled = false;
  }
};

$('librarySelectAll').onclick = () => {
  selectedSongIds.clear();
  for (const song of songLibrary.songs || []) {
    if (isSongComplete(song) && song.deaiStatus !== 'processing') selectedSongIds.add(song.clipId);
  }
  renderSongLibrary();
};

$('libraryMasterCheck').onchange = () => {
  const checked = $('libraryMasterCheck').checked;
  document.querySelectorAll('.song-check:not(:disabled)').forEach(box => {
    box.checked = checked;
    if (checked) selectedSongIds.add(box.dataset.clip);
    else selectedSongIds.delete(box.dataset.clip);
  });
};

$('libraryChooseRoot').onclick = async () => {
  try {
    songLibrary = await window.demoApi.selectSongRoot();
    renderSongLibrary();
    libraryLog(`保存目录：${songLibrary.rootDir}`, 'oktxt');
  } catch (e) {
    libraryLog(e?.message || e, 'err');
  }
};

$('libraryOpenRoot').onclick = async () => {
  try { await window.demoApi.openSongRoot(); }
  catch (e) { libraryLog(e?.message || e, 'err'); }
};

$('libraryProcessSelected').onclick = async () => {
  if (libraryBusy) return;
  const ids = [...selectedSongIds];
  if (!ids.length) {
    alert('请先勾选至少一首已经生成完成的歌曲。');
    return;
  }
  libraryBusy = true;
  $('libraryProcessSelected').disabled = true;
  $('libraryRefresh').disabled = true;
  try {
    libraryLog(`开始处理 ${ids.length} 首歌曲：先从 Suno 获取 WAV，再执行 AVR N19。`);
    const result = await window.demoApi.processSelectedSongs(ids);
    await loadSongLibrary(false);
    const failed = (result.results || []).filter(x => !x.ok);
    libraryLog(`处理完成：成功 ${result.successCount}/${result.total}${failed.length ? `，失败 ${failed.length}` : ''}。`, failed.length ? 'warn' : 'oktxt');
    selectedSongIds.clear();
    renderSongLibrary();
  } catch (e) {
    libraryLog(e?.message || e, 'err');
  } finally {
    libraryBusy = false;
    $('libraryProcessSelected').disabled = false;
    $('libraryRefresh').disabled = false;
  }
};

if (window.demoApi.onSongLibraryChanged) {
  window.demoApi.onSongLibraryChanged((event) => {
    if (!event) return;
    if (event.type === 'progress' && event.message) libraryLog(`${String(event.clipId || '').slice(0,8)}：${event.message}`);
    if (event.type === 'song-updated' && event.song) {
      const index = (songLibrary.songs || []).findIndex(x => x.clipId === event.song.clipId);
      if (index >= 0) songLibrary.songs[index] = event.song;
      else songLibrary.songs.unshift(event.song);
      renderSongLibrary();
    }
  });
}

function renderDeaiFiles() {
  const root = $('deaiFiles');
  if (!selectedDeaiFiles.length) {
    root.innerHTML = '<div class="small" style="padding:10px">尚未选择音频文件。</div>';
    return;
  }
  root.innerHTML = selectedDeaiFiles.map((file, i) => `<div class="file-row"><span>${i + 1}. ${escapeHtml(file)}</span></div>`).join('');
}

function setDeaiRunning(running) {
  deaiRunning = running;
  $('deaiStart').disabled = running || !selectedDeaiFiles.length;
  $('deaiCancel').disabled = !running;
  $('deaiSelectFiles').disabled = running;
  $('deaiSelectOutput').disabled = running;
}

$('deaiSelectFiles').onclick = async () => {
  try {
    const files = await window.demoApi.selectDeaiFiles();
    if (files?.length) {
      selectedDeaiFiles = files;
      renderDeaiFiles();
      setDeaiRunning(false);
      deaiLog(`已选择 ${files.length} 个音频文件。`);
    }
  } catch (e) {
    deaiLog(e?.message || e, 'err');
  }
};

$('deaiSelectOutput').onclick = async () => {
  try {
    const dir = await window.demoApi.selectDeaiOutputDir();
    if (dir) {
      deaiOutputDir = dir;
      $('deaiOutput').textContent = dir;
      $('deaiOpenOutput').disabled = false;
      deaiLog(`输出目录：${dir}`);
    }
  } catch (e) {
    deaiLog(e?.message || e, 'err');
  }
};

$('deaiStart').onclick = async () => {
  if (!selectedDeaiFiles.length || deaiRunning) return;
  setDeaiRunning(true);
  try {
    deaiLog(`开始 N19 AI 消痕，共 ${selectedDeaiFiles.length} 个文件。`);
    const result = await window.demoApi.processDeai({ files: selectedDeaiFiles, outputDir: deaiOutputDir });
    deaiOutputDir = result.outputDir || deaiOutputDir;
    $('deaiOutput').textContent = deaiOutputDir || '未设置（默认在源文件旁创建 AI消痕输出）';
    $('deaiOpenOutput').disabled = !deaiOutputDir;
    const failed = (result.results || []).filter(x => !x.ok);
    deaiLog(`处理完成：成功 ${result.successCount}/${result.total}${failed.length ? `，失败 ${failed.length}` : ''}。`, failed.length ? 'warn' : 'oktxt');
  } catch (e) {
    deaiLog(e?.message || e, 'err');
  } finally {
    setDeaiRunning(false);
  }
};

$('deaiCancel').onclick = async () => {
  try {
    await window.demoApi.cancelDeai();
    deaiLog('已请求取消当前 AI 消痕任务。', 'warn');
  } catch (e) {
    deaiLog(e?.message || e, 'err');
  }
};

$('deaiOpenOutput').onclick = async () => {
  try { await window.demoApi.openDeaiOutputDir(deaiOutputDir); }
  catch (e) { deaiLog(e?.message || e, 'err'); }
};

if (window.demoApi.onDeaiProgress) {
  window.demoApi.onDeaiProgress((state) => {
    if (!state) return;
    const cls = state.state === 'file-error' ? 'err' : state.state === 'complete' || state.state === 'file-complete' ? 'oktxt' : state.state === 'cancelled' ? 'warn' : '';
    if (state.message) deaiLog(state.message, cls);
  });
}

async function loadDeaiEngineInfo() {
  try {
    const info = await window.demoApi.getDeaiEngineInfo();
    $('deaiEngine').textContent = info.ready ? `内置引擎已就绪：${info.engine}` : `内置引擎异常：${info.error || '未知错误'}`;
    $('deaiEngine').className = info.ready ? 'small oktxt' : 'small err';
  } catch (e) {
    $('deaiEngine').textContent = `内置引擎异常：${e?.message || e}`;
    $('deaiEngine').className = 'small err';
  }
}

setInterval(async () => {
  if (libraryBusy) return;
  const pending = (songLibrary.songs || []).some(song => !isSongComplete(song) && !/^(error|failed)$/i.test(song.generationStatus || ''));
  if (pending) await loadSongLibrary(true);
}, 10000);

refreshAccounts();
renderDeaiFiles();
setDeaiRunning(false);
loadDeaiEngineInfo();
loadSongLibrary(false);
