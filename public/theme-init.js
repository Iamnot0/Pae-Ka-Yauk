/* Theme pre-hydration script.
   Loaded synchronously before React mounts to prevent light→dark FOUC.
   Reads localStorage preference, resolves 'system' to OS preference,
   and sets data-theme on <html> immediately. */
(function () {
  try {
    var t = localStorage.getItem('paeKaYauk.theme') || 'system';
    var resolved = t;
    if (t === 'system') {
      resolved = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    }
    document.documentElement.setAttribute('data-theme', resolved);
  } catch (e) {
    /* noop — falls back to light (default CSS vars) */
  }
})();
