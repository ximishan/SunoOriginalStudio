const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { randomUUID } = require('crypto');

let activeProcess = null;
let cancelRequested = false;
let verificationPromise = null;

// These hashes were measured from AVR Suno Cover 1.77.0's bundled N19 toolchain.
// v0.4.0 refuses to label the engine "exact" unless the packaged files match them.
const AVR_TOOLCHAIN_HASHES = Object.freeze({
  'ffmpeg-win-x86_64-v7.1.exe': '2ce797a0f88d7f067180338fb227f7b1928ea727bd9a4d7a1d022f7c52af71a3',
  'sox/sox.exe': 'e0e3cdc4bcdfbb5b91ac8f53b024964d092f89ba90130ba74b223a1df11b5439',
  'sox/libflac-8.dll': '2c154aeaad085e01361b967adfec84b63db76a82a45681b3e6cdfacb6088e369',
  'sox/libgcc_s_sjlj-1.dll': '2af381dbd5ea1a9a150307b1cba3a150321a3c3ff09fb6ead9bba1e880e03a64',
  'sox/libgomp-1.dll': '9dbbb0cb3f31ded7fbf51141a39578c0bc5cc85b83e9b6908657a6083948b9ba',
  'sox/libid3tag-0.dll': '4ec8e74cdd48a388a41f7f3ab2cea810a1661f47e79b6338192f000341f20af0',
  'sox/libogg-0.dll': '3262325b43b6f249831cc15428372a6daa34cf2459e66ed047dbbd9f00f49378',
  'sox/libpng16-16.dll': '22d46adb7927690eeeb1a27f9544108f7a1c66bf1daec90f3c41aa36e176920d',
  'sox/libsox-3.dll': '240a7e47a4274908786220f1b92372ed1b5f2a1c29874292fad5e64f120d84b4',
  'sox/libssp-0.dll': '113da78ba0514b3947e0988376002c4d5f783d62d5058f99259771648f2e9138',
  'sox/libvorbis-0.dll': '03ae1625a47c1255d70e7d63ee42ef2483c7e2adc9a33d21f45799f323a530b4',
  'sox/libvorbisenc-2.dll': '3b809daf958b6dedeedbe05e91a0ac016b18c871b33dc98c728f8b3440874385',
  'sox/libvorbisfile-3.dll': '1a14d8b0749f66811dacb23b093d54d4ff88036d49fd017b0d98b21de7f9ef1d',
  'sox/libwavpack-1.dll': '9123e73f801629a8791c80d9dc5041ee23f7f1d9ed8510f2f758269159aa26b8',
  'sox/libwinpthread-1.dll': '036af4b9aed20a6bd8b1993f2e0a4789c2ba555c00c0b2d72a6d6a6b8c13ef68',
  'sox/zlib1.dll': '189336a0cf1131d6a681e81b43385ade7252f7211df50774772d8c8ec40d5f8f',
});

const SCHEME1_SOX_EFFECTS = Object.freeze([
  'highpass', '28',
  'pitch', '-22',
  'treble', '-0.20', '8500',
  'treble', '0', '7000',
  'treble', '-1.5', '10000',
  'treble', '-2.5', '12000',
  'lowpass', '15000',
  'reverb', '15', '40', '40', '45',
  'gain', '-n', '-1.8',
  'rate', '44100',
  'dither', '-s',
]);

const SCHEME9_AF = 'rubberband=pitch=0.975,equalizer=f=80:g=4.0:width_type=h:width=80,equalizer=f=150:g=3.0:width_type=h:width=100,equalizer=f=300:g=-1.5:width_type=h:width=200,equalizer=f=1500:g=-1.0:width_type=h:width=400,equalizer=f=4000:g=3.5:width_type=h:width=2000,equalizer=f=8000:g=1.8:width_type=h:width=4000,aecho=0.55:0.4:35|45:0.12|0.08,volume=2.0,highpass=f=45,acompressor=threshold=-18dB:ratio=2.0:attack=10:release=120:makeup=1.5,volume=2.0dB,alimiter=limit=0.97';
const SCHEME9_AF_FALLBACK = 'asetrate=48000*0.975,aresample=48000,atempo=1.025641,equalizer=f=80:g=4.0:width_type=h:width=80,equalizer=f=150:g=3.0:width_type=h:width=100,equalizer=f=300:g=-1.5:width_type=h:width=200,equalizer=f=1500:g=-1.0:width_type=h:width=400,equalizer=f=4000:g=3.5:width_type=h:width=2000,equalizer=f=8000:g=1.8:width_type=h:width=4000,aecho=0.55:0.4:35|45:0.12|0.08,volume=2.0,highpass=f=45,acompressor=threshold=-18dB:ratio=2.0:attack=10:release=120:makeup=1.5,volume=2.0dB,alimiter=limit=0.97';
const POSTPROCESS_AF = 'highpass=f=28,equalizer=f=120:g=0.25:width_type=h:width=100,equalizer=f=1800:g=0.20:width_type=h:width=1200,equalizer=f=7200:g=-0.18:width_type=h:width=3800,acompressor=threshold=-19dB:ratio=1.18:attack=24:release=210:makeup=1,alimiter=limit=0.96';
const BETWEEN_NORM_AF = 'loudnorm=I=-15:TP=-1.5:LRA=11';

