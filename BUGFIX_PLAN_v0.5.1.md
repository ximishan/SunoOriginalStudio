# v0.5.1 login persistence bugfix

Target: make Suno account sessions survive application upgrades reliably.

Implementation:

1. Pin Electron `userData` and `sessionData` to `%APPDATA%/SunoOriginalStudio` before requiring the main process.
2. On first run, search legacy profile directories used by earlier builds and merge-copy them into the stable profile, including Chromium `Local State` and `Partitions`.
3. Preserve partition names `persist:suno-original-demo-1`, `persist:suno-original-demo-2`, `persist:suno-original-demo-3`.
4. Treat a valid Suno `__session`/`__session_*` cookie as logged in even if Clerk is still hydrating, preventing a false `未登录` state.
5. Keep song-library data in the stable profile too, so future EXE upgrades do not split account and library state.
