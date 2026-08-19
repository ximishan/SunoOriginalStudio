const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const path = require('path');
const { randomUUID } = require('crypto');
const { partitionFor, apiHeaders, getAccountStatus } = require('./suno_session');

const SUNO_HOME = 'https://suno.com/';
const SUNO_CREATE = 'https://suno.com/create';
const SUNO_STUDIO = 'https://suno.com/studio';
const SUNO_API = 'https://studio-api-prod.suno.com';
const VERIFICATION_TIMEOUT_MS = 300000;
const TURNSTILE_SITEKEY = '0x4AAAAAADI7xDNyj-3LcIbi';
const HCAPTCHA_SITEKEY = 'd65453de-3f1a-4aac-9366-a0f06e52b2ce';
const MODEL_MAP = {
  'v5.5': 'chirp-fenix',
  'v5': 'chirp-crow',
  'v4.5+': 'chirp-bluejay',
  'v4.5-all': 'chirp-bluejay',
};

let mainWindow;
const accountWindows = new Map();
const verificationActiveSlots = new Set();

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function emitVerification(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('verification:state', payload);
  }
}

function isAllowedAccountUrl(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    const allowed = new Set([
      'accounts.google.com', 'appleid.apple.com', 'discord.com',
      'login.live.com', 'account.live.com', 'signup.live.com',
      'login.microsoftonline.com', 'login.microsoft.com', 'account.microsoft.com'
    ]);
    return u.protocol === 'https:' && (
      h === 'suno.com' || h.endsWith('.suno.com') ||
      h.endsWith('.clerk.accounts.dev') || allowed.has(h)
    );
  } catch {
    return false;
  }
}

function configureNavigation(win, partition) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedAccountUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: {
            partition,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
          },
        },
      };
    }
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedAccountUrl(url)) {
      event.preventDefault();
      if (url.startsWith('https://')) shell.openExternal(url);
    }
  });
}

async function ensureAccountWindow(slot, show = false, target = SUNO_HOME) {
  slot = String(slot);
  let win = accountWindows.get(slot);
  if (win && !win.isDestroyed()) {
    if (target && !win.webContents.getURL().startsWith(target)) await win.loadURL(target);
    if (show) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.moveTop();
    }
    return win;
  }

  const partition = partitionFor(slot);
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    title: `Suno 账号 ${slot}`,
    autoHideMenuBar: true,
    show,
    backgroundColor: '#090a0f',
    webPreferences: {
      partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      backgroundThrottling: false,
    },
  });
  configureNavigation(win, partition);
  win.on('closed', () => accountWindows.delete(slot));
  accountWindows.set(slot, win);
  await win.loadURL(target);
  if (show) {
    win.show();
    win.focus();
    win.moveTop();
  }
  return win;
}

async function waitReady(win, timeoutMs = 30000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const ok = await win.webContents.executeJavaScript('document.readyState === "complete"');
      if (ok) return;
    } catch {}
    await sleep(300);
  }
  throw new Error('Suno 页面加载超时');
}

async function accountStatus(slot) {
  slot = String(slot);
  const shared = await getAccountStatus(slot);
  const win = accountWindows.get(slot);
  return {
    ...shared,
    windowOpen: !!(win && !win.isDestroyed()),
    verificationActive: verificationActiveSlots.has(slot),
  };
}

async function precheckVerification(slot, headers) {
  const ses = session.fromPartition(partitionFor(slot));
  try {
    const res = await ses.fetch(`${SUNO_API}/api/c/check`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ctype: 'generation' }),
    });
    if (!res.ok) return { known: false, required: false, httpStatus: res.status, captchaProvider: 2 };
    const data = await res.json().catch(() => ({}));
    const captchaProvider = Number(data.captcha_version) === 1 ? 1 : 2;
    return { known: true, required: !!data.required, captchaVersion: data.captcha_version, captchaProvider };
  } catch (e) {
    return { known: false, required: false, captchaProvider: 2, error: String(e?.message || e) };
  }
}

async function detectCaptchaProvider(slot, headers) {
  const check = await precheckVerification(slot, headers);
  return Number(check.captchaProvider) === 1 ? 1 : 2;
}