function candidateToolRoots() {
  const roots = [];
  if (process.resourcesPath) roots.push(path.join(process.resourcesPath, 'tools', 'n19'));
  roots.push(path.join(__dirname, 'vendor', 'avr-n19'));
  return roots;
}

function resolveToolchain() {
  for (const root of candidateToolRoots()) {
    const ffmpeg = path.join(root, 'ffmpeg-win-x86_64-v7.1.exe');
    const sox = path.join(root, 'sox', 'sox.exe');
    if (fs.existsSync(ffmpeg) && fs.existsSync(sox)) return { root, ffmpeg, sox };
  }
  throw new Error('未找到 AVR N19 完整工具链（SoX + Rubber Band FFmpeg）。请使用完整 v0.4.0 安装包。');
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function verifyExactToolchain() {
  if (verificationPromise) return verificationPromise;
  verificationPromise = (async () => {
    const tools = resolveToolchain();
    for (const [relative, expected] of Object.entries(AVR_TOOLCHAIN_HASHES)) {
      const filePath = path.join(tools.root, ...relative.split('/'));
      if (!fs.existsSync(filePath)) throw new Error(`AVR N19 工具链缺少文件：${relative}`);
      const actual = await hashFile(filePath);
      if (actual.toLowerCase() !== expected) {
        throw new Error(`AVR N19 工具链校验失败：${relative}\n期望 ${expected}\n实际 ${actual}`);
      }
    }
    const probe = spawnSync(tools.ffmpeg, ['-hide_banner', '-filters'], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 15000,
    });
    const filterText = `${probe.stdout || ''}\n${probe.stderr || ''}`;
    if (!/\brubberband\b/i.test(filterText)) {
      throw new Error('AVR 原版 FFmpeg 校验通过，但没有检测到 Rubber Band filter，拒绝降级为兼容模式。');
    }
    return { ...tools, rubberband: true, exactHashes: true };
  })().catch(error => {
    verificationPromise = null;
    throw error;
  });
  return verificationPromise;
}

