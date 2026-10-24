// The light/dark toggle on the landing page. A file and not an inline script because the
// Content-Security-Policy allows no inline script (ADR-0017). It shares the key with the apps
// (src/lib/theme.ts) and theme-init.js. With nothing saved, the phone's own setting applies.
(function () {
  var button = document.querySelector('.lp-theme');
  if (!button) return;
  var root = document.documentElement;
  var media = window.matchMedia('(prefers-color-scheme: dark)');

  function isDark() {
    var set = root.getAttribute('data-theme');
    return set ? set === 'dark' : media.matches;
  }
  function show() {
    button.setAttribute('aria-pressed', isDark() ? 'true' : 'false');
  }

  button.addEventListener('click', function () {
    var next = isDark() ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try {
      localStorage.setItem('km-theme', next);
    } catch {
      // Storage blocked: the choice holds until the page closes.
    }
    show();
  });
  media.addEventListener('change', show);
  show();
})();
