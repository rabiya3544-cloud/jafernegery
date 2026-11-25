(function (global) {
    'use strict';

    /* ============================================================
       CONFIG / CONSTANTS
       ============================================================ */
    var API_BASE = 'https://b2-storage-kappa.vercel.app';
    var DEFAULT_USER = 'jafernegery';
    var LS_API_KEY = 'xapiKey';

    var PAGE_SIZE = 60;
    var LOAD_MORE_THRESHOLD_PX = 500;

    var HTML_ESCAPES = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };
    var HTML_ESCAPES_RE = /[\u0026\u003C\u003E\u0022\u0027]/g;

    /* ============================================================
       DOM REFERENCES
       ============================================================ */
    var tabButtons = document.querySelectorAll('.tab-btn');
    var tabPanels = document.querySelectorAll('.tab-panel');

    var dl = {
        linksGrid: document.getElementById('linksGrid'),
        linksLoadBtn: document.getElementById('linksLoadBtn'),
        panelPosts: document.getElementById('panel-posts'),
        gridLoading: document.getElementById('gridLoading')
    };

    var vp = {
        overlay: document.getElementById('playerOverlay'),
        video: document.getElementById('playerVideo'),
        loading: document.getElementById('playerLoading'),
        pauseInd: document.getElementById('playerPauseInd'),
        close: document.getElementById('playerClose'),
        title: document.getElementById('playerTitle'),
        author: document.getElementById('playerAuthor'),
        caption: document.getElementById('playerCaption'),
        likes: document.getElementById('railLikes'),
        railLike: document.getElementById('railLike'),
        railMute: document.getElementById('railMute'),
        railDownload: document.getElementById('railDownload'),
        size: document.getElementById('playerSize')
    };

    /* ============================================================
       STATE
       ============================================================ */
    var apiKey = localStorage.getItem(LS_API_KEY) || '3544';

    var state = {
        items: [],
        offset: 0,
        hasMore: true,
        loading: false,
        loadMoreEl: null
    };

    var currentItem = null;
    var hidePauseTimer = null;
    var scrollScheduled = false;

    /* ============================================================
       HELPERS
       ============================================================ */
    function escHtml(s) {
        return String(s).replace(HTML_ESCAPES_RE, function (c) {
            return HTML_ESCAPES[c];
        });
    }

    function fmtBytes(b) {
        if (!b || b < 0) {
            return '—';
        }
        if (b >= 1073741824) {
            return (b / 1073741824).toFixed(2) + ' GB';
        }
        if (b >= 1048576) {
            return (b / 1048576).toFixed(1) + ' MB';
        }
        if (b >= 1024) {
            return Math.round(b / 1024) + ' KB';
        }
        return b + ' B';
    }

    function fmtCount(n) {
        var v = Number(n) || 0;
        if (v >= 1e9) {
            return (v / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
        }
        if (v >= 1e6) {
            return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
        }
        if (v >= 1e3) {
            return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
        }
        return String(v);
    }

    function formatPostedDate(s) {
        if (!s) {
            return '';
        }
        var d = new Date(s + 'T00:00:00');
        if (isNaN(d)) {
            return '';
        }
        return d.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    }

    function shuffle(arr) {
        for (var i = arr.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var t = arr[i];
            arr[i] = arr[j];
            arr[j] = t;
        }
        return arr;
    }

    function splitIntoGroups(items, n) {
        var copy = shuffle(items.slice());
        var groups = Array.from({ length: n }, function () { return []; });
        copy.forEach(function (item, i) {
            groups[i % n].push(item);
        });
        return groups;
    }

    function filterByLikes(arr, threshold, key) {
        threshold = threshold === undefined ? 50 : threshold;
        key = key === undefined ? 'likes' : key;
        if (!Array.isArray(arr)) {
            throw new TypeError('filterByLikes: expected an array');
        }
        return arr.filter(function (item) {
            return item && Number(item[key]) >= threshold;
        });
    }

    function shuffles(arr) {
        if (!Array.isArray(arr)) {
            throw new TypeError('shuffle: expected an array');
        }
        var out = arr.slice();
        for (var i = out.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = out[i];
            out[i] = out[j];
            out[j] = tmp;
        }
        return out;
    }

    function getApiKey() {
        return apiKey;
    }

    /* ============================================================
       API / AUTH
       ============================================================ */
    async function http(input, init) {
        init = init || {};
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        var needsAuth = url === API_BASE || url.indexOf(API_BASE + '/') === 0;

        var nextInit = init;
        if (needsAuth && getApiKey()) {
            nextInit = Object.assign({}, init, {
                headers: Object.assign({}, init.headers || {}, {
                    'X-API-Key': getApiKey()
                })
            });
        }

        var res = await fetch(input, nextInit);
        if (res.status === 401) {
            apiKey = '';
            localStorage.removeItem(LS_API_KEY);
        }
        return res;
    }

    /* ============================================================
       TABS
       ============================================================ */
    tabButtons.forEach(function (btn) {
        btn.addEventListener('click', function () {
            var target = btn.dataset.tab;

            tabButtons.forEach(function (b) {
                b.classList.remove('active');
                b.setAttribute('aria-selected', 'false');
            });
            tabPanels.forEach(function (p) {
                p.classList.remove('active');
            });

            btn.classList.add('active');
            btn.setAttribute('aria-selected', 'true');
            document.getElementById('panel-' + target).classList.add('active');
        });
    });

    function togglePanel(target) {
        tabButtons.forEach(function (b) {
            b.classList.remove('active');
            b.setAttribute('aria-selected', 'false');
            if (b.dataset.tab === target) {
                b.classList.add('active');
                b.setAttribute('aria-selected', 'true');
            }
        });
        tabPanels.forEach(function (p) {
            p.classList.remove('active');
        });
        document.getElementById('panel-' + target).classList.add('active');
    }

    /* ============================================================
       DOWNLOAD LINKS
       ============================================================ */
    function setInitialLoading(on) {
        if (!dl.gridLoading) {
            return;
        }
        dl.gridLoading.style.display = on ? 'flex' : 'none';
    }

    function ensureLoadMoreEl() {
        if (state.loadMoreEl && state.loadMoreEl.parentNode === dl.linksGrid) {
            return state.loadMoreEl;
        }
        var el = document.createElement('div');
        el.className = 'grid-load-more';
        el.innerHTML = '<i class="fa-solid fa-circle-notch"></i><span>Loading more…</span>';
        state.loadMoreEl = el;
        return el;
    }

    function showLoadMore() {
        var el = ensureLoadMoreEl();
        el.classList.remove('is-error');
        el.innerHTML = '<i class="fa-solid fa-circle-notch"></i><span>Loading more…</span>';
        if (!el.parentNode) {
            dl.linksGrid.appendChild(el);
        }
    }

    function hideLoadMore() {
        if (state.loadMoreEl && state.loadMoreEl.parentNode) {
            state.loadMoreEl.parentNode.removeChild(state.loadMoreEl);
        }
    }

    function showLoadMoreError() {
        var el = ensureLoadMoreEl();
        el.classList.add('is-error');
        el.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i><span>Retry</span>';
        if (!el.parentNode) {
            dl.linksGrid.appendChild(el);
        }
        el.onclick = function () {
            el.onclick = null;
            loadNextPage();
        };
    }

    function renderGrids(items, target, append) {
        var grid = target || dl.linksGrid;
        if (!grid) {
            return;
        }

        if (!append) {
            var keepLoading = dl.gridLoading;
            var keepLoadMore = state.loadMoreEl;
            grid.innerHTML = '';
            if (keepLoading) {
                grid.appendChild(keepLoading);
            }
            if (keepLoadMore) {
                grid.appendChild(keepLoadMore);
            }
        }

        if (!items || items.length === 0) {
            return;
        }

        var startIdx = append ? state.items.length - items.length : 0;

        var html = items.map(function (item, i) {
            var idx = startIdx + i;
            var cover = escHtml(item.coverUrl || '');
            var video = escHtml(item.videoUrl || '');
            var likes = Number(item.likes || 0).toLocaleString();
            var posted = escHtml(formatPostedDate(item.postedDate));
            var bgClass = 'bg-' + ((idx % 6) + 1);

            return (
                '<div class="grid-item" data-datePosted="' + item.postedDate + '"' +
                ' data-video="' + video + '"' +
                ' data-key="' + escHtml(item.videoKey || '') + '"' +
                ' data-size="' + escHtml(String(item.fileSize != null ? item.fileSize : 0)) + '"' +
                ' data-likes="' + escHtml(String(item.likes != null ? item.likes : 0)) + '">' +
                    '<div class="thumb tiktok-fade ' + bgClass + '">' +
                        '<img src="' + cover + '" alt="" loading="lazy">' +
                    '</div>' +
                    '<div class="view-count">' +
                        '<i class="fa-solid fa-heart"></i> ' +
                        '<span>' + likes + '</span>' +
                    '</div>' +
                    '<div class="posted-date">' + posted + '</div>' +
                '</div>'
            );
        }).join('');

        var anchor = state.loadMoreEl && state.loadMoreEl.parentNode === grid
            ? state.loadMoreEl
            : null;

        if (anchor) {
            anchor.insertAdjacentHTML('beforebegin', html);
        } else {
            grid.insertAdjacentHTML('beforeend', html);
        }
    }

    async function fetchPage(offset, limit) {
        var params = new URLSearchParams();
        if (DEFAULT_USER) {
            params.set('userId', DEFAULT_USER);
        }
        params.set('limit', String(limit));
        params.set('offset', String(offset));

        var res = await http(API_BASE + '/api/explore-videos?' + params.toString());
        var data = await res.json().catch(function () {
            return { success: false, error: 'HTTP ' + res.status };
        });
        if (!res.ok || !data.success) {
            throw new Error(data.error || ('HTTP ' + res.status));
        }
        return {
            items: Array.isArray(data.items) ? data.items : [],
            hasMore: !!data.hasMore
        };
    }

    async function load() {
        if (dl.linksLoadBtn) {
            dl.linksLoadBtn.disabled = true;
        }

        state.items = [];
        state.offset = 0;
        state.hasMore = true;
        state.loading = false;

        setInitialLoading(true);
        hideLoadMore();

        try {
            var page = await fetchPage(0, PAGE_SIZE);
            state.items = page.items;
            state.offset = page.items.length;
            state.hasMore = page.hasMore;

            renderGrids(page.items, dl.linksGrid, false);
            setInitialLoading(false);

            if (state.hasMore) {
                showLoadMore();
                hideLoadMore();
            }
        } catch (err) {
            console.error('[AppDownloadLinks] load failed:', err);
            setInitialLoading(false);
        } finally {
            if (dl.linksLoadBtn) {
                dl.linksLoadBtn.disabled = false;
            }
        }
    }

    async function loadNextPage() {
        if (state.loading || !state.hasMore) {
            return;
        }
        state.loading = true;

        showLoadMore();

        try {
            var page = await fetchPage(state.offset, PAGE_SIZE);

            if (page.items.length === 0) {
                state.hasMore = false;
                hideLoadMore();
                return;
            }

            state.items = state.items.concat(page.items);
            state.offset += page.items.length;
            state.hasMore = page.hasMore;

            renderGrids(page.items, dl.linksGrid, true);
            hideLoadMore();
        } catch (err) {
            console.error('[AppDownloadLinks] loadNextPage failed:', err);
            showLoadMoreError();
        } finally {
            state.loading = false;
        }
    }

    function onPanelScroll() {
        if (scrollScheduled) {
            return;
        }
        scrollScheduled = true;
        requestAnimationFrame(function () {
            scrollScheduled = false;
            var panel = dl.panelPosts;
            if (!panel) {
                return;
            }
            var nearBottom =
                panel.scrollTop + panel.clientHeight >=
                panel.scrollHeight - LOAD_MORE_THRESHOLD_PX;
            if (nearBottom) {
                loadNextPage();
            }
        });
    }

    function initLinks() {
        if (dl.panelPosts) {
            dl.panelPosts.addEventListener('scroll', onPanelScroll, { passive: true });
        }
        load();
        if (dl.linksLoadBtn) {
            dl.linksLoadBtn.addEventListener('click', load);
        }
    }

    /* ============================================================
       VIDEO PLAYER
       ============================================================ */
    function showLoading(on) {
        if (vp.loading) {
            vp.loading.classList.toggle('show', !!on);
        }
    }

    function flashPause() {
        if (!vp.pauseInd) {
            return;
        }
        vp.pauseInd.classList.add('show');
        clearTimeout(hidePauseTimer);
        hidePauseTimer = setTimeout(function () {
            vp.pauseInd.classList.remove('show');
        }, 550);
    }

    function openPlayer(item) {
        if (!vp.overlay || !vp.video) {
            return;
        }
        if (!item || !item.videoUrl) {
            return;
        }
        togglePanel('private');
        document.body.classList.add("player");
        currentItem = item;

        vp.video.pause();
        vp.video.src = item.videoUrl;
        vp.video.muted = false;
        vp.video.currentTime = 0;

        if (vp.title) {
            vp.title.textContent = item.datePosted;
        }
        if (vp.author) {
            vp.author.textContent = '@jafernegery';
        }
        if (vp.caption) {
            vp.caption.textContent = '';
        }
        if (vp.likes) {
            vp.likes.textContent = fmtCount(item.likes);
        }
        if (vp.size) {
            var bytes = Number(item.fileSize) || 0;
            vp.size.textContent = bytes > 0 ? fmtBytes(bytes) : '—';
        }

        if (vp.railLike) {
            vp.railLike.classList.remove('is-active');
            vp.railLike.querySelector('i').className = 'fa-regular fa-heart';
        }
        if (vp.railMute) {
            vp.railMute.querySelector('i').className = 'fa-solid fa-volume-high';
        }

        showLoading(true);
        vp.overlay.classList.add('active');
        vp.overlay.setAttribute('aria-hidden', 'false');
        document.body.classList.add('player-open');

        var p = vp.video.play();
        if (p && typeof p.catch === 'function') {
            p.catch(function () {
                showLoading(false);
                flashPause();
            });
        }
    }

    function closePlayer() {
        if (!vp.overlay) {
            return;
        }
        vp.video.pause();
        vp.video.removeAttribute('src');
        vp.video.load();
        togglePanel('posts');
        document.body.classList.remove("player");
        vp.overlay.classList.remove('active');
        vp.overlay.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('player-open');
        currentItem = null;
        clearTimeout(hidePauseTimer);
    }

    async function downloadCurrent() {
        if (!currentItem) {
            return;
        }
        var key = currentItem.videoKey;
        if (!key) {
            flashDownloadFeedback(false);
            return;
        }

        var btn = vp.railDownload;
        var icon = btn ? btn.querySelector('i') : null;

        if (btn) {
            btn.disabled = true;
        }
        if (icon) {
            icon.className = 'fa-solid fa-circle-notch fa-spin';
        }

        try {
            var storedKey = localStorage.getItem('xapiKey') || '';
            var params = new URLSearchParams({
                videoKey: key,
                userId: DEFAULT_USER,
                disposition: 'attachment'
            });
            var res = await fetch(
                API_BASE + '/api/download-b2-file?' + params.toString(),
                { headers: storedKey ? { 'X-API-Key': storedKey } : {} }
            );
            var data = await res.json().catch(function () { return {}; });
            if (!res.ok || !data.success || !data.downloadUrl) {
                throw new Error(data.error || ('HTTP ' + res.status));
            }

            var a = document.createElement('a');
            a.href = data.downloadUrl;
            a.download = key;
            a.rel = 'noopener';
            document.body.appendChild(a);
            a.click();
            a.remove();

            flashDownloadFeedback(true);
        } catch (err) {
            console.error('[AppVideoPlayer] download failed:', err);
            flashDownloadFeedback(false);
        } finally {
            if (btn) {
                btn.disabled = false;
            }
        }
    }

    function flashDownloadFeedback(ok) {
        var btn = vp.railDownload;
        if (!btn) {
            return;
        }
        var icon = btn.querySelector('i');
        if (!icon) {
            return;
        }
        icon.className = ok ? 'fa-solid fa-check' : 'fa-solid fa-triangle-exclamation';
        icon.style.color = ok ? 'var(--teal)' : 'var(--accent-error)';
        icon.style.textShadow = ok ? '0 0 12px var(--teal-glow)' : 'none';
        setTimeout(function () {
            icon.className = 'fa-solid fa-download';
            icon.style.color = '';
            icon.style.textShadow = '';
        }, 1400);
    }

    function bindPlayer() {
        if (!vp.overlay) {
            return;
        }

        if (vp.close) {
            vp.close.addEventListener('click', closePlayer);
        }

        if (vp.video) {
            vp.video.addEventListener('click', function () {
                if (vp.video.paused) {
                    vp.video.play().catch(function () {});
                } else {
                    vp.video.pause();
                    flashPause();
                }
            });

            vp.video.addEventListener('loadeddata', function () { showLoading(false); });
            vp.video.addEventListener('canplay', function () { showLoading(false); });
            vp.video.addEventListener('waiting', function () { showLoading(true); });
            vp.video.addEventListener('error', function () {
                showLoading(false);
                console.error('[AppVideoPlayer] video error', vp.video.error);
            });
        }

        if (vp.railMute) {
            vp.railMute.addEventListener('click', function () {
                var m = !vp.video.muted;
                vp.video.muted = m;
                vp.railMute.querySelector('i').className =
                    m ? 'fa-solid fa-volume-xmark' : 'fa-solid fa-volume-high';
            });
        }

        if (vp.railLike) {
            vp.railLike.addEventListener('click', function () {
                var on = !vp.railLike.classList.contains('is-active');
                vp.railLike.classList.toggle('is-active', on);
                vp.railLike.querySelector('i').className =
                    on ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
            });
        }

        if (vp.railDownload) {
            vp.railDownload.addEventListener('click', downloadCurrent);
        }

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && vp.overlay.classList.contains('active')) {
                closePlayer();
            }
        });

        var startY = null;
        vp.overlay.addEventListener('touchstart', function (e) {
            if (e.touches.length !== 1) {
                return;
            }
            startY = e.touches[0].clientY;
        }, { passive: true });
        vp.overlay.addEventListener('touchend', function (e) {
            if (startY == null) {
                return;
            }
            var dy = (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientY : 0) - startY;
            if (dy > 100) {
                closePlayer();
            }
            startY = null;
        }, { passive: true });

        document.addEventListener('click', function (e) {
            var tile = e.target.closest('.grid-item');
            if (!tile) {
                return;
            }

            var datePosted = tile.getAttribute('data-dateposted');
            var src = tile.getAttribute('data-video');
            var videoKey = tile.getAttribute('data-key');
            var fileSize = tile.getAttribute('data-size');
            if (!src) {
                return;
            }

            openPlayer({
                videoUrl: src,
                videoKey: videoKey,
                fileSize: fileSize,
                likes: tile.getAttribute('data-likes') || '0',
                datePosted: datePosted
            });
        });
    }

    /* ============================================================
       PUBLIC API + BOOTSTRAP
       ============================================================ */
    global.AppDownloadLinks = Object.freeze({
        init: initLinks,
        load: load,
        getApiKey: getApiKey
    });
    global.AppVideoPlayer = Object.freeze({
        open: openPlayer,
        close: closePlayer,
        download: downloadCurrent
    });

    function boot() {
        initLinks();
        bindPlayer();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

})(window);
