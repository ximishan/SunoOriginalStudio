import argparse
import array
import json
import math
import os
import socket
import subprocess
import sys
import tempfile
import time
import wave
from collections import deque
from pathlib import Path
from urllib.parse import urlparse

import requests

USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36'
ACCEPT_LANGUAGE = 'zh-CN,zh;q=0.9,en;q=0.8'
MEDIA_SUFFIXES = ('.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.m3u8', '.mp4', '.webm')


def emit(kind, **payload):
    sys.stderr.write(json.dumps({'kind': kind, **payload}, ensure_ascii=False) + '\n')
    sys.stderr.flush()


def save_url(url: str, output: str, max_attempts: int = 3):
    target = Path(output)
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(target.suffix + '.part')
    headers = {
        'User-Agent': USER_AGENT,
        'Accept-Language': ACCEPT_LANGUAGE,
    }
    session = requests.Session()
    last_error = None
    for attempt in range(1, max_attempts + 1):
        try:
            partial.unlink(missing_ok=True)
            with session.get(url, headers=headers, stream=True, timeout=(15, 60), allow_redirects=True) as response:
                response.raise_for_status()
                total = int(response.headers.get('content-length') or 0)
                done = 0
                emit('http', status=response.status_code, total=total, url=response.url, attempt=attempt)
                with partial.open('wb') as f:
                    for chunk in response.iter_content(chunk_size=256 * 1024):
                        if not chunk:
                            continue
                        f.write(chunk)
                        done += len(chunk)
                        if total:
                            emit('progress', done=done, total=total)
                if done <= 0:
                    raise RuntimeError('empty response body')
                os.replace(partial, target)
                emit('saved', bytes=done, path=str(target))
                return str(target)
        except (requests.exceptions.SSLError,
                requests.exceptions.ConnectionError,
                requests.exceptions.ChunkedEncodingError,
                requests.exceptions.Timeout,
                requests.exceptions.HTTPError,
                OSError) as exc:
            last_error = exc
            emit('retry', attempt=attempt, error=str(exc))
            try:
                partial.unlink(missing_ok=True)
            except OSError:
                pass
            if attempt < max_attempts:
                time.sleep(1.5 * attempt)
    raise RuntimeError(str(last_error or 'download failed'))


def supported_browser():
    roots = [
        os.environ.get('PROGRAMFILES(X86)'),
        os.environ.get('PROGRAMFILES'),
        os.environ.get('LOCALAPPDATA'),
    ]
    candidates = []
    for root in roots:
        if not root:
            continue
        candidates.extend([
            Path(root) / 'Microsoft' / 'Edge' / 'Application' / 'msedge.exe',
            Path(root) / 'Google' / 'Chrome' / 'Application' / 'chrome.exe',
        ])
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    for name in ('msedge.exe', 'chrome.exe'):
        for part in os.environ.get('PATH', '').split(os.pathsep):
            candidate = Path(part) / name
            if candidate.is_file():
                return candidate
    raise RuntimeError('Microsoft Edge / Google Chrome not found')


def reserve_loopback_port():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    s.close()
    return port


def cdp_request(connection, request_id, method, params=None):
    payload = {'id': request_id, 'method': method}
    if params is not None:
        payload['params'] = params
    connection.send(json.dumps(payload))
    while True:
        raw = connection.recv()
        data = json.loads(raw)
        if data.get('id') == request_id:
            if 'error' in data:
                raise RuntimeError(f"CDP {method}: {data['error']}")
            return data.get('result') or {}


def electron_cookie_to_cdp(cookie):
    item = {
        'name': str(cookie.get('name') or ''),
        'value': str(cookie.get('value') or ''),
        'domain': str(cookie.get('domain') or ''),
        'path': str(cookie.get('path') or '/'),
        'secure': bool(cookie.get('secure')),
        'httpOnly': bool(cookie.get('httpOnly')),
    }
    expiration = cookie.get('expirationDate')
    if isinstance(expiration, (int, float)) and expiration > 0:
        item['expires'] = float(expiration)
    same_site = str(cookie.get('sameSite') or '').lower()
    if same_site in ('no_restriction', 'none'):
        item['sameSite'] = 'None'
    elif same_site == 'lax':
        item['sameSite'] = 'Lax'
    elif same_site == 'strict':
        item['sameSite'] = 'Strict'
    return item


