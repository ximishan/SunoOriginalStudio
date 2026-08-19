# AVR N19 exact toolchain notes

SunoOriginalStudio v0.4.0 uses the same third-party command-line toolchain that was found inside the user-supplied AVR Suno Cover 1.77.0 package for the N19 audio path.

## Toolchain

- SoX 14.4.2 Windows bundle (`sox.exe` plus its DLL dependencies)
- imageio FFmpeg Windows x86_64 v7.1 (`ffmpeg-win-x86_64-v7.1.exe`)
- The FFmpeg binary is built with `--enable-librubberband`, so the AVR node-9 `rubberband=pitch=0.975` filter is available.

The Windows build downloads these upstream third-party binaries and rejects the build if their SHA-256 values do not match the binaries extracted from AVR 1.77.0. The application repeats the hash verification at runtime before starting N19 processing.

## Primary binary hashes measured from AVR 1.77.0

```text
FFmpeg
2ce797a0f88d7f067180338fb227f7b1928ea727bd9a4d7a1d022f7c52af71a3  ffmpeg-win-x86_64-v7.1.exe

SoX
 e0e3cdc4bcdfbb5b91ac8f53b024964d092f89ba90130ba74b223a1df11b5439  sox.exe
240a7e47a4274908786220f1b92372ed1b5f2a1c29874292fad5e64f120d84b4  libsox-3.dll
```

The full SoX dependency hash set is kept in `deai.js` and in the GitHub Actions build workflow.

## Exact AVR N19 stage order

```text
source audio
  ↓
00-decode.wav
FFmpeg: stereo / 44100 Hz / PCM16
  ↓
01-scheme1.wav
SoX node 1
  ↓
02-norm.wav
FFmpeg loudnorm: I=-15, TP=-1.5, LRA=11
stereo / 44100 Hz / PCM16
  ↓
03-scheme9.wav
FFmpeg node 9 with Rubber Band pitch=0.975
stereo / 48000 Hz / sample_fmt=s32 / PCM24
metadata stripped
  ↓
final
FFmpeg combined post-processing
stereo / 48000 Hz / PCM16
metadata stripped
```

## SoX node 1 effects

```text
highpass 28
pitch -22
treble -0.20 8500
treble 0 7000
treble -1.5 10000
treble -2.5 12000
lowpass 15000
reverb 15 40 40 45
gain -n -1.8
rate 44100
dither -s
```

## FFmpeg node 9

```text
rubberband=pitch=0.975,
equalizer=f=80:g=4.0:width_type=h:width=80,
equalizer=f=150:g=3.0:width_type=h:width=100,
equalizer=f=300:g=-1.5:width_type=h:width=200,
equalizer=f=1500:g=-1.0:width_type=h:width=400,
equalizer=f=4000:g=3.5:width_type=h:width=2000,
equalizer=f=8000:g=1.8:width_type=h:width=4000,
aecho=0.55:0.4:35|45:0.12|0.08,
volume=2.0,
highpass=f=45,
acompressor=threshold=-18dB:ratio=2.0:attack=10:release=120:makeup=1.5,
volume=2.0dB,
alimiter=limit=0.97
```

## Combined post-processing

```text
highpass=f=28,
equalizer=f=120:g=0.25:width_type=h:width=100,
equalizer=f=1800:g=0.20:width_type=h:width=1200,
equalizer=f=7200:g=-0.18:width_type=h:width=3800,
acompressor=threshold=-19dB:ratio=1.18:attack=24:release=210:makeup=1,
alimiter=limit=0.96
```

## Reproducibility note

v0.4.0 matches the observed AVR 1.77.0 executable hashes, command order, parameters, intermediate sample formats, sample rates and codecs. The SoX chain includes `dither -s`; dither is intentionally noise-based, so two independent runs are not guaranteed to produce a byte-identical final WAV even when the processing implementation and binaries are identical. The implementation therefore uses “exact toolchain / exact execution path” to mean binary-and-command parity with the observed AVR N19 path, not a promise that every output file hash will be identical across separate runs.

## Licensing

SoX, FFmpeg and Rubber Band are third-party open-source projects with their own licenses. They are not authored by this repository. Any redistribution of the bundled Windows executable should preserve the applicable license notices and source-code obligations of those projects.
