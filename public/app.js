(function (global) {
  'use strict';

  var API_BASE = 'https://b2-storage-kappa.vercel.app';
  var DEFAULT_USER = 'jafernegery';
  var LS_API_KEY = 'xapiKey';
  var PAGE_SIZE = 60;
  var LOAD_MORE_THRESHOLD_PX = 600;

  var grid = document.getElementById('linksGrid');
  var loadingEl = document.getElementById('gridLoading');
  var panelPosts = document.getElementById('panel-posts');
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab-btn'));
  var panels = Array.prototype.slice.call(document.querySelectorAll('.tab-panel'));
  var player = {
    overlay: document.getElementById('playerOverlay'),
    video: document.getElementById('playerVideo'),
    loading: document.getElementById('playerLoading'),
    pause: document.getElementById('playerPauseInd'),
    close: document.getElementById('playerClose'),
    title: document.getElementById('playerTitle'),
    author: document.getElementById('playerAuthor'),
    caption: document.getElementById('playerCaption'),
    likes: document.getElementById('railLikes'),
    likeButton: document.getElementById('railLike'),
    muteButton: document.getElementById('railMute'),
    downloadButton: document.getElementById('railDownload'),
    size: document.getElementById('playerSize')
  };

  var state = { items: [], offset: 0, hasMore: true, loading: false, loadMoreEl: null, requestId: 0 };
  var currentItem = null;
  var pauseTimer = 0;
  var previousFocus = null;

  function getApiKey() {
    try { return global.localStorage.getItem(LS_API_KEY) || ''; }
    catch (error) { return ''; }
  }

  function formatCount(value) {
    var number = Number(value) || 0;
    if (number >= 1e9) return (number / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (number >= 1e6) return (number / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (number >= 1e3) return (number / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(number);
  }

  function formatBytes(value) {
    var bytes = Number(value) || 0;
    if (bytes <= 0) return '—';
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + ' GB';
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
    if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
    return bytes + ' B';
  }

  function formatDate(value) {
    if (!value) return '';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function validMediaUrl(value) {
    if (!value) return '';
    try {
      var url = new URL(value, global.location.href);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
    } catch (error) { return ''; }
  }

  async function request(url, options) {
    var init = Object.assign({}, options || {});
    var key = getApiKey();
    if (key) {
      init.headers = Object.assign({}, init.headers || {}, { 'X-API-Key': key });
    }
    var response = await fetch(url, init);
    if (response.status === 401) {
      try { global.localStorage.removeItem(LS_API_KEY); } catch (error) { /* storage may be disabled */ }
    }
    return response;
  }

  function switchTab(name) {
    tabs.forEach(function (tab) {
      var active = tab.dataset.tab === name;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    panels.forEach(function (panel) {
      var active = panel.id === 'panel-' + name;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
    });
  }

  function setInitialLoading(show) {
    if (loadingEl) loadingEl.hidden = !show;
  }

  function showMessage(title, detail, retry) {
    if (!grid) return;
    var message = document.createElement('div');
    message.className = 'grid-message';
    var heading = document.createElement('strong');
    heading.textContent = title;
    message.appendChild(heading);
    if (detail) {
      var copy = document.createElement('span');
      copy.textContent = detail;
      message.appendChild(copy);
    }
    if (retry) {
      var button = document.createElement('button');
      button.className = 'retry-button';
      button.type = 'button';
      button.textContent = 'Try again';
      button.addEventListener('click', load);
      message.appendChild(button);
    }
    grid.appendChild(message);
  }

  function makeCard(item) {
    var card = document.createElement('button');
    card.className = 'grid-item';
    card.type = 'button';
    card.setAttribute('aria-label', 'Play video' + (item.postedDate ? ' posted ' + formatDate(item.postedDate) : ''));
    var cover = validMediaUrl(item.coverUrl);
    var video = validMediaUrl(item.videoUrl);
    card.dataset.video = video;
    card.dataset.key = item.videoKey || '';
    card.dataset.size = String(Number(item.fileSize) || 0);
    card.dataset.likes = String(Number(item.likes) || 0);
    card.dataset.date = item.postedDate || '';

    var thumb = document.createElement('span');
    thumb.className = 'thumb';
    if (cover) {
      var image = document.createElement('img');
      image.src = cover;
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.addEventListener('error', function () { image.remove(); });
      thumb.appendChild(image);
    }
    var date = document.createElement('span');
    date.className = 'posted-date';
    date.textContent = formatDate(item.postedDate);
    card.appendChild(thumb);
    card.appendChild(date);
    return card;
  }

  function renderItems(items, append) {
    if (!grid) return;
    if (!append) {
      Array.prototype.slice.call(grid.children).forEach(function (child) {
        if (child !== loadingEl && child !== state.loadMoreEl) child.remove();
      });
    }
    var fragment = document.createDocumentFragment();
    items.forEach(function (item) { fragment.appendChild(makeCard(item)); });
    if (state.loadMoreEl && state.loadMoreEl.parentNode === grid) {
      grid.insertBefore(fragment, state.loadMoreEl);
    } else {
      grid.appendChild(fragment);
    }
  }

  async function fetchPage(offset) {
    var params = new URLSearchParams({ userId: DEFAULT_USER, limit: String(PAGE_SIZE), offset: String(offset) });
    var response = await request(API_BASE + '/api/explore-videos?' + params.toString());
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok || !data.success) throw new Error(data.error || ('Unable to load videos (HTTP ' + response.status + ').'));
    return { items: Array.isArray(data.items) ? data.items : [], hasMore: Boolean(data.hasMore) };
  }

  function ensureLoadMore() {
    if (state.loadMoreEl) return state.loadMoreEl;
    var el = document.createElement('div');
    el.className = 'grid-load-more';
    el.setAttribute('role', 'status');
    state.loadMoreEl = el;
    return el;
  }

  function showLoadMore(isError) {
    var el = ensureLoadMore();
    el.classList.toggle('is-error', Boolean(isError));
    el.replaceChildren();
    if (isError) {
      var retry = document.createElement('button');
      retry.className = 'retry-button';
      retry.type = 'button';
      retry.textContent = 'Could not load more — retry';
      retry.addEventListener('click', loadNextPage, { once: true });
      el.appendChild(retry);
    } else {
      var spinner = document.createElement('span');
      spinner.className = 'spinner';
      spinner.setAttribute('aria-hidden', 'true');
      var text = document.createElement('span');
      text.textContent = 'Loading more videos…';
      el.append(spinner, text);
    }
    if (!el.parentNode && grid) grid.appendChild(el);
  }

  function hideLoadMore() {
    if (state.loadMoreEl && state.loadMoreEl.parentNode) state.loadMoreEl.remove();
  }

  async function load() {
    if (!grid || state.loading) return;
    var requestId = ++state.requestId;
    state.loading = true;
    state.items = [];
    state.offset = 0;
    state.hasMore = true;
    hideLoadMore();
    setInitialLoading(true);
    Array.prototype.slice.call(grid.children).forEach(function (child) {
      if (child !== loadingEl) child.remove();
    });
    try {
      var page = await fetchPage(0);
      if (requestId !== state.requestId) return;
      state.items = page.items;
      state.offset = page.items.length;
      state.hasMore = page.hasMore;
      renderItems(page.items, true);
      if (!page.items.length) showMessage('No videos found', 'There are no videos available right now.');
    } catch (error) {
      if (requestId !== state.requestId) return;
      console.error('[VideoExplore] initial load failed:', error);
      showMessage('Videos could not be loaded', error.message || 'Check your connection and try again.', true);
    } finally {
      if (requestId === state.requestId) {
        state.loading = false;
        setInitialLoading(false);
      }
    }
  }

  async function loadNextPage() {
    if (state.loading || !state.hasMore) return;
    state.loading = true;
    showLoadMore(false);
    try {
      var page = await fetchPage(state.offset);
      if (!page.items.length) {
        state.hasMore = false;
        hideLoadMore();
        return;
      }
      state.items = state.items.concat(page.items);
      state.offset += page.items.length;
      state.hasMore = page.hasMore;
      renderItems(page.items, true);
      hideLoadMore();
    } catch (error) {
      console.error('[VideoExplore] next page failed:', error);
      showLoadMore(true);
    } finally {
      state.loading = false;
    }
  }

  function onPanelScroll() {
    if (!panelPosts || state.loading || !state.hasMore || !panelPosts.classList.contains('active')) return;
    var bounds = panelPosts.getBoundingClientRect();
    if (bounds.bottom <= global.innerHeight + LOAD_MORE_THRESHOLD_PX) loadNextPage();
  }

  function showPlayerLoading(show) {
    if (player.loading) player.loading.classList.toggle('show', Boolean(show));
  }

  function flashPause() {
    if (!player.pause) return;
    player.pause.classList.add('show');
    global.clearTimeout(pauseTimer);
    pauseTimer = global.setTimeout(function () { player.pause.classList.remove('show'); }, 500);
  }

  function openPlayer(item) {
    if (!item || !validMediaUrl(item.videoUrl) || !player.overlay || !player.video) return;
    currentItem = item;
    previousFocus = document.activeElement;
    player.video.pause();
    player.video.src = validMediaUrl(item.videoUrl);
    player.video.muted = false;
    player.video.currentTime = 0;
    player.title.textContent = item.datePosted ? formatDate(item.datePosted) : 'Video';
    player.author.textContent = '@' + DEFAULT_USER;
    player.caption.textContent = item.caption || '';
    player.likes.textContent = formatCount(item.likes);
    player.size.textContent = formatBytes(item.fileSize);
    player.likeButton.classList.remove('is-active');
    player.likeButton.setAttribute('aria-pressed', 'false');
    player.likeButton.querySelector('i').className = 'fa-regular fa-heart';
    player.muteButton.querySelector('i').className = 'fa-solid fa-volume-high';
    player.muteButton.setAttribute('aria-label', 'Mute video');
    player.overlay.hidden = false;
    player.overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('player-open');
    showPlayerLoading(true);
    player.close.focus();
    var playback = player.video.play();
    if (playback && typeof playback.catch === 'function') playback.catch(function () { showPlayerLoading(false); flashPause(); });
  }

  function closePlayer() {
    if (!player.overlay || player.overlay.hidden) return;
    player.video.pause();
    player.video.removeAttribute('src');
    player.video.load();
    player.overlay.hidden = true;
    player.overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('player-open');
    currentItem = null;
    global.clearTimeout(pauseTimer);
    if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
  }

  function setDownloadFeedback(success) {
    var icon = player.downloadButton && player.downloadButton.querySelector('i');
    if (!icon) return;
    icon.className = success ? 'fa-solid fa-check' : 'fa-solid fa-triangle-exclamation';
    global.setTimeout(function () { icon.className = 'fa-solid fa-download'; }, 1400);
  }

  async function downloadCurrent() {
    if (!currentItem || !currentItem.videoKey) { setDownloadFeedback(false); return; }
    var button = player.downloadButton;
    button.disabled = true;
    var icon = button.querySelector('i');
    icon.className = 'fa-solid fa-circle-notch fa-spin';
    try {
      var params = new URLSearchParams({ videoKey: currentItem.videoKey, userId: DEFAULT_USER, disposition: 'attachment' });
      var response = await request(API_BASE + '/api/download-b2-file?' + params.toString());
      var data = await response.json().catch(function () { return {}; });
      var downloadUrl = validMediaUrl(data.downloadUrl);
      if (!response.ok || !data.success || !downloadUrl) throw new Error(data.error || 'Download is unavailable.');
      var link = document.createElement('a');
      link.href = downloadUrl;
      link.download = String(currentItem.videoKey).split('/').pop() || 'video';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setDownloadFeedback(true);
    } catch (error) {
      console.error('[VideoExplore] download failed:', error);
      setDownloadFeedback(false);
    } finally {
      button.disabled = false;
    }
  }

  function bindEvents() {
    tabs.forEach(function (tab, index) {
      tab.addEventListener('click', function () { switchTab(tab.dataset.tab); });
      tab.addEventListener('keydown', function (event) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        var direction = event.key === 'ArrowRight' ? 1 : -1;
        var next = (index + direction + tabs.length) % tabs.length;
        tabs[next].focus();
        switchTab(tabs[next].dataset.tab);
      });
    });

    if (grid) grid.addEventListener('click', function (event) {
      var card = event.target.closest('.grid-item');
      if (!card || !grid.contains(card)) return;
      if (!card.dataset.video) return;
      openPlayer({ videoUrl: card.dataset.video, videoKey: card.dataset.key, fileSize: card.dataset.size, likes: card.dataset.likes, datePosted: card.dataset.date });
    });
    if (panelPosts) panelPosts.addEventListener('scroll', onPanelScroll, { passive: true });
    global.addEventListener('scroll', onPanelScroll, { passive: true });
    global.addEventListener('resize', onPanelScroll, { passive: true });

    player.close.addEventListener('click', closePlayer);
    player.video.addEventListener('click', function () {
      if (player.video.paused) player.video.play().catch(function () {});
      else { player.video.pause(); flashPause(); }
    });
    ['loadeddata', 'canplay', 'playing'].forEach(function (eventName) { player.video.addEventListener(eventName, function () { showPlayerLoading(false); }); });
    player.video.addEventListener('waiting', function () { showPlayerLoading(true); });
    player.video.addEventListener('error', function () { showPlayerLoading(false); });

    player.muteButton.addEventListener('click', function () {
      player.video.muted = !player.video.muted;
      var muted = player.video.muted;
      player.muteButton.querySelector('i').className = muted ? 'fa-solid fa-volume-xmark' : 'fa-solid fa-volume-high';
      player.muteButton.setAttribute('aria-label', muted ? 'Unmute video' : 'Mute video');
    });
    player.likeButton.addEventListener('click', function () {
      var liked = !player.likeButton.classList.contains('is-active');
      player.likeButton.classList.toggle('is-active', liked);
      player.likeButton.setAttribute('aria-pressed', String(liked));
      player.likeButton.querySelector('i').className = liked ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
    });
    player.downloadButton.addEventListener('click', downloadCurrent);

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !player.overlay.hidden) closePlayer();
    });
    var touchStartY = null;
    player.overlay.addEventListener('touchstart', function (event) {
      if (event.touches.length === 1) touchStartY = event.touches[0].clientY;
    }, { passive: true });
    player.overlay.addEventListener('touchend', function (event) {
      if (touchStartY === null) return;
      if (event.changedTouches[0].clientY - touchStartY > 110) closePlayer();
      touchStartY = null;
    }, { passive: true });
  }

  function boot() {
    if (!grid || !player.overlay) return;
    switchTab('posts');
    bindEvents();
    load();
  }

  global.AppDownloadLinks = Object.freeze({ init: load, load: load, getApiKey: getApiKey });
  global.AppVideoPlayer = Object.freeze({ open: openPlayer, close: closePlayer, download: downloadCurrent });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})(window);
