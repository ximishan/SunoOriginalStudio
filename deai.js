const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

let activeProcess = null;
let cancelRequested = false;

function resolveFfmpegPath() {
  let ffmpegPath = require('ffmpeg-static');
  if (!ffmpegPath) throw new Error('未找到内置 FFmpeg');

  const candidates = [ffmpegPath];
  if (ffmpegPath.includes('app.asar')) {
    candidates.unshift(ffmpegPath.replace('app.asar', 'app.asar.unpacked'));
  }
  if (process.resourcesPath) {
    const base = path.basename(ffmpegPath);
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', base));
  }

  const found = candidates.find(p => p && fs.existsSync(p));
  if (!found) {
    throw new Error(`内置 FFmpeg 不存在：${candidates.join(' | ')}`);
  }
  return found;
}

function n19FilterChain() {
  // FFmpeg-only N19 compatible chain. It follows the previously extracted AVR N19
  // EQ / pitch / ambience / dynamics / post-processing structure without SoX/Rubber Band.
  return [
    'highpass=f=28',
    'equalizer=f=8500:width_type=h:width=2200:g=-0.20',
    'equalizer=f=10000:width_type=h:width=2600:g=-1.5',
    'equalizer=f=12000:width_type=h:width=3000:g=-2.5',
    'lowpass=f=15000',
    'aecho=0.80:0.55:45:0.08',
    'loudnorm=I=-15:TP=-1.5:LRA=11',

    // AVR scheme 9 fallback pitch path (rubberband-free).
    'asetrate=48000*0.975',
    'aresample=48000',
    'atempo=1.025641',
    'equalizer=f=80:g=4.0:width_type=h:width=80',
    'equalizer=f=150:g=3.0:width_type=h:width=100',
    'equalizer=f=300:g=-1.5:width_type=h:width=200',
    'equalizer=f=1500:g=-1.0:width_type=h:width=400',
    'equalizer=f=4000:g=3.5:width_type=h:width=2000',
    'equalizer=f=8000:g=1.8:width_type=h:width=4000',
    'aecho=0.55:0.4:35|45:0.12|0.08',
    'volume=2.0',
    'highpass=f=45',
    'acompressor=threshold=-18dB:ratio=2.0:attack=10:release=120:makeup=1.5',
    'volume=2.0dB',
    'alimiter=limit=0.97',

    // Combined post stage.
    'highpass=f=28',
    'equalizer=f=120:g=0.25:width_type=h:width=100',
    'equalizer=f=1800:g=0.20:width_type=h:width=1200',
    'equalizer=f=7200:g=-0.18:width_type=h:width=3800',
    'acompressor=threshold=-19dB:ratio=1.18:attack=24:release=210:makeup=1',
    'alimiter=limit=0.96',
  ].join(',');
}

function safeStem(filePath) {
  return path.basename(filePath, path.extname(filePath)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'audio';
}

function uniqueOutputPath(outputDir, inputPath) {
  const stem = safeStem(inputPath);
  let candidate = path.join(outputDir, `${stem}_AI消痕_N19.wav`);
  let n = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(outputDir, `${stem}_AI消痕_N19_${n}.wav`);
    n += 1;
  }
  return candidate;
}

function sendProgress(sender, payload) {
  try {
    if (sender && !sender.isDestroyed()) sender.send('deai:progress', payload);
  } catch {}
}

function processOne(ffmpegPath, inputPath, outputPath, sender, index, total) {
  return new Promise((resolve, reject) => {
    if (cancelRequested) {
      reject(new Error('用户取消了 AI 消痕任务'));
      return;
    }

    const args = [
      '-hide_banner', '-nostdin', '-y',
      '-i', inputPath,
      '-vn',
      '-af', n19FilterChain(),
      '-map_metadata', '-1',
      '-ar', '48000',
      '-ac', '2',
      '-c:a', 'pcm_s16le',
      outputPath,
    ];

    sendProgress(sender, {
      state: 'processing', index, total,
      input: inputPath, output: outputPath,
      message: `正在处理 ${index}/${total}：${path.basename(inputPath)}`,
    });

    const child = spawn(ffmpegPath, args, { windowsHide: true });
    activeProcess = child;
    let stderr = '';
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
      if (stderr.length > 16000) stderr = stderr.slice(-16000);
    });
    child.on('error', err => {
      activeProcess = null;
      reject(new Error(`FFmpeg 启动失败：${err.message}`));
    });
    child.on('close', code => {
      activeProcess = null;
      if (cancelRequested) {
        try { fs.unlinkSync(outputPath); } catch {}
        reject(new Error('用户取消了 AI 消痕任务'));
        return;
      }
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve(outputPath);
      } else {
        try { fs.unlinkSync(outputPath); } catch {}
        reject(new Error(`处理失败（FFmpeg ${code}）：${stderr.slice(-1800)}`));
      }
    });
  });
}

