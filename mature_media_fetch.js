const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { spawn } = require('child_process');
const { session, BrowserWindow } = require('electron');
const { ACCOUNT_SLOTS, sessionFor } = require('./suno_session');
const { tempFile, ffmpegPath, runReferenceSaveUrl, runReferenceCapture } = require('./reference_runtime');

const patchedSessions = new WeakSet();
const PROGRESS_STEP_BYTES = 5 * 1024 * 1024;

function emitUi(clipId, message) {
  const id = String(clipId || '');
  try { console.log(`[SunoReference ${id || '-'}] ${message}`); } catch {}
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed() && win.webContents.getURL().startsWith('file://')) {
        win.webContents.send('song-library:changed', {
          type: 'progress',
          clipId: id,
          message: `[参考下载] ${message}`,
        });
      }
    } catch {}
  }
}

function formatMb(bytes) {
  return `${(Number(bytes || 0) / 1024 / 1024).toFixed(2)} MB`;
}

function urlString(input) {
  try {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.toString();
    return String(input?.url || input || '');
  } catch { return String(input || ''); }
}

function clipIdFromMediaUrl(url) {
  try {
    const spec = captureSpec(url);
    if (spec?.clipId) return spec.clipId;
    const u = new URL(url);
    const uuid = u.pathname.match(/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i);
    if (uuid) return uuid[1];
    const base = path.basename(u.pathname || '').replace(/\.[^.]+$/, '');
    return /^[0-9a-f-]{20,}$/i.test(base) ? base : '';
  } catch { return ''; }
}

function isSignedQuery(u) {
  const q = u.searchParams;
  return q.has('X-Amz-Signature') || q.has('X-Amz-Credential') || q.has('AWSAccessKeyId') ||
    (q.has('Signature') && q.has('Expires')) || q.has('Policy') || q.has('Key-Pair-Id');
}

function captureSpec(url) {
  try {
    const u = new URL(url);
    if (u.hostname.toLowerCase() !== 'suno-reference.local') return null;
    const m = u.pathname.match(/^\/capture\/([^/]+)\/([^/]+)\.wav$/i);
    return m ? { slot: decodeURIComponent(m[1]), clipId: decodeURIComponent(m[2]) } : null;
  } catch { return null; }
}

function isDirectMediaUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const pathname = u.pathname.toLowerCase();
    if (captureSpec(url)) return true;
    if (host === 'studio-api-prod.suno.com' || host === 'auth.suno.com') return false;
    const mediaHost = host.endsWith('.amazonaws.com') || host.endsWith('.cloudfront.net') ||
      host === 'cdn1.suno.ai' || /^cdn\d*\.suno\.ai$/i.test(host) || host.endsWith('.suno.ai');
    const audioPath = /\.(wav|mp3|m4a|flac|aac|ogg|webm)$/i.test(pathname) ||
      /\/studio\/uploads\//i.test(pathname) || /audio|generated|stream/i.test(pathname);
    return isSignedQuery(u) || (mediaHost && audioPath);
  } catch { return false; }
}

function isWavFile(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(12);
    const count = fs.readSync(fd, head, 0, 12, 0);
    fs.closeSync(fd);
    if (count < 12) return false;
    const riff = head.subarray(0, 4).toString('ascii');
    const wave = head.subarray(8, 12).toString('ascii');
    return (riff === 'RIFF' || riff === 'RF64' || riff === 'RIFX') && wave === 'WAVE';
  } catch { return false; }
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const ffmpeg = ffmpegPath();
    if (!ffmpeg) { reject(new Error('参考下载器找不到 FFmpeg')); return; }
    const child = spawn(ffmpeg, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', d => {
      stderr += d.toString();
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
    });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(stderr.slice(-1600) || `FFmpeg exit ${code}`)));
  });
}

async function normalizeToReferenceWav(source) {
  if (isWavFile(source)) return source;
  const target = tempFile('.wav');
  await runFfmpeg([
    '-hide_banner', '-loglevel', 'error', '-y', '-i', source,
    '-vn', '-map_metadata', '-1', '-c:a', 'pcm_s24le', '-f', 'wav', target,
  ]);
  if (!fs.existsSync(target) || fs.statSync(target).size <= 0) throw new Error('参考下载器 FFmpeg 没有生成 WAV');
  return target;
}

function fileResponse(file, cleanupFiles = []) {
  const size = fs.statSync(file).size;
  const nodeStream = fs.createReadStream(file);
  nodeStream.on('close', () => {
    for (const p of cleanupFiles) {
      try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch {}
    }
  });
  const body = typeof Readable.toWeb === 'function' ? Readable.toWeb(nodeStream) : null;
  if (!body) throw new Error('ERR_STREAM_UNAVAILABLE: 无法建立参考下载文件流');
  const headers = new Map([
    ['content-type', 'audio/wav'],
    ['content-length', String(size)],
    ['x-suno-reference-materialized', '1'],
  ]);
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    url: `file://${file}`,
    headers: { get: name => headers.get(String(name || '').toLowerCase()) || null },
    body,
  };
}

