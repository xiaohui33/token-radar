// Token Radar's dashboard: one static page over data.js, no framework and no network.
//
//   state  -> URL hash (filters, sort, open protocol) -> render
//
// The board and the detail view are both rendered into <main>; nothing is fetched after load.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var main = document.getElementById('main');
  var statusEl = document.getElementById('status');

  /* ------------------------------------------------------------------ data */

  // Rows arrive already scored by lib/model.ts. The page reads them, it never re-ranks them.
  var rows = DATA && DATA.rows ? DATA.rows : [];
  var live = DATA && DATA.live ? DATA.live : [];
  var floor = DATA ? DATA.floor_usd : 0;
  var cal = DATA ? DATA.calibration : null;
  var model = DATA ? DATA.model : null;

  var categoryList = unique(rows.map(function (r) { return categoryOf(r); }));
  var chainList = unique(flatten(rows.map(function (r) { return r.chains || []; })));
  var rowBySlug = {};
  rows.forEach(function (r) { rowBySlug[r.slug] = r; });

  // One shared scale for every range bar, so a row's bar means the same thing in any view.
  var scaleMax = rows.reduce(function (m, r) { return Math.max(m, r.implied_high_usd || 0); }, 1);
  var tailCount = rows.filter(function (r) { return r.tvl_usd < floor; }).length;

  /* ------------------------------------------------------------ formatting */

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var abs = Math.abs(n);
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }

  function fmtRatio(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(3) + 'x';
  }

  function fmtMultiple(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(2) + 'x';
  }

  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }

  function fmtDate(iso) {
    return iso || null;
  }

  function categoryOf(row) {
    return row.category || 'Other';
  }

  /* --------------------------------------------------------------- helpers */

  function unique(values) {
    var seen = {};
    var out = [];
    values.forEach(function (v) {
      if (!v || seen[v]) return;
      seen[v] = true;
      out.push(v);
    });
    out.sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
    return out;
  }

  function flatten(lists) {
    var out = [];
    lists.forEach(function (list) { out = out.concat(list); });
    return out;
  }

  /** An element with attributes, text and children: no HTML strings, so data can never be markup. */
  function el(tag, attrs) {
    var node = document.createElement(tag);
    var i;
    if (attrs) {
      for (var key in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, key)) continue;
        var value = attrs[key];
        if (value === null || value === undefined || value === false) continue;
        if (key === 'text') node.textContent = value;
        else if (key === 'class') node.className = value;
        else if (key === 'style') node.setAttribute('style', value);
        else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value === true ? '' : value);
      }
    }
    for (i = 2; i < arguments.length; i++) {
      append(node, arguments[i]);
    }
    return node;
  }

  function append(node, child) {
    if (child === null || child === undefined || child === false) return;
    if (Object.prototype.toString.call(child) === '[object Array]') {
      child.forEach(function (c) { append(node, c); });
      return;
    }
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /* ------------------------------------------------------- state and hash */

  var state = { q: '', category: 'all', chain: 'all', minTvl: 0, tail: true, sort: 'implied', dir: 'desc', slug: null };
  var pendingFocus = null;
  var skipHashOnce = false;

  function parseHash() {
    var out = {};
    var raw = window.location.hash.replace(/^#/, '');
    if (!raw) return out;
    raw.split('&').forEach(function (part) {
      if (!part) return;
      var at = part.indexOf('=');
      var key = at < 0 ? part : part.slice(0, at);
      var value = at < 0 ? '' : part.slice(at + 1);
      try {
        out[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' '));
      } catch (err) {
        // A malformed escape is ignored, not fatal: the default state stays.
      }
    });
    return out;
  }

  /** The hash for the current state, plus an optional protocol to open on top of it. */
  function hashString(slug) {
    var parts = [];
    function put(key, value) {
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
    }
    if (state.q) put('q', state.q);
    if (state.category !== 'all') put('category', state.category);
    if (state.chain !== 'all') put('chain', state.chain);
    if (state.minTvl > 0) put('min', String(state.minTvl / 1e6));
    if (!state.tail) put('tail', '0');
    if (state.sort !== 'implied' || state.dir !== 'desc') {
      put('sort', state.sort);
      put('dir', state.dir);
    }
    var open = slug === undefined ? state.slug : slug;
    if (open) put('p', open);
    return parts.join('&');
  }

  /** Put every controlled value back to its default. The hash is the only source of truth per load. */
  function resetState() {
    state.q = '';
    state.category = 'all';
    state.chain = 'all';
    state.minTvl = 0;
    state.tail = true;
    state.sort = 'implied';
    state.dir = 'desc';
    state.slug = null;
  }

  function readHash() {
    var params = parseHash();
    resetState();
    if (typeof params.q === 'string') state.q = params.q.slice(0, 200);
    if (params.category && (params.category === 'all' || categoryList.indexOf(params.category) >= 0)) {
      state.category = params.category;
    }
    if (params.chain && (params.chain === 'all' || chainList.indexOf(params.chain) >= 0)) {
      state.chain = params.chain;
    }
    if (params.min !== undefined) {
      var millions = parseFloat(params.min);
      if (isFinite(millions) && millions > 0) state.minTvl = millions * 1e6;
    }
    if (params.tail === '0') state.tail = false;
    if (params.sort && SORT_BY_KEY[params.sort]) {
      state.sort = params.sort;
      if (params.dir !== 'asc' && params.dir !== 'desc') state.dir = SORT_BY_KEY[params.sort].dir;
    }
    if (params.dir === 'asc' || params.dir === 'desc') state.dir = params.dir;
    if (params.p && rowBySlug[params.p]) state.slug = params.p;
  }

  /** Replace the URL without adding history entries. file:// can refuse replaceState, so fall back. */
  function writeHash() {
    var next = hashString();
    if (window.location.hash.replace(/^#/, '') === next) return;
    try {
      window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
    } catch (err) {
      skipHashOnce = true;
      window.location.hash = next;
    }
  }

  function resetFilters() {
    state.q = '';
    state.category = 'all';
    state.chain = 'all';
    state.minTvl = 0;
    state.tail = true;
  }

  function filtersActive() {
    return !!(state.q || state.category !== 'all' || state.chain !== 'all' || state.minTvl > 0 || !state.tail);
  }

  /* --------------------------------------------------------------- filtering */

  function matches(row) {
    if (!state.tail && row.tvl_usd < floor) return false;
    if (state.minTvl > 0 && row.tvl_usd < state.minTvl) return false;
    if (state.category !== 'all' && categoryOf(row) !== state.category) return false;
    if (state.chain !== 'all' && (row.chains || []).indexOf(state.chain) < 0) return false;
    var q = state.q.replace(/^\s+|\s+$/g, '').toLowerCase();
    if (q) {
      var hay = [row.name, row.slug, categoryOf(row)].join(' ').toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  }

  function visibleRows() {
    return rows.filter(matches);
  }

  /* --------------------------------------------------------------- sorting */

  // Each column names its own default direction. Missing values sort last in both directions, and a
  // slug tie-break makes every order total and repeatable, not merely whatever the engine's sort does.
  var SORT_COLUMNS = [
    { key: 'rank', label: 'Rank', dir: 'asc', value: function (r) { return r.rank; } },
    { key: 'name', label: 'Protocol', dir: 'asc', value: function (r) { return r.name; } },
    { key: 'category', label: 'Category', dir: 'asc', value: function (r) { return categoryOf(r); } },
    { key: 'implied', label: 'Implied value', dir: 'desc', value: function (r) { return r.implied_value_usd; } },
    { key: 'tvl', label: 'TVL', dir: 'desc', value: function (r) { return r.tvl_usd; } },
    { key: 'change', label: '7d', dir: 'desc', value: function (r) { return r.change_7d; } },
    { key: 'chains', label: 'Chains', dir: 'desc', value: function (r) { return (r.chains || []).length; } },
    { key: 'since', label: 'Tracked since', dir: 'desc', value: function (r) { return r.listed_at; } }
  ];
  var SORT_BY_KEY = {};
  SORT_COLUMNS.forEach(function (col) { SORT_BY_KEY[col.key] = col; });

  function sortValue(row, col) {
    var value = col.value(row);
    if (value === null || value === undefined || value === '') return null;
    return value;
  }

  function sortedRows(list) {
    var col = SORT_BY_KEY[state.sort] || SORT_BY_KEY.implied;
    var direction = state.dir === 'asc' ? 1 : -1;
    return list.slice().sort(function (a, b) {
      var av = sortValue(a, col);
      var bv = sortValue(b, col);
      if (av === null && bv !== null) return 1;
      if (bv === null && av !== null) return -1;
      if (av !== null && bv !== null) {
        var order;
        if (typeof av === 'number') order = av - bv;
        else order = av < bv ? -1 : av > bv ? 1 : 0;
        if (order !== 0) return order * direction;
      }
      if (a.slug < b.slug) return -1;
      if (a.slug > b.slug) return 1;
      return a.rank - b.rank;
    });
  }

  /* -------------------------------------------------------------- the board */

  function introView() {
    return el('section', { class: 'intro', 'aria-labelledby': 'page-title' },
      el('h1', { id: 'page-title', text: rows.length + ' pre-token protocols, by implied launch value' }),
      el('p', { class: 'lede' },
        'Every protocol here records no token. Each is scored from this snapshot\'s TVL, momentum, category, ',
        'chain reach and time tracked, then ranked. The board covers protocols below the ',
        el('strong', { text: fmtUsd(floor) + ' watchlist floor' }),
        ' as well as above it, and each row carries a low-high range: an estimate to argue with, not a price.'
      ),
      el('ul', { class: 'facts' },
        fact(String(rows.length), 'pre-token rows scored'),
        fact(cal ? String(cal.sample_size) : 'n/a', 'live tokens in calibration'),
        fact(cal ? fmtRatio(cal.market_ratio) : 'n/a', 'median mcap / TVL'),
        fact(DATA.watchlist_size + ' / ' + DATA.watchlist_size, 'watchlist covered')
      )
    );
  }

  function fact(value, label) {
    return el('li', { class: 'fact' }, el('b', { text: value }), el('span', { text: label }));
  }

  function field(labelText, control, extraClass) {
    var id = control.getAttribute('id');
    return el('div', { class: 'field ' + (extraClass || '') },
      el('label', { 'for': id, text: labelText }),
      control
    );
  }

  function filtersView() {
    var shown = visibleRows().length;

    var search = el('input', {
      id: 'f-q', type: 'search', value: state.q, placeholder: 'Name, slug or category',
      autocomplete: 'off'
    });
    search.addEventListener('input', function () {
      state.q = search.value;
      afterFilterEdit('f-q');
    });

    var category = el('select', { id: 'f-category' },
      el('option', { value: 'all', text: 'All categories', selected: state.category === 'all' ? 'selected' : null }),
      categoryList.map(function (c) {
        return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null });
      })
    );
    category.addEventListener('change', function () {
      state.category = category.value;
      afterFilterEdit('f-category');
    });

    var chain = el('select', { id: 'f-chain' },
      el('option', { value: 'all', text: 'All chains', selected: state.chain === 'all' ? 'selected' : null }),
      chainList.map(function (c) {
        return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null });
      })
    );
    chain.addEventListener('change', function () {
      state.chain = chain.value;
      afterFilterEdit('f-chain');
    });

    var min = el('input', {
      id: 'f-min', type: 'number', min: '0', step: '10', inputmode: 'decimal',
      value: state.minTvl > 0 ? String(state.minTvl / 1e6) : '',
      placeholder: '0'
    });
    min.addEventListener('input', function () {
      var millions = parseFloat(min.value);
      state.minTvl = isFinite(millions) && millions > 0 ? millions * 1e6 : 0;
      afterFilterEdit('f-min');
    });

    var tail = el('input', { id: 'f-tail', type: 'checkbox', checked: state.tail ? 'checked' : null });
    tail.addEventListener('change', function () {
      state.tail = tail.checked;
      afterFilterEdit('f-tail');
    });

    return el('section', { class: 'filters', 'aria-labelledby': 'filters-title' },
      el('h2', { id: 'filters-title', text: 'Filter the board' }),
      field('Search', search, 'field-search'),
      field('Category', category),
      field('Chain', chain),
      field('Minimum TVL ($M)', min, 'field-min'),
      el('div', { class: 'field' },
        el('div', { class: 'check' }, tail, el('label', { 'for': 'f-tail', text: 'Include below-floor tail' })),
        el('span', { class: 'check-note', text: tailCount + ' rows under ' + fmtUsd(floor) })
      ),
      el('div', { class: 'filter-foot' },
        el('span', { class: 'count' },
          el('b', { text: String(shown) }), ' of ' + rows.length + ' rows shown'
        ),
        filtersActive() ? el('button', {
          class: 'link-button', type: 'button', text: 'Clear filters',
          onclick: function () {
            resetFilters();
            writeHash();
            render();
            focusById('f-q');
          }
        }) : null
      )
    );
  }

  /** Re-render after a control changed, keeping the caret and focus where the reader left them. */
  function afterFilterEdit(id) {
    writeHash();
    var node = document.getElementById(id);
    pendingFocus = node && typeof node.selectionStart === 'number'
      ? { id: id, start: node.selectionStart, end: node.selectionEnd }
      : { id: id };
    render();
  }

  function focusById(id) {
    var node = document.getElementById(id);
    if (node) node.focus();
  }

  function sortHeader(col) {
    var active = state.sort === col.key;
    var ascending = state.dir === 'asc';
    return el('th', {
      scope: 'col',
      class: 'sortable',
      'aria-sort': active ? (ascending ? 'ascending' : 'descending') : null
    },
      el('button', {
        id: 'sort-' + col.key,
        type: 'button',
        onclick: function () {
          if (state.sort === col.key) state.dir = ascending ? 'desc' : 'asc';
          else { state.sort = col.key; state.dir = col.dir; }
          writeHash();
          pendingFocus = { id: 'sort-' + col.key };
          render();
        }
      },
        col.label,
        active ? el('span', { class: 'sort-mark', 'aria-hidden': 'true', text: ascending ? '\u25B2' : '\u25BC' }) : null
      )
    );
  }

  function rangeBar(row, max) {
    var scale = max || scaleMax;
    var low = Math.max(0, Math.min(100, (row.implied_low_usd / scale) * 100));
    var high = Math.max(0, Math.min(100, (row.implied_high_usd / scale) * 100));
    var point = Math.max(0, Math.min(100, (row.implied_value_usd / scale) * 100));
    return el('div', { class: 'range', 'aria-hidden': 'true' },
      el('span', { class: 'range-span', style: 'left:' + low.toFixed(2) + '%;width:' + Math.max(1.5, high - low).toFixed(2) + '%' }),
      el('span', { class: 'range-point', style: 'left:' + point.toFixed(2) + '%' })
    );
  }

  function boardRow(row) {
    var change = row.change_7d;
    return el('tr', {
      onclick: function (event) {
        // A mouse click anywhere on the row follows the name link; keyboard users tab to the link.
        var node = event.target;
        while (node && node !== this) {
          if (node.nodeName === 'A' || node.nodeName === 'BUTTON') return;
          node = node.parentNode;
        }
        window.location.hash = hashString(row.slug);
      }
    },
      el('td', { class: 'num', text: String(row.rank) }),
      el('td', { class: 'cell-protocol' },
        el('a', {
          class: 'row-link',
          id: 'row-' + row.slug,
          href: '#' + hashString(row.slug),
          text: row.name
        }),
        el('span', { class: 'slug', text: row.slug })
      ),
      el('td', { class: 'cell-category', text: categoryOf(row) }),
      el('td', { class: 'cell-implied' },
        el('div', { class: 'value-line' },
          el('span', { class: 'value-main num', text: fmtUsd(row.implied_value_usd) }),
          el('span', { class: 'value-range', text: fmtUsd(row.implied_low_usd) + ' \u2013 ' + fmtUsd(row.implied_high_usd) })
        ),
        rangeBar(row)
      ),
      el('td', { class: 'num', text: fmtUsd(row.tvl_usd) }),
      el('td', { class: 'num ' + (change === null ? 'missing' : change >= 0 ? 'pos' : 'neg'), text: fmtPct(change) }),
      el('td', { class: 'num', title: (row.chains || []).join(', '), text: String((row.chains || []).length) }),
      el('td', { class: 'num' + (row.listed_at ? '' : ' missing'), text: fmtDate(row.listed_at) || 'n/a' })
    );
  }

  function boardView() {
    var list = sortedRows(visibleRows());
    var col = SORT_BY_KEY[state.sort] || SORT_BY_KEY.implied;
    var orderWords = col.label + ', ' + (state.dir === 'asc' ? 'ascending' : 'descending');
    if (list.length === 0) {
      return el('section', { class: 'panel', 'aria-labelledby': 'board-title' },
        el('div', { class: 'empty' },
          el('h2', { id: 'board-title', text: 'Nothing matches those filters' }),
          el('p', { text: 'Widen the search, pick another chain or category, or lower the TVL minimum.' }),
          el('button', {
            class: 'button primary', type: 'button', text: 'Clear filters',
            onclick: function () {
              resetFilters();
              writeHash();
              render();
              focusById('f-q');
            }
          })
        )
      );
    }

    var body = el('tbody');
    list.forEach(function (row) { body.appendChild(boardRow(row)); });

    return el('section', { class: 'panel', 'aria-labelledby': 'board-title' },
      el('div', { class: 'table-wrap', role: 'region', 'aria-label': 'Protocol board, scrollable', tabindex: '0' },
        el('table', null,
          el('caption', null,
            'Sorted by ' + orderWords + '. Missing figures sort last. The bar under each value spans its low-high range on one scale for the whole board.'
          ),
          el('thead', null, el('tr', null,
            SORT_COLUMNS.map(sortHeader)
          )),
          body
        )
      )
    );
  }

  /* -------------------------------------------------------------- the detail */

  function fmtDelta(n) {
    if (!isFinite(n) || Math.abs(n) < 1) return '$0';
    return (n > 0 ? '+' : '\u2212') + fmtUsd(Math.abs(n));
  }

  function backButton() {
    return el('button', {
      class: 'button', type: 'button', text: '\u2190 Back to the board',
      onclick: closeDetail
    });
  }

  function closeDetail() {
    var slug = state.slug;
    state.slug = null;
    writeHash();
    pendingFocus = slug ? { id: 'row-' + slug } : null;
    render();
  }

  /** The arithmetic the model ran, one multiplication at a time, from this row's own inputs. */
  function factorRows(row) {
    var m = row.model;
    var chainCount = (row.chains || []).length;
    var steps = [];
    var running = row.tvl_usd;

    steps.push({ label: 'TVL, from the snapshot', input: fmtUsd(row.tvl_usd), factor: '\u2014', running: running });
    if (!row.tvl_usd || row.tvl_usd <= 0) return steps;

    function multiply(labelText, inputText, factorText, nextRunning) {
      steps.push({ label: labelText, input: inputText, factor: factorText, running: nextRunning });
      running = nextRunning;
    }

    multiply(
      'Live median mcap / TVL',
      cal.sample_size + ' live tokens in this snapshot',
      fmtRatio(m.market_ratio),
      running * m.market_ratio
    );
    multiply(
      'Category: ' + categoryOf(row),
      'category median blended with a prior where the live sample is thin',
      fmtMultiple(m.category_multiple),
      running * m.category_multiple
    );
    multiply(
      'Seven-day momentum',
      row.change_7d === null ? 'no 7-day figure' : fmtPct(row.change_7d) + ' over 7 days',
      fmtMultiple(m.growth_multiplier),
      running * m.growth_multiplier
    );
    multiply(
      'Chain reach',
      chainCount + ' chain' + (chainCount === 1 ? '' : 's'),
      fmtMultiple(m.chain_multiplier),
      running * m.chain_multiplier
    );
    multiply(
      'Time tracked without a token',
      row.age_days === null ? 'no listing date on record' : row.age_days + ' days since ' + row.listed_at,
      fmtMultiple(m.maturity_multiplier),
      running * m.maturity_multiplier
    );

    var cap = m.value_cap_usd;
    var capped = cap > 0 && running > cap;
    steps.push({
      label: capped ? 'Cap at the largest live token' : 'Cap at the largest live token (not reached)',
      input: fmtUsd(cap) + ' mcap of the largest live token',
      factor: capped ? 'capped' : 'within cap',
      running: capped ? cap : running
    });

    var previous = null;
    return steps.map(function (step) {
      var change = previous === null ? null : step.running - previous;
      previous = step.running;
      return { label: step.label, input: step.input, factor: step.factor, running: step.running, change: change };
    });
  }

  function factorTable(row) {
    var list = factorRows(row);
    var body = el('tbody');
    list.forEach(function (step) {
      body.appendChild(el('tr', null,
        el('td', { text: step.label }),
        el('td', { class: 'sub', text: step.input }),
        el('td', { class: 'num', text: step.factor }),
        el('td', { class: 'num', text: fmtUsd(step.running) }),
        el('td', { class: 'num ' + (step.change === null ? 'missing' : step.change > 0 ? 'pos' : step.change < 0 ? 'neg' : ''), text: step.change === null ? '\u2014' : fmtDelta(step.change) })
      ));
    });
    var claimed = row.implied_value_usd;
    var rounded = list.length ? Math.max(1, Math.round(list[list.length - 1].running)) : claimed;
    body.appendChild(el('tr', { class: 'total' },
      el('td', { colspan: '3', text: 'Implied value in board.json' }),
      el('td', { class: 'num', text: fmtUsd(claimed) }),
      el('td', { class: 'num', text: rounded === claimed ? 'same' : 'differs' })
    ));
    return el('div', { class: 'table-wrap factor-wrap' },
      el('table', { class: 'factor-table' },
        el('caption', null, 'Each step multiplies the running estimate by the factor beside it. The change column is that multiplication in dollars.'),
        el('thead', null, el('tr', null,
          el('th', { scope: 'col', text: 'Step' }),
          el('th', { scope: 'col', text: 'This entry' }),
          el('th', { scope: 'col', text: 'Factor' }),
          el('th', { scope: 'col', text: 'Running estimate' }),
          el('th', { scope: 'col', text: 'Change' })
        )),
        body
      )
    );
  }

  function chainsSection(row) {
    var chains = row.chains || [];
    return el('section', { class: 'detail-section', 'aria-labelledby': 'chains-title' },
      el('h2', { id: 'chains-title', text: 'Chains (' + chains.length + ')' }),
      chains.length
        ? el('ul', { class: 'chips' }, chains.map(function (chain) {
          return el('li', { class: 'chip', text: chain });
        }))
        : el('p', { class: 'claim', text: 'No chain is recorded for this entry in the snapshot.' }),
      el('p', { class: 'claim', text: 'TVL is summed across these chains. The chain factor adds at most ' + Math.round((model.chain_cap || 0) * 100) + '% for reach, on a log2 scale.' })
    );
  }

  function farmSection(row) {
    var steps = row.farm_steps || [];
    var list = el('ol', { class: 'steps' });
    steps.forEach(function (text) {
      var at = text.indexOf(' Cost: ');
      var action = at >= 0 ? text.slice(0, at) : text;
      var cost = at >= 0 ? text.slice(at + 1) : '';
      list.appendChild(el('li', null,
        el('b', { text: action }),
        cost ? el('span', { class: 'cost', text: cost }) : null
      ));
    });
    return el('section', { class: 'detail-section', 'aria-labelledby': 'farm-title' },
      el('h2', { id: 'farm-title', text: 'Farm plan' }),
      el('p', { class: 'claim', text: 'Ordered steps, with the model\'s cost and time estimate. Treat it as a checklist to verify, not advice: check the protocol\'s own claim page before committing funds.' }),
      steps.length ? list : el('p', { class: 'claim', text: 'No farm plan was generated for this entry.' })
    );
  }

  function detailView(row) {
    var m = row.model;
    var chains = row.chains || [];
    var meta = [
      'Rank ' + row.rank + ' of ' + rows.length,
      categoryOf(row),
      chains.length + ' chain' + (chains.length === 1 ? '' : 's'),
      row.listed_at ? 'Tracked since ' + row.listed_at + (row.age_days !== null ? ' (' + row.age_days + ' days)' : '') : 'No listing date'
    ];

    return el('article', { class: 'detail' },
      el('p', { class: 'back-line' }, backButton()),
      el('header', { class: 'detail-head' },
        el('p', { class: 'detail-kicker', text: 'Protocol detail' }),
        el('h1', { id: 'detail-title', tabindex: '-1', text: row.name }),
        el('p', { class: 'detail-meta' },
          meta.map(function (text) { return el('span', { text: text }); })
        )
      ),
      el('div', { class: 'estimate' },
        el('p', { class: 'estimate-label', text: 'Implied launch value, this entry\'s claim' }),
        el('p', { class: 'estimate-value', text: fmtUsd(row.implied_value_usd) }),
        el('p', { class: 'estimate-range' },
          'Range ', el('b', { text: fmtUsd(row.implied_low_usd) }), ' \u2013 ', el('b', { text: fmtUsd(row.implied_high_usd) })
        ),
        rangeBar(row, row.implied_high_usd)
      ),
      el('p', { class: 'claim' },
        'The implied value is this entry\'s own claim about what its launch could be worth, not a prediction that a token will launch. The range is model uncertainty, not a price target, and nothing here is a live market price.'
      ),
      el('section', { class: 'detail-section', 'aria-labelledby': 'factors-title' },
        el('h2', { id: 'factors-title', text: 'How the estimate is built' }),
        factorTable(row)
      ),
      chainsSection(row),
      farmSection(row),
      el('p', { class: 'back-line' }, backButton())
    );
  }

  /* --------------------------------------------------------------- the page */

  function updateChrome() {
    if (!DATA) return;
    var asOf = document.getElementById('as-of');
    if (asOf) asOf.textContent = DATA.as_of;
    var version = document.getElementById('model-version');
    if (version) version.textContent = DATA.model_version + ' model';
    var source = document.getElementById('source');
    if (source) source.textContent = DATA.source;
  }

  function errorView() {
    return el('div', { class: 'panel' },
      el('div', { class: 'empty' },
        el('h1', { text: 'No data loaded' }),
        el('p', { text: 'data.js was not found beside this page. Run main.ts to write out/data.js and out/dashboard/, then open that copy of index.html.' })
      )
    );
  }

  function setStatus(shown, total) {
    if (statusEl) statusEl.textContent = shown + ' of ' + total + ' protocols shown.';
  }

  // What the last render put in <main>. A detail opening for the first time moves focus to its title;
  // re-renders of the same view leave focus alone.
  var renderedSlug = null;

  function render() {
    clear(main);
    main.setAttribute('aria-busy', 'false');
    if (!DATA) {
      main.appendChild(errorView());
      return;
    }

    // state.slug is the one switch between the two views, and it only ever comes from the hash.
    var row = state.slug ? rowBySlug[state.slug] : null;
    if (row) {
      main.appendChild(detailView(row));
      if (renderedSlug !== row.slug) pendingFocus = { id: 'detail-title' };
      setStatus(visibleRows().length, rows.length);
      document.title = row.name + ' \u2013 Token Radar';
    } else {
      if (state.slug) state.slug = null;
      var view = el('div');
      view.appendChild(introView());
      view.appendChild(filtersView());
      view.appendChild(boardView());
      main.appendChild(view);
      setStatus(visibleRows().length, rows.length);
      document.title = rows.length + ' pre-token protocols \u2013 Token Radar';
    }
    renderedSlug = row ? row.slug : null;

    updateChrome();

    if (pendingFocus) {
      var target = document.getElementById(pendingFocus.id);
      var caret = pendingFocus;
      pendingFocus = null;
      if (target) {
        target.focus();
        if (target.setSelectionRange && caret.start !== undefined) {
          try { target.setSelectionRange(caret.start, caret.end === undefined ? caret.start : caret.end); } catch (err) { /* number inputs refuse */ }
        }
      }
    }
  }

  window.addEventListener('hashchange', function () {
    if (skipHashOnce) { skipHashOnce = false; return; }
    readHash();
    render();
  });

  updateChrome();
  readHash();
  render();
})();