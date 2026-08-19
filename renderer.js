const $ = (id) => document.getElementById(id);
let currentTask = null;
let selectedDeaiFiles = [];
let deaiOutputDir = '';
let deaiRunning = false;

function log(text, cls = '') {
  const box = $('log');
  const time = new Date().toLocaleTimeString();
  box.innerHTML += `\n<span class="${cls}">[${time}] ${escapeHtml(String(text))}</span>`;
  box.scrollTop = box.scrollHeight;
}

function deaiLog(text, cls = '') {
  const box = $('deaiLog');
  const time = new Date().toLocaleTimeString();
  box.innerHTML += `\n<span class="${cls}">[${time}] ${escapeHtml(String(text))}</span>`;
  box.scrollTop = box.scrollHeight;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

function switchView(view) {
  const original = view === 'original';
  $('originalView').classList.toggle('hidden', !original);
  $('deaiView').classList.toggle('hidden', original);
  $('tabOriginal').classList.toggle('active', original);
  $('tabDeai').classList.toggle('active', !original);
}

$('tabOriginal').onclick = () => switchView('original');
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
    log(`提交成功，返回 ${currentTask.clipIds.length} 个作品编号。`, 'oktxt');
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
    const allDone = (currentTask.tracks || []).every(t => t.status === 'complete');
    log(allDone ? '当前任务的所有版本都已完成。' : '任务状态已刷新。', allDone ? 'oktxt' : '');
  } catch (e) {
    log(e?.message || e, 'err');
  } finally {
    $('refreshTaskBtn').disabled = false;
  }
};

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
  try {
    await window.demoApi.openDeaiOutputDir(deaiOutputDir);
  } catch (e) {
    deaiLog(e?.message || e, 'err');
  }
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

refreshAccounts();
renderDeaiFiles();
setDeaiRunning(false);
loadDeaiEngineInfo();
