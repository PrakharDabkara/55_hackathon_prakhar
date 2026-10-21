// Sets the saved look before the first paint, so there is no flash. It is a file and not an inline
// script because the Content-Security-Policy allows no inline script (ADR-0017, ADR-0054). Keep the
// key in step with src/lib/theme.ts.
(function () {
  try {
    var saved = localStorage.getItem('km-theme');
    if (saved === 'light' || saved === 'dark') {
      document.documentElement.setAttribute('data-theme', saved);
    }
  } catch {
    // Storage blocked: the phone's own setting applies.
  }
})();
