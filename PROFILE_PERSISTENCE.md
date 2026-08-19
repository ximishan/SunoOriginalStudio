# Login persistence regression note

v0.5.0 introduced a persistent song library but users reported that the Suno login state could appear lost after upgrading from v0.4.0.

Fix plan for v0.5.1:

- pin Electron userData/sessionData to a stable Windows profile directory independent of EXE filename/version;
- migrate legacy profile directories on first run, preserving Chromium `Local State` and persistent `Partitions/suno-original-demo-*` data so Clerk/Suno cookies remain decryptable;
- avoid false logout UI states caused by temporarily unhydrated `window.Clerk.session` when a valid persistent `__session` cookie still exists;
- keep the existing partition names unchanged (`persist:suno-original-demo-1..3`).

The migration must happen before any Electron BrowserWindow/session is created.
