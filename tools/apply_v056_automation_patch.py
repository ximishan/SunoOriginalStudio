from pathlib import Path

parts_dir = Path(__file__).with_name('v056_patch_parts')
parts = sorted(parts_dir.glob('*.part'))
if not parts:
    raise RuntimeError('v0.5.6 patch parts are missing')

source = ''.join(part.read_text(encoding='utf-8') for part in parts)
exec(compile(source, str(Path(__file__).name) + ':combined', 'exec'), {'__name__': '__main__'})
