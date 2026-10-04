// Keep this independent of game/rendering code so a broken arena can still
// explain its first failure and provide a working reload button.
export function installRuntimeErrors(stop) {
  let failed = false;
  const screen = document.getElementById('fatal-screen');
  const retry = document.getElementById('retry-button');
  retry.addEventListener('click', () => location.reload());

  function report(error, context = 'Runtime error', location = '') {
    if (failed) return;
    failed = true;
    let detail = 'No error detail was provided.';
    try {
      if (error && typeof error.message === 'string') detail = `${error.name || 'Error'}: ${error.message}`;
      else if (error !== undefined && error !== null) detail = String(error);
    } catch { /* Even an unreadable rejection reason must leave Reload usable. */ }
    document.getElementById('fatal-message').textContent = 'The game stopped after an unexpected problem. Take a photo of these details, then reload to try again.';
    document.getElementById('fatal-details').textContent = `${context}: ${detail.slice(0, 500)}${location ? `\nLocation: ${location}` : ''}\nWebView: ${navigator.userAgent}`;
    document.body.dataset.mode = 'fatal';
    for (const element of document.querySelectorAll('.screen, .modal-screen, #game-ui')) element.hidden = element !== screen;
    for (const control of document.querySelectorAll('button, input, select')) control.disabled = control !== retry;
    screen.hidden = false;
    // Mark and display the failure before cleanup: later errors must never
    // replace its cause or prevent the recovery screen from being shown.
    try { stop(); } catch { /* Reload is still available if shutdown fails. */ }
    retry.focus();
  }

  window.addEventListener('error', event => {
    // Failed image/resource loads are not uncaught application exceptions.
    if (event.target !== window || (!event.error && typeof event.message !== 'string')) return;
    const location = event.filename ? `${event.filename.split('/').pop()}:${event.lineno || 0}:${event.colno || 0}` : '';
    report(event.error || event.message, 'Runtime error', location);
  });
  window.addEventListener('unhandledrejection', event => report(event.reason, 'Unhandled promise'));
  return { report, get failed() { return failed; } };
}
