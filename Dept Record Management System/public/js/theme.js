/* ---------------------------------------------------------------------
 * Theme changer — light / dark / system, persisted in localStorage.
 *
 * Usage (each page):
 *   1. <script src="/js/theme.js"></script> in <head> (blocking, so the
 *      correct theme applies before first paint — no flash of light mode).
 *   2. Put <span class="theme-slot"></span> inside .nav-links.
 *
 * The dropdown menu is injected by this script so pages stay simple.
 * Auto (system) follows the OS setting live via prefers-color-scheme.
 * --------------------------------------------------------------------- */
(function () {
    var STORAGE_KEY = 'theme';
    var VALID = ['light', 'dark', 'system'];

    function stored() {
        try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
    }

    function apply(mode) {
        var effective = mode === 'system'
            ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
            : mode;
        document.documentElement.setAttribute('data-theme', effective);
        document.documentElement.setAttribute('data-theme-mode', mode);
    }

    // Apply immediately (before paint) from whatever is stored.
    var mode = stored();
    if (VALID.indexOf(mode) === -1) mode = 'system';
    apply(mode);

    // Follow OS changes while in "system" mode.
    var mql = window.matchMedia('(prefers-color-scheme: dark)');
    var onSystemChange = function () {
        if ((document.documentElement.getAttribute('data-theme-mode') || 'system') === 'system') apply('system');
    };
    if (mql.addEventListener) mql.addEventListener('change', onSystemChange);
    else if (mql.addListener) mql.addListener(onSystemChange);

    function icon(mode) {
        if (mode === 'light') return '☀';
        if (mode === 'dark') return '☾';
        return '◐'; // system/auto
    }

    function label(mode) {
        return mode.charAt(0).toUpperCase() + mode.slice(1);
    }

    function buildMenu() {
        var slot = document.querySelector('.theme-slot');
        if (!slot) return;

        var wrap = document.createElement('div');
        wrap.className = 'theme-switch';
        wrap.innerHTML =
            '<button type="button" class="theme-btn" id="themeBtn" aria-haspopup="true" aria-expanded="false" title="Change theme">' +
                '<span class="theme-icon" id="themeIcon">' + icon(mode) + '</span>' +
            '</button>' +
            '<div class="theme-menu hidden" id="themeMenu" role="menu">' +
                VALID.map(function (m) {
                    return '<button type="button" class="theme-option" data-mode="' + m + '" role="menuitem">' +
                        '<span class="theme-opt-icon">' + icon(m) + '</span>' + label(m) +
                        '<span class="theme-check"></span>' +
                    '</button>';
                }).join('') +
            '</div>';

        slot.appendChild(wrap);

        var btn = wrap.querySelector('#themeBtn');
        var menu = wrap.querySelector('#themeMenu');

        function renderCheck() {
            menu.querySelectorAll('.theme-option').forEach(function (opt) {
                opt.classList.toggle('selected', opt.dataset.mode === mode);
            });
            document.getElementById('themeIcon').textContent = icon(mode);
            btn.title = 'Theme: ' + label(mode);
        }
        renderCheck();

        function setOpen(open) {
            menu.classList.toggle('hidden', !open);
            btn.setAttribute('aria-expanded', open ? 'true' : 'false');
            if (open) {
                // Close on outside click or Escape (bound only while open)
                setTimeout(function () {
                    document.addEventListener('click', onDocClick);
                    document.addEventListener('keydown', onKey);
                }, 0);
            } else {
                document.removeEventListener('click', onDocClick);
                document.removeEventListener('keydown', onKey);
            }
        }

        function onDocClick(e) {
            if (!wrap.contains(e.target)) setOpen(false);
        }
        function onKey(e) {
            if (e.key === 'Escape') setOpen(false);
        }

        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            setOpen(menu.classList.contains('hidden'));
        });

        menu.querySelectorAll('.theme-option').forEach(function (opt) {
            opt.addEventListener('click', function () {
                mode = opt.dataset.mode;
                try { localStorage.setItem(STORAGE_KEY, mode); } catch (e) { /* private mode */ }
                apply(mode);
                renderCheck();
                setOpen(false);
            });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', buildMenu);
    } else {
        buildMenu();
    }
})();