function buildTurnstileVerificationScript() {
  return `(() => new Promise((resolve, reject) => {
    const overlayId = '__suno_original_verification';
    document.getElementById(overlayId)?.remove();

    const overlay = document.createElement('div');
    overlay.id = overlayId;
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', zIndex: '2147483647',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: '14px', background: 'rgba(0,0,0,.80)',
      color: '#fff', fontFamily: 'system-ui, sans-serif'
    });

    const title = document.createElement('div');
    title.textContent = '请完成 Suno 官方 Cloudflare 人机验证';
    title.style.cssText = 'font-size:17px;font-weight:700';
    const status = document.createElement('div');
    status.textContent = '正在加载官方验证组件…';
    status.style.cssText = 'font-size:13px;color:rgba(255,255,255,.78)';
    const container = document.createElement('div');
    container.id = '__suno_original_turnstile';
    container.style.minHeight = '72px';

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:10px;margin-top:4px';
    const retryButton = document.createElement('button');
    retryButton.textContent = '重新加载验证';
    retryButton.style.cssText = 'display:none;padding:8px 14px;border:0;border-radius:8px;background:#5b6cff;color:#fff;cursor:pointer';
    const cancelButton = document.createElement('button');
    cancelButton.textContent = '取消当前任务';
    cancelButton.style.cssText = 'padding:8px 14px;border:1px solid #666;border-radius:8px;background:#242424;color:#fff;cursor:pointer';
    actions.append(retryButton, cancelButton);
    overlay.append(title, status, container, actions);
    document.body.appendChild(overlay);

    let widgetId;
    let settled = false;
    let retryCount = 0;
    let retryTimer;
    let timeoutTimer;

    const cleanup = () => {
      clearTimeout(retryTimer);
      clearTimeout(timeoutTimer);
      try { if (widgetId !== undefined && window.turnstile) window.turnstile.remove(widgetId); } catch {}
      overlay.remove();
    };
    const finish = (token, error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(new Error(error)); else resolve(token);
    };
    const armTimeout = () => {
      clearTimeout(timeoutTimer);
      timeoutTimer = setTimeout(() => finish(null, 'Suno 人机验证等待超过 5 分钟'), ${VERIFICATION_TIMEOUT_MS});
    };
    const retry = (reason) => {
      if (settled) return;
      retryCount += 1;
      if (retryCount > 3) {
        status.textContent = reason + '。请检查网络后点击“重新加载验证”。';
        retryButton.style.display = 'inline-block';
        return;
      }
      status.textContent = reason + '，自动重试 ' + retryCount + '/3…';
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        try {
          if (widgetId !== undefined && window.turnstile) {
            try { window.turnstile.remove(widgetId); } catch {}
            widgetId = undefined;
          }
          loadScript();
        } catch (error) { retry(error instanceof Error ? error.message : String(error)); }
      }, 1000 * retryCount);
    };
    const render = () => {
      try {
        status.textContent = '请在下方完成 Cloudflare 验证；通过后任务会自动继续。';
        retryButton.style.display = 'none';
        widgetId = window.turnstile.render('#__suno_original_turnstile', {
          sitekey: ${JSON.stringify(TURNSTILE_SITEKEY)},
          appearance: 'always',
          callback: value => finish(value),
          'error-callback': code => retry('验证组件出错：' + (code || 'unknown')),
          'expired-callback': () => retry('验证已过期'),
          'timeout-callback': () => retry('验证操作超时'),
          'unsupported-callback': () => finish(null, '当前环境不支持 Suno Cloudflare 验证'),
          'before-interactive-callback': () => { status.textContent = '请完成下方 Cloudflare 验证…'; },
          'after-interactive-callback': () => { status.textContent = '验证已提交，正在等待结果…'; },
        });
      } catch (error) { retry(error instanceof Error ? error.message : String(error)); }
    };
    const loadScript = () => {
      if (window.turnstile?.render) { render(); return; }
      document.querySelector('script[data-suno-original-turnstile]')?.remove();
      const script = document.createElement('script');
      script.dataset.sunoOriginalTurnstile = '1';
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.onload = render;
      script.onerror = () => retry('无法加载 Cloudflare 官方验证组件');
      document.head.appendChild(script);
    };
    retryButton.onclick = () => {
      retryCount = 0;
      retryButton.style.display = 'none';
      if (widgetId !== undefined && window.turnstile) {
        try { window.turnstile.remove(widgetId); } catch {}
        widgetId = undefined;
      }
      armTimeout();
      loadScript();
    };
    cancelButton.onclick = () => finish(null, '用户取消了 Suno 人机验证');
    armTimeout();
    loadScript();
  }))()`;
}

