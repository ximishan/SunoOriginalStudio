const { BrowserWindow, ipcMain } = require('electron');
const { ACCOUNT_SLOTS, sessionFor, apiHeaders } = require('./suno_session');
const { runReferenceSniff } = require('./reference_runtime');
const { getDownloadPolicy, setDownloadPolicy } = require('./download_policy');

const SUNO_API = 'https://studio-api-prod.suno.com/api';
const MP3_POLL_MS = 2500;
const MP3_TIMEOUT_MS = 120000;
const patched = new WeakSet();
let ipcRegistered = false;

function emit(clipId, message) {
  try { console.log(`[SunoReference ${clipId || '-'}] ${message}`); } catch {}
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed() && win.webContents.getURL().startsWith('file://')) {
        win.webContents.send('song-library:changed', { type: 'progress', clipId: String(clipId || ''), message: `[参考下载] ${message}` });
      }
    } catch {}
  }
}

function urlString(input) {
  try {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.toString();
    return String(input?.url || input || '');
  } catch { return String(input || ''); }
}

function wavFileClipId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.toLowerCase() !== 'studio-api-prod.suno.com') return '';
    const m = u.pathname.match(/^\/api\/gen\/([^/]+)\/wav_file\/$/i);
    return m ? m[1] : '';
  } catch { return ''; }
}

function convertWavClipId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.toLowerCase() !== 'studio-api-prod.suno.com') return '';
    const m = u.pathname.match(/^\/api\/gen\/([^/]+)\/convert_wav\/$/i);
    return m ? m[1] : '';
  } catch { return ''; }
}

function responseWavUrl(data) {
  const value = data?.wav_file_url || data?.audio_url_wav || data?.wav_url || '';
  return typeof value === 'string' && /^https?:\/\//i.test(value) ? value : '';
}

function synthetic(url, source) {
  return new Response(JSON.stringify({ wav_file_url: url, fallback_source: source }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function requestMp3Url(slot, clipId, originalFetch) {
  const deadline = Date.now() + MP3_TIMEOUT_MS;
  let lastStatus = '';
  while (Date.now() < deadline) {
    const headers = await apiHeaders(slot, { json: false });
    const response = await originalFetch(`${SUNO_API}/download/clip/${encodeURIComponent(clipId)}`, {
      method: 'GET', headers, cache: 'no-store',
    });
    const body = await response.clone().json().catch(() => null);
    const downloadUrl = String(body?.download_url || body?.url || '').trim();
    const state = String(body?.status || body?.state || '').trim();
    const reason = String(body?.reason || body?.message || '').trim();
    lastStatus = [response.status, state, reason].filter(Boolean).join(' / ');

    if (response.ok && downloadUrl && !/\/api\/forbidden/i.test(downloadUrl)) return { url: downloadUrl, locked: false };
    if (/DownloadLocked|download.?locked|forbidden/i.test(`${state} ${reason}`) || /\/api\/forbidden/i.test(downloadUrl)) {
      return { url: '', locked: true, reason: reason || state || `HTTP ${response.status}` };
    }
    if (response.status === 401 || response.status === 403) {
      return { url: '', locked: true, reason: reason || `HTTP ${response.status}` };
    }
    await sleep(MP3_POLL_MS);
  }
  return { url: '', locked: false, reason: lastStatus || 'MP3 download URL timeout' };
}

function captureUrl(slot, clipId) {
  return `https://suno-reference.local/capture/${encodeURIComponent(String(slot))}/${encodeURIComponent(String(clipId))}.wav`;
}

async function lossyFallback(slot, clipId, originalFetch) {
  emit(clipId, '2/4 按参考 EXE 尝试官方 MP3 下载地址');
  try {
    const mp3 = await requestMp3Url(slot, clipId, originalFetch);
    if (mp3.url) {
      emit(clipId, '2/4 官方 MP3 下载地址可用，交给参考流式下载器并转 WAV');
      return synthetic(mp3.url, 'reference-download-clip');
    }
    if (mp3.locked) emit(clipId, `2/4 官方 MP3 被限制：${mp3.reason || 'DownloadLocked'}`);
  } catch (error) {
    emit(clipId, `2/4 官方 MP3 地址失败：${error?.message || error}`);
  }

  emit(clipId, '3/4 按参考 EXE 从 Suno 播放页面嗅探媒体地址');
  try {
    const mediaUrl = await runReferenceSniff(slot, clipId, line => {
      if (/"kind"\s*:\s*"error"/i.test(line)) emit(clipId, line);
    });
    if (mediaUrl) {
      emit(clipId, '3/4 已嗅探到播放媒体，交给参考流式下载器并转 WAV');
      return synthetic(mediaUrl, 'reference-media-sniffer');
    }
  } catch (error) {
    emit(clipId, `3/4 媒体嗅探失败：${error?.message || error}`);
  }

  emit(clipId, '4/4 没有可保存媒体 URL，进入参考 EXE 的播放 + WASAPI 回环录制');
  return synthetic(captureUrl(slot, clipId), 'reference-playback-capture');
}

function patchAccount(slot) {
  const ses = sessionFor(slot);
  if (!ses || patched.has(ses)) return;
  const originalFetch = ses.fetch.bind(ses);

  const wrapped = async (input, options = {}) => {
    const url = urlString(input);
    const method = String(options?.method || 'GET').toUpperCase();
    const policy = getDownloadPolicy();

    const convertClipId = convertWavClipId(url);
    if (convertClipId && method === 'POST' && policy.format === 'mp3') {
      emit(convertClipId, '已选择 MP3 兼容模式，跳过官方 WAV 导出请求');
      return new Response('', { status: 409 });
    }

    const clipId = wavFileClipId(url);
    if (!clipId) return originalFetch(input, options);

    if (policy.format === 'mp3') {
      emit(clipId, '1/4 已选择 MP3 兼容模式，跳过官方 WAV，按参考 EXE 直接请求 MP3');
      return lossyFallback(slot, clipId, originalFetch);
    }

    const response = await originalFetch(input, options);
    try {
      const data = await response.clone().json().catch(() => null);
      const official = responseWavUrl(data);
      if (response.ok && official) {
        emit(clipId, '1/4 官方 WAV 地址可用，严格使用真实 WAV');
        return response;
      }
    } catch {}

    if (!policy.allowMp3Fallback) {
      emit(clipId, '1/4 官方 WAV 不可用；当前为严格 WAV 模式，已停止，不会降级 MP3/媒体嗅探/WASAPI');
      const error = new Error('严格 WAV 模式：Suno 官方真实 WAV 不可用。未降级到 MP3，也不会把 MP3 转成 WAV。可手动勾选“WAV 不可用时允许降级 MP3”后重试。');
      error.code = 'STRICT_WAV_UNAVAILABLE';
      throw error;
    }

    emit(clipId, '1/4 官方 WAV 不可用；已允许降级，继续按参考 EXE 的 MP3/媒体兜底链路');
    return lossyFallback(slot, clipId, originalFetch);
  };

  try { ses.fetch = wrapped; }
  catch { try { Object.defineProperty(ses, 'fetch', { configurable: true, writable: true, value: wrapped }); } catch {} }
  patched.add(ses);
}

function installReferenceDownloadCompatibility() {
  for (const slot of ACCOUNT_SLOTS) patchAccount(slot);
  if (!ipcRegistered) {
    ipcRegistered = true;
    ipcMain.handle('library:get-download-policy', async () => getDownloadPolicy());
    ipcMain.handle('library:set-download-policy', async (_event, value) => setDownloadPolicy(value || {}));
  }
}

module.exports = { installReferenceDownloadCompatibility, captureUrl };
