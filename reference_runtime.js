const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { sessionFor } = require('./suno_session');

function firstExisting(paths) {
  return paths.find(p => p && fs.existsSync(p)) || '';
}

function helperPath() {
  return firstExisting([
    process.resourcesPath && path.join(process.resourcesPath, 'tools', 'reference-download', 'reference_capture_helper.py'),
    path.join(__dirname, 'reference_capture_helper.py'),
  ]);
}

function pythonPath() {
  return firstExisting([
    process.resourcesPath && path.join(process.resourcesPath, 'tools', 'reference-python', 'python.exe'),
  ]) || 'python';
}

function ffmpegPath() {
  return firstExisting([
    process.resourcesPath && path.join(process.resourcesPath, 'tools', 'n19', 'ffmpeg-win-x86_64-v7.1.exe'),
    path.join(__dirname, 'vendor', 'avr-n19', 'ffmpeg-win-x86_64-v7.1.exe'),
  ]);
}

function tempFile(ext = '.tmp') {
  return path.join(os.tmpdir(), `suno-reference-${crypto.randomBytes(8).toString('hex')}${ext}`);
}

function runHelper(args, { timeoutMs = 10 * 60 * 1000, onLog = null } = {}) {
  return new Promise((resolve, reject) => {
    const helper = helperPath();
    if (!helper) {
      reject(new Error('参考下载器 helper 不存在'));
      return;
    }
    const python = pythonPath();
    const child = spawn(python, [helper, ...args], {
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    });
    let stdout = '';
    let stderr = '';
    let timer = null;

    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => {
      const text = chunk.toString('utf8');
      stderr += text;
      if (stderr.length > 40000) stderr = stderr.slice(-40000);
      if (onLog) {
        for (const line of text.split(/\r?\n/).filter(Boolean)) onLog(line);
      }
    });
    child.on('error', error => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      else reject(new Error(stderr.trim() || stdout.trim() || `参考下载器 helper 退出码 ${code}`));
    });
    timer = setTimeout(() => {
      try { child.kill(); } catch {}
      reject(new Error(`参考下载器 helper 超时（${Math.round(timeoutMs / 1000)} 秒）`));
    }, timeoutMs);
  });
}

async function writeCookiesFile(slot) {
  const file = tempFile('.cookies.json');
  const cookies = await sessionFor(String(slot)).cookies.get({});
  fs.writeFileSync(file, JSON.stringify(cookies, null, 2), 'utf8');
  return file;
}

async function runReferenceSaveUrl(url, output, onLog = null) {
  await runHelper(['save-url', '--url', String(url), '--output', String(output), '--max-attempts', '3'], {
    timeoutMs: 8 * 60 * 1000,
    onLog,
  });
  if (!fs.existsSync(output) || fs.statSync(output).size <= 0) throw new Error('参考下载器没有生成媒体文件');
  return output;
}

async function runReferenceSniff(slot, clipId, onLog = null) {
  let cookieFile = '';
  try {
    cookieFile = await writeCookiesFile(slot);
    const result = await runHelper([
      'sniff', '--song-id', String(clipId), '--cookies', cookieFile,
    ], { timeoutMs: 90 * 1000, onLog });
    return String(result.stdout || '').split(/\r?\n/).filter(Boolean).pop() || '';
  } finally {
    try { if (cookieFile) fs.unlinkSync(cookieFile); } catch {}
  }
}

async function runReferenceCapture(slot, clipId, output, onLog = null) {
  let cookieFile = '';
  try {
    const ffmpeg = ffmpegPath();
    if (!ffmpeg) throw new Error('参考录制模式找不到 FFmpeg');
    cookieFile = await writeCookiesFile(slot);
    await runHelper([
      'capture', '--song-id', String(clipId), '--output', String(output), '--ffmpeg', ffmpeg, '--cookies', cookieFile,
    ], { timeoutMs: 20 * 60 * 1000, onLog });
    if (!fs.existsSync(output) || fs.statSync(output).size <= 0) throw new Error('参考录制模式没有生成 WAV');
    return output;
  } finally {
    try { if (cookieFile) fs.unlinkSync(cookieFile); } catch {}
  }
}

module.exports = {
  tempFile,
  ffmpegPath,
  runReferenceSaveUrl,
  runReferenceSniff,
  runReferenceCapture,
};