def launch_browser(song_id: str, cookies_file: str | None = None):
    import websocket

    browser = supported_browser()
    port = reserve_loopback_port()
    local = os.environ.get('LOCALAPPDATA') or str(Path.home())
    profile = Path(local) / '.suno_downloader_browser'
    profile.mkdir(parents=True, exist_ok=True)
    song_url = f'https://suno.com/song/{song_id}'
    command = [
        str(browser),
        f'--remote-debugging-port={port}',
        '--remote-debugging-address=127.0.0.1',
        '--remote-allow-origins=*',
        f'--user-data-dir={profile}',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--autoplay-policy=no-user-gesture-required',
        '--new-window',
        song_url,
    ]
    creationflags = 0x08000000 if os.name == 'nt' else 0
    proc = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            creationflags=creationflags)
    session = requests.Session()
    session.trust_env = False
    websocket_url = None
    deadline = time.time() + 20
    while time.time() < deadline and proc.poll() is None:
        try:
            pages = session.get(f'http://127.0.0.1:{port}/json', timeout=2).json()
            page = next((p for p in pages if p.get('type') == 'page' and p.get('webSocketDebuggerUrl')), None)
            if page:
                websocket_url = page['webSocketDebuggerUrl']
                break
        except Exception:
            pass
        time.sleep(0.25)
    if not websocket_url:
        proc.terminate()
        raise RuntimeError('browser CDP endpoint not ready')

    conn = websocket.create_connection(websocket_url, timeout=5, origin=f'http://127.0.0.1:{port}')
    req_id = 1
    cdp_request(conn, req_id, 'Runtime.enable'); req_id += 1
    cdp_request(conn, req_id, 'Network.enable'); req_id += 1

    if cookies_file and Path(cookies_file).is_file():
        try:
            cookies = json.loads(Path(cookies_file).read_text(encoding='utf-8'))
            cdp_cookies = [electron_cookie_to_cdp(c) for c in cookies if c.get('name') and c.get('domain')]
            if cdp_cookies:
                cdp_request(conn, req_id, 'Network.setCookies', {'cookies': cdp_cookies}); req_id += 1
        except Exception as exc:
            emit('cookie_warning', error=str(exc))

    cdp_request(conn, req_id, 'Page.navigate', {'url': song_url}); req_id += 1
    ready_deadline = time.time() + 20
    while time.time() < ready_deadline:
        try:
            result = cdp_request(conn, req_id, 'Runtime.evaluate', {
                'expression': 'document.readyState', 'returnByValue': True,
            }); req_id += 1
            value = (((result or {}).get('result') or {}).get('value'))
            if value == 'complete':
                break
        except Exception:
            pass
        time.sleep(0.25)

    return proc, conn, req_id, song_url


def collect_media_urls(conn, req_id):
    script = r'''(() => {
      const urls = new Set();
      for (const entry of performance.getEntriesByType('resource')) {
        if (entry && entry.name) urls.add(entry.name);
      }
      for (const element of document.querySelectorAll('audio, video, audio source, video source')) {
        if (element.currentSrc) urls.add(element.currentSrc);
        if (element.src) urls.add(element.src);
      }
      return Array.from(urls);
    })()'''
    result = cdp_request(conn, req_id, 'Runtime.evaluate', {
        'expression': script, 'returnByValue': True, 'awaitPromise': True,
    })
    value = (((result or {}).get('result') or {}).get('value')) or []
    return value if isinstance(value, list) else []


def trigger_playback(conn, req_id):
    script = r'''(() => {
      const media = document.querySelector('audio, video');
      if (media) {
        try { media.currentTime = 0; } catch (_) {}
        media.muted = false;
        media.volume = 1;
        media.play().catch(() => {});
      }
      const controls = Array.from(document.querySelectorAll('button, [role="button"]'));
      const play = controls.find((item) =>
        /^play$/i.test((item.getAttribute('aria-label') || '').trim())
      ) || controls.find((item) =>
        /play|播放/i.test([
          item.getAttribute('aria-label') || '',
          item.getAttribute('title') || '',
          item.textContent || ''
        ].join(' '))
      );
      if (play) { play.click(); return 'clicked'; }
      return media ? 'media' : 'missing';
    })()'''
    return cdp_request(conn, req_id, 'Runtime.evaluate', {
        'expression': script, 'returnByValue': True, 'awaitPromise': True,
    })


def pick_media_url(urls, song_id):
    scored = []
    seen = set()
    for raw in urls:
        try:
            url = str(raw).strip()
            if not url or url in seen or not url.startswith('https://'):
                continue
            seen.add(url)
            parsed = urlparse(url)
            host = (parsed.hostname or '').lower()
            path = parsed.path.lower()
            score = 0
            if host == 'suno.ai' or host.endswith('.suno.ai'):
                score += 100
            if song_id.lower() in url.lower():
                score += 80
            if any(path.endswith(ext) for ext in MEDIA_SUFFIXES):
                score += 50
            if 'audio' in path:
                score += 20
            if 'cdn' in host or 'cdn' in path:
                score += 10
            if score:
                scored.append((score, url))
        except Exception:
            continue
    scored.sort(key=lambda item: item[0], reverse=True)
    return scored[0][1] if scored else ''


def sniff(song_id: str, cookies_file: str | None = None):
    proc = conn = None
    try:
        proc, conn, req_id, _ = launch_browser(song_id, cookies_file)
        playback_triggered = False
        deadline = time.time() + 18
        while time.time() < deadline:
            urls = collect_media_urls(conn, req_id); req_id += 1
            media = pick_media_url(urls, song_id)
            if media:
                print(media)
                return media
            if not playback_triggered:
                trigger_playback(conn, req_id); req_id += 1
                playback_triggered = True
            time.sleep(0.8)
        return ''
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass
        if proc:
            try:
                proc.terminate()
                proc.wait(timeout=3)
            except Exception:
                try: proc.kill()
                except Exception: pass


