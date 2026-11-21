// Apply the saved theme and accent before first paint (no flash of the wrong theme).
// Loaded as a blocking script from index.html; see ThemeProvider for the runtime side.
(function () {
  var root = document.documentElement;
  try {
    var saved = localStorage.getItem('pt-theme');
    var prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    var theme = saved === 'light' || saved === 'dark' ? saved : (prefersLight ? 'light' : 'dark');
    root.setAttribute('data-theme', theme);
    var hue = parseInt(localStorage.getItem('pt-hue'), 10);
    if (!isNaN(hue)) root.style.setProperty('--hue', String(((hue % 360) + 360) % 360));
  } catch (e) {
    root.setAttribute('data-theme', 'dark');
  }
})();