function buildHcaptchaVerificationScript() {
  return `(() => new Promise((resolve, reject) => {
    const overlayId = '__suno_original_verification';
    document.getElementById(overlayId)?.remove();

    const overlay = document.createElement('div');
    overlay.id = overlayId;
    Object.assign(overlay.style, {
      position: 'fixed', left: '50%', top: '18px', transform: 'translateX(-50%)',
      zIndex: '2147483647', display: 'flex', flexDirection: 'column',
      alignItems: 'center', gap: '10px', padding: '16px 22px',
      borderRadius: '14px', background: 'rgba(20,24,34,.97)', color: '#fff',
      fontFamily: 'system-ui, sans-serif', boxShadow: '0 12px 40px rgba(0,0,0,.45)',
      maxWidth: '92vw'
    });

    const title = document.createElement('div');
    title.textContent = '请完成 Suno 官方 hCaptcha 验证';
    title.style.cssText = 'font-size:16px;font-weight:700';
    const status = document.createElement('div');
    status.textContent = '正在加载官方验证组件…';
    status.style.cssText = 'font-size:13px;color:rgba(255,255,255,.78)';
    const container = document.createElement('div');
    container.id = '__suno_original_hcaptcha';

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:10px';
    const retryButton = document.createElement('button');
    retryButton.textContent = '重新加载验证';
    retryButton.style.cssText = 'display:none;padding:8px 14px;border:0;border-radius:8px;background:#5b6cff;color:#fff;cursor:pointer';
    const cancelButton = document.createElement('button');
    cancelButton.textContent = '取消当前任务';
    cancelButton.style.cssText = 'padding:8px 14px;border:1px solid #666;border-radius:8px;background:#242424;color:#fff;cursor:pointer';
    actions.append(retryButton, cancelButton);
    overlay.append(title, status, container, actions);
    document.body.appendChild(overlay);

    const env = 'prod';
    let widgetId;
    let settled = false;
    let retryCount = 0;
    let retryTimer;
    let timeoutTimer;

    const cleanup = () => {
      clearTimeout(retryTimer);
      clearTimeout(timeoutTimer);
      try { if (widgetId !== undefined && window.hcaptcha) window.hcaptcha.remove(widgetId); } catch {}
      overlay.remove();
      try { delete window.__sunoOriginalHcaptchaOnLoad; } catch {}
    };
    const finish = (token, error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(new Error(error)); else resolve(token);
    };
    const armTimeout = () => {
      clearTimeout(timeoutTimer);
      timeoutTimer = setTimeout(() => finish(null, 'Suno 人机验证等待超过 5 分钟'), ${VERIFICATION_TIMEOUT_MS});
    };
    const retry = (reason) => {
      if (settled) return;
      retryCount += 1;
      if (retryCount > 3) {
        status.textContent = reason + '。请检查网络后点击“重新加载验证”。';
        retryButton.style.display = 'inline-block';
        return;
      }
      status.textContent = reason + '，自动重试 ' + retryCount + '/3…';
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        try {
          if (window.hcaptcha?.reset && widgetId !== undefined) {
            try { window.hcaptcha.reset(widgetId); } catch {}
            window.hcaptcha.execute(widgetId);
          } else loadScript();
        } catch (error) { retry(error instanceof Error ? error.message : String(error)); }
      }, 1000 * retryCount);
    };
    const render = () => {
      try {
        status.textContent = '正在进行 hCaptcha 验证；需要操作时会弹出官方挑战。';
        retryButton.style.display = 'none';
        widgetId = window.hcaptcha.render(container, {
          sitekey: ${JSON.stringify(HCAPTCHA_SITEKEY)},
          size: 'invisible',
          callback: value => finish(value),
          'error-callback': code => retry('验证组件出错：' + (code || 'unknown')),
          'expired-callback': () => retry('验证已过期'),
          'chalexpired-callback': () => retry('验证挑战已过期'),
          'open-callback': () => { status.textContent = '请完成弹出的 hCaptcha 挑战…'; },
          'close-callback': () => { status.textContent = '验证窗口已关闭，正在确认结果…'; },
        });
        window.hcaptcha.execute(widgetId);
      } catch (error) { retry(error instanceof Error ? error.message : String(error)); }
    };
    const loadScript = () => {
      if (window.hcaptcha?.render) { render(); return; }
      document.querySelector('script[data-suno-original-hcaptcha]')?.remove();
      const query = new URLSearchParams({
        onload: '__sunoOriginalHcaptchaOnLoad', render: 'explicit',
        endpoint: 'https://hcaptcha-endpoint-' + env + '.suno.com',
        assethost: 'https://hcaptcha-assets-' + env + '.suno.com',
        imghost: 'https://hcaptcha-imgs-' + env + '.suno.com',
        reportapi: 'https://hcaptcha-reportapi-' + env + '.suno.com',
      });
      window.__sunoOriginalHcaptchaOnLoad = () => { if (!settled) render(); };
      const script = document.createElement('script');
      script.dataset.sunoOriginalHcaptcha = '1';
      script.src = 'https://hcaptcha-endpoint-' + env + '.suno.com/1/api.js?' + query.toString();
      script.async = true;
      script.defer = true;
      script.onerror = () => retry('无法加载 hCaptcha 官方验证组件');
      document.head.appendChild(script);
    };
    retryButton.onclick = () => {
      retryCount = 0;
      retryButton.style.display = 'none';
      if (widgetId !== undefined && window.hcaptcha) {
        try { window.hcaptcha.remove(widgetId); } catch {}
        widgetId = undefined;
      }
      armTimeout();
      loadScript();
    };
    cancelButton.onclick = () => finish(null, '用户取消了 Suno 人机验证');
    armTimeout();
    loadScript();
  }))()`;
}