function safeStem(name) {
  const cleaned = String(name || '').replace(/[<>:"/\\|?*]/g, '_').trim();
  return (cleaned || '未命名').slice(0, 80);
}

function uniqueOutputPath(outputDir, inputPath) {
  const stem = safeStem(path.basename(inputPath, path.extname(inputPath)));
  let candidate = path.join(outputDir, `${stem}-消痕-N19.wav`);
  if (!fs.existsSync(candidate)) return candidate;
  return path.join(outputDir, `${stem}-消痕-N19-${randomUUID().replace(/-/g, '').slice(0, 6)}.wav`);
}

function sendProgress(sender, payload) {
  try {
    if (sender && !sender.isDestroyed()) sender.send('deai:progress', payload);
  } catch {}
}

function runProcess(command, args, label, sender, progress = {}) {
  return new Promise((resolve, reject) => {
    if (cancelRequested) return reject(new Error('用户取消了 AI 消痕任务'));
    const child = spawn(command, args, { windowsHide: true });
    activeProcess = child;
    let stdout = '';
    let stderr = '';
    sendProgress(sender, { state: 'stage', ...progress, message: label });

    child.stdout?.on('data', chunk => {
      stdout += chunk.toString();
      if (stdout.length > 16000) stdout = stdout.slice(-16000);
    });
    child.stderr?.on('data', chunk => {
      stderr += chunk.toString();
      if (stderr.length > 24000) stderr = stderr.slice(-24000);
    });
    child.on('error', err => {
      activeProcess = null;
      reject(new Error(`${label}启动失败：${err.message}`));
    });
    child.on('close', code => {
      activeProcess = null;
      if (cancelRequested) return reject(new Error('用户取消了 AI 消痕任务'));
      if (code === 0) return resolve({ stdout, stderr });
      const detail = (stderr || stdout || '').slice(-1800);
      reject(new Error(`${label}失败（exit ${code}）：${detail}`));
    });
  });
}

function runFfmpeg(ffmpeg, args, sender, label, progress) {
  return runProcess(ffmpeg, ['-hide_banner', '-nostdin', '-y', ...args], label, sender, progress);
}

function runSox(sox, args, sender, label, progress) {
  return runProcess(sox, ['--no-show-progress', ...args], label, sender, progress);
}

async function processOneExact(tools, inputPath, outputPath, workRoot, sender, index, total) {
  const source = path.resolve(inputPath);
  const st = fs.statSync(source);
  if (!st.isFile()) throw new Error('音频源不是文件');
  if (st.size > 1024 * 1024 * 1024) throw new Error('音频文件不能超过 1 GB');

  const stageDir = path.join(workRoot, `deai-${randomUUID().replace(/-/g, '').slice(0, 10)}`);
  fs.mkdirSync(stageDir, { recursive: true });
  const decoded = path.join(stageDir, '00-decode.wav');
  const step1 = path.join(stageDir, '01-scheme1.wav');
  const stepNorm = path.join(stageDir, '02-norm.wav');
  const step9 = path.join(stageDir, '03-scheme9.wav');
  const common = { index, total, input: inputPath, output: outputPath };

  try {
    // AVR 1.77.0 exact stage 0: decode to stereo 44.1 kHz PCM16.
    await runFfmpeg(tools.ffmpeg, [
      '-i', source,
      '-vn', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', decoded,
    ], sender, `1/5 解码：${path.basename(inputPath)}`, common);

    // AVR node 1: exact SoX effects and ordering.
    await runSox(tools.sox, [decoded, step1, ...SCHEME1_SOX_EFFECTS], sender, '2/5 SoX 节点 1', common);

    // AVR between-node loudness alignment, still 44.1 kHz PCM16.
    await runFfmpeg(tools.ffmpeg, [
      '-i', step1,
      '-vn', '-ac', '2', '-ar', '44100', '-af', BETWEEN_NORM_AF,
      '-c:a', 'pcm_s16le', stepNorm,
    ], sender, '3/5 节点间响度对齐', common);

    // AVR node 9: the exact bundled FFmpeg has librubberband enabled.
    await runFfmpeg(tools.ffmpeg, [
      '-i', stepNorm,
      '-vn', '-ac', '2', '-ar', '48000', '-af', SCHEME9_AF,
      '-sample_fmt', 's32', '-c:a', 'pcm_s24le', '-map_metadata', '-1', step9,
    ], sender, '4/5 FFmpeg 节点 9（Rubber Band）', common);

    // AVR combined post-processing and final 48 kHz PCM16 WAV.
    await runFfmpeg(tools.ffmpeg, [
      '-i', step9,
      '-vn', '-ac', '2', '-ar', '48000', '-af', POSTPROCESS_AF,
      '-c:a', 'pcm_s16le', '-map_metadata', '-1', outputPath,
    ], sender, '5/5 组合后处理', common);
  } finally {
    try { fs.rmSync(stageDir, { recursive: true, force: true }); } catch {}
  }

  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size <= 0) {
    throw new Error('消痕处理未生成有效文件');
  }
  return outputPath;
}

function registerDeaiIpc({ app, ipcMain, dialog, shell }) {
  ipcMain.handle('deai:engine-info', async () => {
    try {
      const tools = await verifyExactToolchain();
      return {
        ready: true,
        engine: 'AVR N19 exact: SoX + Rubber Band + FFmpeg',
        exact: true,
        rubberband: tools.rubberband,
        ffmpegPath: tools.ffmpeg,
        soxPath: tools.sox,
      };
    } catch (e) {
      return { ready: false, exact: false, engine: 'AVR N19 exact', error: String(e?.message || e) };
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

    const tools = await verifyExactToolchain();
    let outputDir = String(payload.outputDir || '').trim();
    if (!outputDir) outputDir = path.join(path.dirname(files[0]), 'AI消痕输出');
    fs.mkdirSync(outputDir, { recursive: true });
    const workRoot = path.join(app.getPath('temp'), 'SunoOriginalStudio-deai');
    fs.mkdirSync(workRoot, { recursive: true });

    cancelRequested = false;
    const results = [];
    sendProgress(event.sender, {
      state: 'started', total: files.length, outputDir,
      message: `AVR 原版 N19 完整链路已校验，开始处理 ${files.length} 个音频文件`,
    });

    try {
      for (let i = 0; i < files.length; i += 1) {
        const inputPath = files[i];
        if (cancelRequested) throw new Error('用户取消了 AI 消痕任务');
        if (!fs.existsSync(inputPath)) {
          results.push({ input: inputPath, ok: false, error: '文件不存在' });
          continue;
        }
        const outputPath = uniqueOutputPath(outputDir, inputPath);
        try {
          await processOneExact(tools, inputPath, outputPath, workRoot, event.sender, i + 1, files.length);
          results.push({ input: inputPath, output: outputPath, ok: true, exact: true });
          sendProgress(event.sender, {
            state: 'file-complete', index: i + 1, total: files.length,
            input: inputPath, output: outputPath,
            message: `完成 ${i + 1}/${files.length}：${path.basename(outputPath)}`,
          });
        } catch (e) {
          try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
          if (cancelRequested) throw e;
          const error = String(e?.message || e);
          results.push({ input: inputPath, ok: false, error });
          sendProgress(event.sender, {
            state: 'file-error', index: i + 1, total: files.length,
            input: inputPath, message: `处理失败：${path.basename(inputPath)} — ${error}`,
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
      message: cancelRequested ? 'AI 消痕任务已取消' : `AVR N19 完整链路处理完成：成功 ${successCount}/${files.length}`,
    });
    return { outputDir, results, successCount, total: files.length, cancelled: cancelRequested, exact: true };
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

module.exports = {
  registerDeaiIpc,
  SCHEME1_SOX_EFFECTS,
  SCHEME9_AF,
  SCHEME9_AF_FALLBACK,
  BETWEEN_NORM_AF,
  POSTPROCESS_AF,
  AVR_TOOLCHAIN_HASHES,
};
