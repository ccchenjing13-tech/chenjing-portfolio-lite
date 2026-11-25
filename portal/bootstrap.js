(() => {
  const completedKey = 'planet-portal-completed-v1';
  const html = document.documentElement;
  const preview = new URLSearchParams(location.search).get('preview') === '1';
  let completed = false;
  let active = null;
  try { completed = localStorage.getItem(completedKey) === '1'; } catch { /* Storage is optional. */ }
  const showOnLoad = preview || (!completed && !location.hash);
  if (showOnLoad) html.classList.add('portal-pending');
  const pendingTimeout = setTimeout(() => html.classList.remove('portal-pending'), 8000);

  async function explore() {
    if (active) return;
    const root = document.getElementById('planet-portal-template')?.content.firstElementChild?.cloneNode(true);
    if (!root) return;

    const home = document.querySelector('.page');
    const lightbox = document.getElementById('lightbox');
    const background = [home, lightbox].filter(element => element && !element.inert);
    const lifetime = new AbortController();
    const session = {dispose: null, unload: null};
    const finish = ({record = true, focus = true} = {}) => {
      if (active !== session) return;
      active = null;
      lifetime.abort();
      session.dispose?.();
      root.remove();
      html.classList.remove('portal-open', 'portal-pending', 'portal-revealing');
      for (const element of background) element.inert = false;
      if (record && !preview) {
        try { localStorage.setItem(completedKey, '1'); } catch { /* Storage is optional. */ }
      }
      if (focus) {
        const heading = home?.querySelector('#top h1');
        if (heading) {
          heading.classList.add('portal-focus-target');
          heading.tabIndex = -1;
          heading.focus({preventScroll: true});
        }
      }
    };
    active = session;
    for (const element of background) element.inert = true;
    html.classList.add('portal-open');
    document.body.append(root);
    root.addEventListener('portal-flightchange', event => {
      if (event.detail.state === 'TRANSITIONING') html.classList.add('portal-revealing');
    }, {signal: lifetime.signal});
    const playing = [...document.querySelectorAll('.page video')].filter(video => !video.paused);
    playing.forEach(video => video.pause());

    html.classList.remove('portal-pending');
    window.scrollTo({top: 0, behavior: 'instant'});
    root.tabIndex = -1;
    root.focus({preventScroll: true});

    const skip = root.querySelector('#portal-skip');
    const loading = new AbortController();
    skip.addEventListener('click', event => {
      event.preventDefault();
      finish();
    }, {signal: loading.signal});
    window.addEventListener('pagehide', () => {
      if (session.unload) session.unload();
      else finish({record: false, focus: false});
    }, {signal: lifetime.signal});

    try {
      const {mountPortal} = await import('./portal.js');
      if (active !== session) return;
      const portal = mountPortal(root, finish);
      session.dispose = portal.dispose;
      session.unload = portal.unload;
    } catch (error) {
      console.error('Planet Portal could not start:', error);
      finish({record: false});
    } finally {
      loading.abort();
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    clearTimeout(pendingTimeout);
    const replay = document.getElementById('portal-replay');
    if (replay) {
      replay.hidden = false;
      replay.addEventListener('click', explore);
    }
    if (showOnLoad) void explore();
    html.classList.remove('portal-pending');
  }, {once: true});
})();
