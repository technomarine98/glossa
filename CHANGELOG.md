# Changelog

## 1.1.0

- Add a keyless Lingva provider and automatic fallback to configurable Lingva and public LibreTranslate servers.
- Bound request times, retain cooldowns separately for each endpoint, and retry the main provider after it recovers.
- Show the actual provider and mark backup translations in the popup.
- Add controls to disable fallback or change the backup server lists, with disclosure of where selected text is sent.
- Keep primary API keys and contact email out of backup requests, and stop the fallback chain when the user cancels.
- Synchronize package, lockfile, and extension manifest versions and provide an unsigned installation ZIP.
- Add regression coverage for fallback order, opt-out, timeouts, cancellation, credentials, caching, and version/permission consistency.

The default community endpoints returned errors or timeouts during live checks. Their current availability depends on their operators; users can replace the server URLs in settings.