function registerDeaiIpc({ ipcMain, dialog, shell }) {
  ipcMain.handle('deai:engine-info', async () => {
    try {
      const ffmpegPath = resolveFfmpegPath();
      return { ready: true, engine: 'FFmpeg N19 compatible', ffmpegPath };
    } catch (e) {
      return { ready: false, engine: 'FFmpeg N19 compatible', error: String(e?.message || e) };
    }
  });

  ipcMain.handle('deai:select-files', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择要进行 AI 消痕的音频',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '音频文件', extensions: ['wav', 'mp3', 'flac', 'm4a', 'aac', 'ogg', 'wma'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('deai:select-output-dir', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择 AI 消痕输出目录',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? '' : (result.filePaths[0] || '');
  });

  ipcMain.handle('deai:process', async (event, payload = {}) => {
    const files = Array.isArray(payload.files) ? payload.files.filter(Boolean) : [];
    if (!files.length) throw new Error('请先选择至少一个音频文件');

    const ffmpegPath = resolveFfmpegPath();
    let outputDir = String(payload.outputDir || '').trim();
    if (!outputDir) outputDir = path.join(path.dirname(files[0]), 'AI消痕输出');
    fs.mkdirSync(outputDir, { recursive: true });

    cancelRequested = false;
    const results = [];
    sendProgress(event.sender, { state: 'started', total: files.length, outputDir, message: `开始处理 ${files.length} 个音频文件` });

    try {
      for (let i = 0; i < files.length; i += 1) {
        const inputPath = files[i];
        if (!fs.existsSync(inputPath)) {
          results.push({ input: inputPath, ok: false, error: '文件不存在' });
          continue;
        }
        const outputPath = uniqueOutputPath(outputDir, inputPath);
        try {
          await processOne(ffmpegPath, inputPath, outputPath, event.sender, i + 1, files.length);
          results.push({ input: inputPath, output: outputPath, ok: true });
          sendProgress(event.sender, {
            state: 'file-complete', index: i + 1, total: files.length,
            input: inputPath, output: outputPath,
            message: `完成 ${i + 1}/${files.length}：${path.basename(outputPath)}`,
          });
        } catch (e) {
          if (cancelRequested) throw e;
          results.push({ input: inputPath, ok: false, error: String(e?.message || e) });
          sendProgress(event.sender, {
            state: 'file-error', index: i + 1, total: files.length,
            input: inputPath, message: `处理失败：${path.basename(inputPath)} — ${String(e?.message || e)}`,
          });
        }
      }
    } finally {
      activeProcess = null;
    }

    const successCount = results.filter(x => x.ok).length;
    sendProgress(event.sender, {
      state: cancelRequested ? 'cancelled' : 'complete', total: files.length,
      successCount, outputDir,
      message: cancelRequested ? 'AI 消痕任务已取消' : `AI 消痕完成：成功 ${successCount}/${files.length}`,
    });
    return { outputDir, results, successCount, total: files.length, cancelled: cancelRequested };
  });

  ipcMain.handle('deai:cancel', async () => {
    cancelRequested = true;
    if (activeProcess && !activeProcess.killed) {
      try { activeProcess.kill('SIGKILL'); } catch {}
    }
    return true;
  });

  ipcMain.handle('deai:open-output-dir', async (_event, outputDir) => {
    const dir = String(outputDir || '').trim();
    if (!dir) throw new Error('还没有输出目录');
    fs.mkdirSync(dir, { recursive: true });
    const error = await shell.openPath(dir);
    if (error) throw new Error(error);
    return true;
  });
}

module.exports = { registerDeaiIpc, n19FilterChain };
