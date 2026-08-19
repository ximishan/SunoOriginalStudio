const fs = require('fs');

function patchFile(file, transforms) {
  let text = fs.readFileSync(file, 'utf8');
  let changed = false;
  for (const { from, to, label } of transforms) {
    if (text.includes(to)) continue;
    if (!text.includes(from)) {
      throw new Error(`${file}: cannot find expected source for ${label}`);
    }
    text = text.replace(from, to);
    changed = true;
  }
  if (changed) fs.writeFileSync(file, text, 'utf8');
  return changed;
}

const changed = [];

if (patchFile('main.js', [
  {
    label: 'negative_tags payload',
    from: "    negative_tags: '',",
    to: "    negative_tags: String(input.negativeStyle || '').trim(),",
  },
  {
    label: 'window title',
    from: "    title: 'Suno Original Studio v0.2.0',",
    to: "    title: 'Suno Original Studio v0.5.2',",
  },
])) changed.push('main.js');

if (patchFile('renderer.js', [
  {
    label: 'negative style submit field',
    from: "    stylePrompt: $('style').value,\n    slot: $('slot').value,",
    to: "    stylePrompt: $('style').value,\n    negativeStyle: $('negativeStyle').value,\n    slot: $('slot').value,",
  },
])) changed.push('renderer.js');

if (patchFile('song_library.js', [
  {
    label: 'persist negative style',
    from: "      stylePrompt: String(input.stylePrompt || ''),\n      slot: String(task.slot || input.slot || '1'),",
    to: "      stylePrompt: String(input.stylePrompt || ''),\n      negativeStyle: String(input.negativeStyle || ''),\n      slot: String(task.slot || input.slot || '1'),",
  },
])) changed.push('song_library.js');

if (patchFile('index.html', [
  {
    label: 'page version',
    from: '<h1>Suno Original Studio v0.5.0</h1>',
    to: '<h1>Suno Original Studio v0.5.2</h1>',
  },
  {
    label: 'negative style input',
    from: '          <label>风格提示词</label>\n          <input id="style" placeholder="例如：sad piano pop, intimate female vocal, cinematic, slow tempo" />\n          <div class="row3">',
    to: '          <label>风格提示词</label>\n          <input id="style" placeholder="例如：sad piano pop, intimate female vocal, cinematic, slow tempo" />\n          <label>排除风格</label>\n          <input id="negativeStyle" placeholder="例如：rap, trap, metal, spoken word, choir" />\n          <div class="small" style="margin-top:6px">填写不希望 Suno 使用的风格、元素或演唱方式，会作为 negative_tags 单独提交。</div>\n          <div class="row3">',
  },
])) changed.push('index.html');

if (patchFile('package.json', [
  {
    label: 'package version',
    from: '  "version": "0.5.1",',
    to: '  "version": "0.5.2",',
  },
  {
    label: 'description',
    from: '  "description": "Suno original-song desktop tool with stable persistent Suno sessions, song library, WAV downloads, and exact AVR N19 processing",',
    to: '  "description": "Suno original-song desktop tool with excluded-style negative tags, stable persistent Suno sessions, song library, WAV downloads, and exact AVR N19 processing",',
  },
  {
    label: 'artifact name',
    from: '      "artifactName": "SunoOriginalStudio_v0.5.1.exe"',
    to: '      "artifactName": "SunoOriginalStudio_v0.5.2.exe"',
  },
])) changed.push('package.json');

console.log(changed.length ? `Patched: ${changed.join(', ')}` : 'v0.5.2 negative-style patch already applied.');