async function runOfficialVerification(slot, provider, title = '') {
  slot = String(slot);
  provider = Number(provider) === 1 ? 1 : 2;
  const win = await ensureAccountWindow(slot, true, SUNO_CREATE);
  if (!win.webContents.getURL().startsWith(SUNO_CREATE)) await win.loadURL(SUNO_CREATE);
  await waitReady(win, 30000);

  verificationActiveSlots.add(slot);
  if (win.isMinimized()) win.restore();
  win.setTitle(`Suno 人机验证 — 账号 ${slot}`);
  win.show();
  win.focus();
  win.moveTop();
  win.setAlwaysOnTop(true, 'floating');
  emitVerification({
    state: 'required', slot, title, provider,
    message: provider === 1 ? '已打开账号窗口，正在加载 Suno 官方 hCaptcha。' : '已打开账号窗口，正在加载 Suno 官方 Cloudflare Turnstile。',
  });

  try {
    const script = provider === 1 ? buildHcaptchaVerificationScript() : buildTurnstileVerificationScript();
    const token = await win.webContents.executeJavaScript(script);
    if (!String(token || '').trim()) throw new Error('Suno 人机验证没有返回有效 token');
    emitVerification({ state: 'passed', slot, title, provider, message: 'Suno 官方验证已通过，正在自动继续刚才的原创任务。' });
    return { token: String(token), tokenProvider: provider };
  } finally {
    verificationActiveSlots.delete(slot);
    try { win.setAlwaysOnTop(false); } catch {}
    try { win.setTitle(`Suno 账号 ${slot}`); } catch {}
    try { win.hide(); } catch {}
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      mainWindow.moveTop();
    }
  }
}

function buildOriginalPayload(input, verification = {}) {
  const sliders = {};
  if (Number.isFinite(Number(input.weirdness))) sliders.weirdness_constraint = Math.max(0, Math.min(1, Number(input.weirdness) / 100));
  if (Number.isFinite(Number(input.styleInfluence))) sliders.style_weight = Math.max(0, Math.min(1, Number(input.styleInfluence) / 100));
  const genderTag = input.vocalGender === 'female' ? 'female vocal' : input.vocalGender === 'male' ? 'male vocal' : '';
  const tags = [String(input.stylePrompt || '').trim(), genderTag].filter(Boolean).join(', ');

  return {
    token: verification.token || null,
    ...(verification.tokenProvider ? { token_provider: verification.tokenProvider } : {}),
    generation_type: 'TEXT',
    title: String(input.title || '').trim(),
    tags,
    negative_tags: String(input.negativeStyle || '').trim(),
    mv: MODEL_MAP[input.modelVersion] || 'chirp-fenix',
    prompt: String(input.lyrics || ''),
    make_instrumental: false,
    user_uploaded_images_b64: null,
    metadata: {
      web_client_pathname: '/create', is_max_mode: false, is_mumble: false, create_mode: 'custom', user_tier: '',
      create_session_token: randomUUID(), disable_volume_normalization: false,
      ...(Object.keys(sliders).length ? { can_control_sliders: ['weirdness_constraint', 'style_weight'], control_sliders: sliders } : {}),
      ...(input.vocalGender ? { vocal_gender: input.vocalGender === 'female' ? 'f' : 'm' } : {}),
    },
    override_fields: [], cover_clip_id: null, cover_start_s: null, cover_end_s: null,
    persona_id: null, artist_clip_id: null, artist_start_s: null, artist_end_s: null,
    continue_clip_id: null, continued_aligned_prompt: null, continue_at: null,
    transaction_uuid: randomUUID(),
  };
}

