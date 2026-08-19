Legacy profile candidates for automatic migration on Windows:

- `%APPDATA%/Suno原创Demo`
- `%APPDATA%/suno-original-demo`
- `%APPDATA%/Suno Original Studio`

Stable profile from v0.5.1 onward:

- `%APPDATA%/SunoOriginalStudio`

Migration copies the full Chromium profile data before Electron sessions are created, excluding transient lock/cache files.