def rms_int16(data: bytes):
    samples = array.array('h')
    samples.frombytes(data)
    if not samples:
        return 0.0
    acc = 0.0
    for sample in samples:
        acc += float(sample) * float(sample)
    return math.sqrt(acc / len(samples))


def capture(song_id: str, output: str, ffmpeg: str, cookies_file: str | None = None):
    import pyaudiowpatch as pyaudio

    proc = conn = audio = stream = None
    capture_path = Path(tempfile.mkstemp(prefix='suno_capture_', suffix='.wav')[1])
    target = Path(output)
    partial = target.with_suffix(target.suffix + '.part')
    try:
        proc, conn, req_id, _ = launch_browser(song_id, cookies_file)
        trigger_playback(conn, req_id); req_id += 1

        audio = pyaudio.PyAudio()
        device = audio.get_default_wasapi_loopback()
        rate = int(float(device.get('defaultSampleRate') or 48000))
        channels = int(device.get('maxInputChannels') or 2)
        channels = max(1, min(channels, 2))
        chunk_size = 1024
        stream = audio.open(format=pyaudio.paInt16, channels=channels, rate=rate,
                            input=True, input_device_index=int(device['index']),
                            frames_per_buffer=chunk_size)

        pre_roll = deque(maxlen=max(1, int(rate / chunk_size * 1.5)))
        frames = []
        started = False
        started_at = None
        last_sound_at = None
        sound_deadline = time.time() + 25
        hard_deadline = time.time() + 15 * 60
        threshold = 80.0

        emit('capture_device', rate=rate, channels=channels, name=device.get('name', ''))
        while time.time() < hard_deadline:
            data = stream.read(chunk_size, exception_on_overflow=False)
            level = rms_int16(data)
            now = time.time()
            if not started:
                pre_roll.append(data)
                if level >= threshold:
                    started = True
                    started_at = now
                    last_sound_at = now
                    frames.extend(pre_roll)
                    pre_roll.clear()
                    emit('capture_started', rms=level)
                elif now > sound_deadline:
                    raise RuntimeError('25 秒内没有检测到播放声音')
                continue

            frames.append(data)
            if level >= threshold:
                last_sound_at = now
            elapsed = now - (started_at or now)
            if elapsed >= 20 and last_sound_at and now - last_sound_at >= 6.0:
                break

        if not frames:
            raise RuntimeError('没有录制到音频数据')

        with wave.open(str(capture_path), 'wb') as wav:
            wav.setnchannels(channels)
            wav.setsampwidth(audio.get_sample_size(pyaudio.paInt16))
            wav.setframerate(rate)
            for frame in frames:
                wav.writeframesraw(frame)

        target.parent.mkdir(parents=True, exist_ok=True)
        try: partial.unlink(missing_ok=True)
        except OSError: pass
        command = [str(ffmpeg), '-hide_banner', '-loglevel', 'error', '-y',
                   '-i', str(capture_path), '-vn', '-map_metadata', '-1',
                   '-c:a', 'pcm_s24le', '-f', 'wav', str(partial)]
        creationflags = 0x08000000 if os.name == 'nt' else 0
        result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, encoding='utf-8', errors='replace',
                                creationflags=creationflags)
        if result.returncode != 0:
            raise RuntimeError(result.stderr[-1600:] or 'FFmpeg WAV conversion failed')
        os.replace(partial, target)
        emit('captured', path=str(target), bytes=target.stat().st_size)
        return str(target)
    finally:
        try:
            if stream:
                stream.stop_stream(); stream.close()
        except Exception:
            pass
        try:
            if audio:
                audio.terminate()
        except Exception:
            pass
        try:
            if conn:
                conn.close()
        except Exception:
            pass
        if proc:
            try:
                proc.terminate(); proc.wait(timeout=3)
            except Exception:
                try: proc.kill()
                except Exception: pass
        try: capture_path.unlink(missing_ok=True)
        except OSError: pass
        try:
            if partial.exists() and not target.exists(): partial.unlink()
        except OSError: pass


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='mode', required=True)

    p = sub.add_parser('save-url')
    p.add_argument('--url', required=True)
    p.add_argument('--output', required=True)
    p.add_argument('--max-attempts', type=int, default=3)

    p = sub.add_parser('sniff')
    p.add_argument('--song-id', required=True)
    p.add_argument('--cookies')

    p = sub.add_parser('capture')
    p.add_argument('--song-id', required=True)
    p.add_argument('--output', required=True)
    p.add_argument('--ffmpeg', required=True)
    p.add_argument('--cookies')

    args = parser.parse_args()
    if args.mode == 'save-url':
        print(save_url(args.url, args.output, args.max_attempts))
    elif args.mode == 'sniff':
        media = sniff(args.song_id, args.cookies)
        if not media:
            raise RuntimeError('media url not found')
    elif args.mode == 'capture':
        print(capture(args.song_id, args.output, args.ffmpeg, args.cookies))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        emit('error', error=str(exc))
        sys.exit(1)