async function postOriginal(slot, input, headers, verification = {}) {
  const ses = session.fromPartition(partitionFor(slot));
  const res = await ses.fetch(`${SUNO_API}/api/generate/v2-web/`, {
    method: 'POST', headers, body: JSON.stringify(buildOriginalPayload(input, verification)),
  });
  const body = await res.json().catch(() => null);
  const detail = typeof body?.detail === 'string' ? body.detail : JSON.stringify(body?.detail ?? body);
  if (!res.ok) {
    if (res.status === 402 || /enough credits|out of credits|out of songs|buy more/i.test(detail || '')) throw new Error('Suno 账号歌曲额度不足');
    if (res.status === 422 && /verify|verification|captcha|人机验证/i.test(detail || '')) return { verificationRequired: true, status: res.status, detail };
    throw new Error(`Suno 原创提交失败（${res.status}）：${detail || '未知错误'}`);
  }
  if (String(body?.status || '').toLowerCase() === 'error') throw new Error('Suno 接口拒绝了本次原创提交');
  const clips = (body?.clips || []).map(x => x?.id).filter(Boolean).slice(0, 2);
  if (!clips.length) throw new Error('Suno 没有返回原创作品编号');
  return { verificationRequired: false, clips };
}

async function submitOriginal(input) {
  const slot = String(input.slot || '1');
  const title = String(input.title || '').trim();
  const lyrics = String(input.lyrics || '').trim();
  if (!title) throw new Error('请填写歌名');
  if (!lyrics) throw new Error('请填写歌词');

  const headers = await apiHeaders(slot);
  let verification = {};
  const precheck = await precheckVerification(slot, headers);
  if (precheck.known && precheck.required) verification = await runOfficialVerification(slot, precheck.captchaProvider, title);
  let result = await postOriginal(slot, input, headers, verification);
  if (result.verificationRequired) {
    const provider = await detectCaptchaProvider(slot, headers);
    verification = await runOfficialVerification(slot, provider, title);
    result = await postOriginal(slot, input, headers, verification);
  }
  if (result.verificationRequired) throw new Error('Suno 在完成官方验证后仍要求再次验证，已停止当前任务，避免重复提交。');
  const clips = result.clips;
  return {
    slot, title, clipIds: clips, submittedAt: new Date().toISOString(),
    tracks: clips.map(id => ({ id, url: `https://suno.com/song/${id}`, status: 'submitted' })),
  };
}

async function refreshTask(task) {
  const slot = String(task?.slot || '1');
  const ids = Array.isArray(task?.clipIds) ? task.clipIds.filter(Boolean) : [];
  if (!ids.length) throw new Error('任务没有作品编号');
  const headers = await apiHeaders(slot, { json: false });
  const ses = session.fromPartition(partitionFor(slot));
  const url = `${SUNO_API}/api/feed/v2?ids=${encodeURIComponent(ids.join(','))}`;
  const res = await ses.fetch(url, { headers });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`读取 Suno 任务失败（${res.status}）`);
  const raw = Array.isArray(body) ? body : (body?.clips || body?.items || []);
  const byId = new Map(raw.map(x => [x.id, x]));
  const tracks = ids.map(id => {
    const x = byId.get(id) || {};
    return {
      id, url: `https://suno.com/song/${id}`, status: String(x.status || 'submitted'),
      title: x.title || task.title || '', audioUrl: x.audio_url || '', imageUrl: x.image_url || '',
      duration: Number(x.metadata?.duration || 0), error: x.error_message || x.metadata?.error_message || '',
    };
  });
  return { ...task, tracks, refreshedAt: new Date().toISOString() };
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 1000,
    minHeight: 700,
    title: 'Suno Original Studio v0.5.6',
    backgroundColor: '#0b0c10',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  ipcMain.handle('account:status', (_, slot) => accountStatus(slot));
  ipcMain.handle('account:open-login', async (_, slot) => {
    const win = await ensureAccountWindow(String(slot), true, SUNO_HOME);
    win.show();
    win.focus();
    return true;
  });
  ipcMain.handle('original:submit', (_, payload) => submitOriginal(payload || {}));
  ipcMain.handle('task:refresh', (_, task) => refreshTask(task || {}));
  ipcMain.handle('song:open', (_, url) => {
    if (typeof url === 'string' && url.startsWith('https://suno.com/song/')) shell.openExternal(url);
  });
  createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
