const fs = require('fs');

function patchText(file, transform) {
  const original = fs.readFileSync(file, 'utf8');
  const normalized = original.replace(/\r\n/g, '\n');
  const updated = transform(normalized);
  if (updated === normalized) return false;
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  fs.writeFileSync(file, updated.replace(/\n/g, eol), 'utf8');
  return true;
}

const changed = [];

if (patchText('main.js', text => {
  let out = text;
  out = out.replace("    negative_tags: '',", "    negative_tags: String(input.negativeStyle || '').trim(),");
  out = out.replace("    title: 'Suno Original Studio v0.2.0',", "    title: 'Suno Original Studio v0.5.2',");
  if (!out.includes("negative_tags: String(input.negativeStyle || '').trim(),")) throw new Error('main.js: negative_tags patch failed');
  return out;
})) changed.push('main.js');

if (patchText('renderer.js', text => {
  if (text.includes("negativeStyle: $('negativeStyle').value,")) return text;
  const from = "    stylePrompt: $('style').value,\n    slot: $('slot').value,";
  if (!text.includes(from)) throw new Error('renderer.js: submit payload anchor not found');
  return text.replace(from, "    stylePrompt: $('style').value,\n    negativeStyle: $('negativeStyle').value,\n    slot: $('slot').value,");
})) changed.push('renderer.js');

if (patchText('song_library.js', text => {
  if (text.includes("negativeStyle: String(input.negativeStyle || ''),")) return text;
  const from = "      stylePrompt: String(input.stylePrompt || ''),\n      slot: String(task.slot || input.slot || '1'),";
  if (!text.includes(from)) throw new Error('song_library.js: persistence anchor not found');
  return text.replace(from, "      stylePrompt: String(input.stylePrompt || ''),\n      negativeStyle: String(input.negativeStyle || ''),\n      slot: String(task.slot || input.slot || '1'),");
})) changed.push('song_library.js');

if (patchText('index.html', text => {
  let out = text.replace('<h1>Suno Original Studio v0.5.0</h1>', '<h1>Suno Original Studio v0.5.2</h1>');
  if (!out.includes('id="negativeStyle"')) {
    const from = '          <label>风格提示词</label>\n          <input id="style" placeholder="例如：sad piano pop, intimate female vocal, cinematic, slow tempo" />\n          <div class="row3">';
    if (!out.includes(from)) throw new Error('index.html: style input anchor not found');
    out = out.replace(from, '          <label>风格提示词</label>\n          <input id="style" placeholder="例如：sad piano pop, intimate female vocal, cinematic, slow tempo" />\n          <label>排除风格</label>\n          <input id="negativeStyle" placeholder="例如：rap, trap, metal, spoken word, choir" />\n          <div class="small" style="margin-top:6px">填写不希望 Suno 使用的风格、元素或演唱方式，会作为 negative_tags 单独提交。</div>\n          <div class="row3">');
  }
  if (!out.includes('id="negativeStyle"')) throw new Error('index.html: negative style UI patch failed');
  return out;
})) changed.push('index.html');

if (patchText('package.json', text => {
  let out = text;
  out = out.replace('  "version": "0.5.1",', '  "version": "0.5.2",');
  out = out.replace('  "description": "Suno original-song desktop tool with stable persistent Suno sessions, song library, WAV downloads, and exact AVR N19 processing",', '  "description": "Suno original-song desktop tool with excluded-style negative tags, stable persistent Suno sessions, song library, WAV downloads, and exact AVR N19 processing",');
  out = out.replace('      "artifactName": "SunoOriginalStudio_v0.5.1.exe"', '      "artifactName": "SunoOriginalStudio_v0.5.2.exe"');
  if (!out.includes('"version": "0.5.2"') || !out.includes('SunoOriginalStudio_v0.5.2.exe')) throw new Error('package.json: version patch failed');
  return out;
})) changed.push('package.json');

console.log(changed.length ? `Patched: ${changed.join(', ')}` : 'v0.5.2 negative-style patch already applied.');
