const fs = require('fs');

function patchFile(file, transforms) {
  let text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  let changed = false;
  for (const { from, to, label } of transforms) {
    if (text.includes(to)) continue;
    if (!text.includes(from)) throw new Error(`${file}: cannot find expected source for ${label}`);
    text = text.replace(from, to);
    changed = true;
  }
  if (changed) fs.writeFileSync(file, text, 'utf8');
  return changed;
}

const changed = [];

if (patchFile('song_library.js', [
  {
    label: 'skip already processed songs',
    from: `      if (!/^(complete|completed)$/i.test(String(song.generationStatus || ''))) {\n        throw new Error(\`歌曲尚未生成完成：\${song.generationStatus || 'submitted'}\`);\n      }\n\n      const dir = songDir(rootDir, song);`,
    to: `      if (!/^(complete|completed)$/i.test(String(song.generationStatus || ''))) {\n        throw new Error(\`歌曲尚未生成完成：\${song.generationStatus || 'submitted'}\`);\n      }\n\n      // v0.5.3 safety guard: a completed N19 result is authoritative.\n      // Even if the renderer sends this clipId again, never download/process it twice.\n      if (String(song.deaiStatus || '').toLowerCase() === 'complete') {\n        emit(sender, { type: 'progress', clipId: song.clipId, message: '这首歌已经完成 AI 消痕，已自动跳过，不会重复处理。' });\n        results.push({\n          clipId: song.clipId,\n          ok: true,\n          skipped: true,\n          reason: 'already_processed',\n          localDir: song.localDir || '',\n          sourceWavPath: song.sourceWavPath || '',\n          processedWavPath: song.processedWavPath || '',\n          lyricsPath: song.lyricsPath || '',\n        });\n        continue;\n      }\n\n      const dir = songDir(rootDir, song);`,
  },
  {
    label: 'return skipped count',
    from: `  return { rootDir, results, successCount: results.filter(x => x.ok).length, total: results.length };`,
    to: `  return {\n    rootDir,\n    results,\n    successCount: results.filter(x => x.ok && !x.skipped).length,\n    skippedCount: results.filter(x => x.skipped).length,\n    failureCount: results.filter(x => !x.ok).length,\n    total: results.length,\n  };`,
  },
])) changed.push('song_library.js');

if (patchFile('renderer.js', [
  {
    label: 'disable completed songs in selection',
    from: `    const canSelect = isSongComplete(song) && song.deaiStatus !== 'processing';\n    const checked = selectedSongIds.has(song.clipId) ? 'checked' : '';`,
    to: `    const canSelect = isSongComplete(song) && song.deaiStatus !== 'processing' && song.deaiStatus !== 'complete';\n    if (!canSelect) selectedSongIds.delete(song.clipId);\n    const checked = canSelect && selectedSongIds.has(song.clipId) ? 'checked' : '';`,
  },
  {
    label: 'exclude completed songs from select all',
    from: `    if (isSongComplete(song) && song.deaiStatus !== 'processing') selectedSongIds.add(song.clipId);`,
    to: `    if (isSongComplete(song) && song.deaiStatus !== 'processing' && song.deaiStatus !== 'complete') selectedSongIds.add(song.clipId);`,
  },
  {
    label: 'show skipped count',
    from: `    const failed = (result.results || []).filter(x => !x.ok);\n    libraryLog(\`处理完成：成功 \${result.successCount}/\${result.total}\${failed.length ? \`，失败 \${failed.length}\` : ''}。\`, failed.length ? 'warn' : 'oktxt');`,
    to: `    const failed = (result.results || []).filter(x => !x.ok);\n    const skipped = Number(result.skippedCount || 0);\n    libraryLog(\`处理完成：新处理成功 \${result.successCount}，已消痕跳过 \${skipped}\${failed.length ? \`，失败 \${failed.length}\` : ''}。\`, failed.length ? 'warn' : 'oktxt');`,
  },
])) changed.push('renderer.js');

if (patchFile('main.js', [
  {
    label: 'window version',
    from: `    title: 'Suno Original Studio v0.5.2',`,
    to: `    title: 'Suno Original Studio v0.5.3',`,
  },
])) changed.push('main.js');

if (patchFile('index.html', [
  {
    label: 'page version',
    from: '<h1>Suno Original Studio v0.5.2</h1>',
    to: '<h1>Suno Original Studio v0.5.3</h1>',
  },
  {
    label: 'library no-repeat note',
    from: '            <div class="small">提交后的每个 Suno 版本单独记录。生成完成后可直接勾选并执行 AI 消痕。</div>',
    to: '            <div class="small">提交后的每个 Suno 版本单独记录。已完成 AI 消痕的歌曲会自动锁定并跳过，不会重复处理。</div>',
  },
])) changed.push('index.html');

if (patchFile('package.json', [
  {
    label: 'package version',
    from: '  "version": "0.5.2",',
    to: '  "version": "0.5.3",',
  },
  {
    label: 'artifact name',
    from: '      "artifactName": "SunoOriginalStudio_v0.5.2.exe"',
    to: '      "artifactName": "SunoOriginalStudio_v0.5.3.exe"',
  },
])) changed.push('package.json');

console.log(changed.length ? `Patched: ${changed.join(', ')}` : 'v0.5.3 no-repeat AI trace cleaning patch already applied.');