function referenceLogHandler(clipId, state) {
  return line => {
    try { console.log(`[SunoReferenceSave ${clipId || '-'}] ${line}`); } catch {}
    let data = null;
    try { data = JSON.parse(String(line || '')); } catch { return; }
    const kind = String(data?.kind || '');
    if (kind === 'http') {
      state.startedAt = Date.now();
      state.total = Number(data.total || 0);
      state.lastReported = 0;
      emitUi(clipId, `实际网络下载开始：HTTP ${data.status || '-'}${state.total > 0 ? `，文件 ${formatMb(state.total)}` : '，大小未知'}，第 ${data.attempt || 1} 次尝试`);
      return;
    }
    if (kind === 'progress') {
      const done = Number(data.done || 0);
      const total = Number(data.total || state.total || 0);
      if (done <= 0) return;
      const shouldReport = done - state.lastReported >= PROGRESS_STEP_BYTES || (total > 0 && done >= total);
      if (!shouldReport) return;
      state.lastReported = done;
      const elapsed = Math.max(0.001, (Date.now() - (state.startedAt || Date.now())) / 1000);
      const speed = done / 1024 / 1024 / elapsed;
      const suffix = total > 0 ? ` / ${formatMb(total)}（${Math.min(100, Math.round(done * 100 / total))}%）` : '';
      emitUi(clipId, `实际网络已下载 ${formatMb(done)}${suffix}，平均 ${speed.toFixed(2)} MB/s`);
      return;
    }
    if (kind === 'retry') {
      emitUi(clipId, `网络下载第 ${data.attempt || '-'} 次失败，参考 EXE 正在重试：${data.error || '未知错误'}`);
      return;
    }
    if (kind === 'saved') {
      const bytes = Number(data.bytes || 0);
      const elapsed = Math.max(0.001, (Date.now() - (state.startedAt || Date.now())) / 1000);
      const speed = bytes > 0 ? bytes / 1024 / 1024 / elapsed : 0;
      emitUi(clipId, `实际网络下载完成：${formatMb(bytes)}，耗时 ${elapsed.toFixed(1)} 秒${speed > 0 ? `，平均 ${speed.toFixed(2)} MB/s` : ''}`);
    }
  };
}

async function materializeReferenceMedia(url) {
  const spec = captureSpec(url);
  if (spec) {
    const wav = tempFile('.wav');
    emitUi(spec.clipId, '参考 EXE 已进入播放 + WASAPI 回环录制');
    await runReferenceCapture(spec.slot, spec.clipId, wav, line => {
      try { console.log(`[SunoReferenceCapture ${spec.clipId}] ${line}`); } catch {}
      try {
        const data = JSON.parse(String(line || ''));
        if (data?.kind === 'capture_started') emitUi(spec.clipId, 'WASAPI 回环录制已开始');
        if (data?.kind === 'capture_progress' && data?.seconds) emitUi(spec.clipId, `WASAPI 已录制 ${Number(data.seconds).toFixed(1)} 秒`);
        if (data?.kind === 'capture_saved') emitUi(spec.clipId, 'WASAPI 回环录制完成');
      } catch {}
    });
    return { wav, cleanup: [wav] };
  }

  const clipId = clipIdFromMediaUrl(url);
  const source = tempFile(path.extname(new URL(url).pathname) || '.media');
  emitUi(clipId, '参考 EXE 下载器已接管媒体 URL，正在使用 requests(stream=True) 下载');
  const state = { startedAt: Date.now(), total: 0, lastReported: 0 };
  await runReferenceSaveUrl(url, source, referenceLogHandler(clipId, state));
  const wav = await normalizeToReferenceWav(source);
  if (wav !== source) emitUi(clipId, '下载媒体不是 WAV，已按参考 EXE 使用 FFmpeg 转为 WAV');
  return { wav, cleanup: wav === source ? [source] : [source, wav] };
}

function patchSession(ses, label) {
  if (!ses || patchedSessions.has(ses) || typeof ses.fetch !== 'function') return;
  const originalFetch = ses.fetch.bind(ses);
  const wrappedFetch = async (input, options = {}) => {
    const url = urlString(input);
    const method = String(options?.method || 'GET').toUpperCase();
    if (method !== 'GET' || !isDirectMediaUrl(url)) return originalFetch(input, options);
    try {
      const result = await materializeReferenceMedia(url);
      try { console.log(`[SunoMatureDownload] ${label} reference pipeline ready: ${url.slice(0, 140)}`); } catch {}
      return fileResponse(result.wav, result.cleanup);
    } catch (error) {
      try { console.log(`[SunoMatureDownload] ${label} reference pipeline failed: ${error?.message || error}`); } catch {}
      if (captureSpec(url)) throw error;
      return originalFetch(input, options);
    }
  };
  try { ses.fetch = wrappedFetch; }
  catch { try { Object.defineProperty(ses, 'fetch', { configurable: true, writable: true, value: wrappedFetch }); } catch {} }
  patchedSessions.add(ses);
}

function installMatureMediaFetch() {
  for (const slot of ACCOUNT_SLOTS) patchSession(sessionFor(slot), `account-${slot}`);
  patchSession(session.defaultSession, 'default');
}

module.exports = { installMatureMediaFetch };
