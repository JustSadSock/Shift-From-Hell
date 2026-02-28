'use strict';
/* ═══════════════════════════════════════════════════════════════════════
   Shift From Hell — Client
   ═══════════════════════════════════════════════════════════════════════ */

// ── State ────────────────────────────────────────────────────────────────
let ws = null;
let state = {
  playerId: null,
  roomId: null,
  role: null,
  gameState: null,
  selectedPartId: null,
  selectedOrderId: null,
  selectedInspPartId: null,
  panicking: false
};

// ── Helpers ──────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const SHAPE_ICONS = { circle: '●', square: '■', triangle: '▲', star: '★' };
const ROLE_LABELS = { assembler: 'Сборщик', inspector: 'Инспектор', operator: 'Оператор' };
const COLOR_NAMES = { red: 'Красная', blue: 'Синяя', green: 'Зелёная', yellow: 'Жёлтая' };
const COLOR_ABBREV = { red: 'Кра', blue: 'Син', green: 'Зел', yellow: 'Жёл' };
const SHAPE_NAMES = { circle: 'Круг', square: 'Квадрат', triangle: 'Треугольник', star: 'Звезда' };

function showNotif(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `notif-item notif-${type}`;
  el.textContent = msg;
  $('notif').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}

function fmtTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// ── WebSocket ────────────────────────────────────────────────────────────
function connect(onOpen) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.onopen = () => { if (onOpen) onOpen(); };

  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    handleMessage(msg);
  };

  ws.onerror = () => showNotif('Ошибка соединения', 'error');
  ws.onclose = () => {
    if (state.gameState && state.gameState.state !== 'ended') {
      showNotif('Соединение потеряно. Обновите страницу.', 'error');
    }
  };
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

// ── Message handler ──────────────────────────────────────────────────────
function handleMessage(msg) {
  switch (msg.type) {

    case 'room_created':
      state.roomId = msg.roomId;
      state.playerId = msg.playerId;
      showLobby();
      break;

    case 'room_joined':
      state.roomId = msg.roomId;
      state.playerId = msg.playerId;
      showLobby();
      break;

    case 'game_state':
      state.gameState = msg;
      state.role = msg.role;
      applyGameState(msg);
      break;

    case 'ship_result':
      if (msg.success) {
        showNotif(`🚚 Отправлено! +${msg.points} очков`, 'success');
        state.selectedPartId = null;
        state.selectedOrderId = null;
      } else {
        showNotif(`⚠ ${msg.reason}`, 'error');
      }
      break;

    case 'notify':
      showNotif(msg.message, 'warn');
      break;

    case 'error':
      showNotif(`❌ ${msg.message}`, 'error');
      break;
  }
}

// ── Lobby ────────────────────────────────────────────────────────────────
function showLobby() {
  $('lobby-room-id').textContent = state.roomId;
  showScreen('screen-lobby');
  updateLobbyPlayers([]);
}

function updateLobbyPlayers(players) {
  const el = $('lobby-players');
  el.innerHTML = '';
  players.forEach(p => {
    const chip = document.createElement('div');
    chip.className = 'player-chip';
    chip.innerHTML = `<span>${p.name}</span>${p.role ? `<span class="role-tag">[${ROLE_LABELS[p.role] || p.role}]</span>` : ''}`;
    el.appendChild(chip);
  });

  // Enable start if all players have roles and at least one player
  const allReady = players.length > 0 && players.every(p => p.role);
  $('btn-start').disabled = !allReady;
  $('lobby-msg').textContent = allReady ? 'Все готовы! Хост может начать.' : 'Выберите роли перед началом.';
}

// ── Apply game state ─────────────────────────────────────────────────────
function applyGameState(gs) {
  // Lobby updates (role selection)
  if (gs.state === 'lobby') {
    updateLobbyPlayers(gs.players);
    // Update role cards — mark taken roles
    document.querySelectorAll('.role-card').forEach(card => {
      const r = card.dataset.role;
      const takenBy = gs.players.find(p => p.role === r && p.id !== state.playerId);
      card.classList.toggle('taken', !!takenBy);
      card.classList.toggle('selected', gs.players.find(p => p.id === state.playerId && p.role === r) !== undefined);
    });
    return;
  }

  if (gs.state === 'playing') {
    if ($('screen-game').style.display !== 'flex' && !$('screen-game').classList.contains('active')) {
      showScreen('screen-game');
      showRolePanel(gs.role);
    }
    renderGame(gs);
  }

  if (gs.state === 'ended') {
    renderEndScreen(gs);
  }
}

function showRolePanel(role) {
  ['assembler', 'inspector', 'operator'].forEach(r => {
    $(`panel-${r}`).style.display = 'none';
  });
  if (role) $(`panel-${role}`).style.display = 'flex';
}

// ── Render game ──────────────────────────────────────────────────────────
function renderGame(gs) {
  // Header
  $('gh-room').textContent = gs.roomId;
  $('gh-score').textContent = gs.score;
  $('gh-pen').textContent = gs.penalties;
  $('gh-shipped').textContent = gs.shipped;

  const timerEl = $('gh-timer');
  timerEl.textContent = fmtTime(gs.timeLeft);
  timerEl.classList.toggle('urgent', gs.timeLeft < 60000);

  $('gh-role').textContent = ROLE_LABELS[gs.role] || gs.role;

  // Players bar
  renderPlayersBar(gs.players, gs.playerId);

  // Night shift
  const lo = $('lights-overlay');
  lo.classList.toggle('active', !!gs.lightsOut);

  // Panic for this player
  const me = gs.players.find(p => p.id === gs.playerId);
  const isPanicking = me && me.panicking;
  if (isPanicking && !state.panicking) {
    showNotif('😱 У вас ПАНИКА! Управление инвертировано!', 'error');
  }
  state.panicking = isPanicking;
  $('panic-banner').classList.toggle('active', !!isPanicking);

  // Role-specific rendering
  if (gs.role === 'assembler') renderAssembler(gs);
  else if (gs.role === 'inspector') renderInspector(gs);
  else if (gs.role === 'operator') renderOperator(gs);

  // Action hint
  updateActionHint(gs);
}

function renderPlayersBar(players, myId) {
  const bar = $('players-bar');
  bar.innerHTML = '';
  players.forEach(p => {
    const el = document.createElement('div');
    el.className = 'player-status' + (p.panicking ? ' panicking' : '');
    el.innerHTML = `<div class="ps-dot ${p.role ? '' : 'no-role'}"></div>
      <span>${p.name}${p.id === myId ? ' (я)' : ''}</span>
      ${p.role ? `<span style="color:var(--accent);font-size:0.65rem">[${ROLE_LABELS[p.role]}]</span>` : ''}
      ${p.panicking ? '<span style="color:var(--danger)">😱</span>' : ''}`;
    bar.appendChild(el);
  });
}

// ── Assembler ────────────────────────────────────────────────────────────
function renderAssembler(gs) {
  renderPartsZone('zone-warehouse', gs.parts.filter(p => p.zone === 'warehouse'), 'warehouse', gs);
  renderPartsZone('zone-assembly', gs.parts.filter(p => p.zone === 'assembly'), 'assembly', gs);
  renderOrdersAssembler(gs.orders);
  updateShipButton();
}

function renderPartsZone(zoneId, parts, zoneName, gs) {
  const el = $(zoneId);
  el.innerHTML = '';
  if (parts.length === 0) {
    el.innerHTML = '<div style="color:var(--text-dim);font-size:0.75rem;padding:8px">Пусто</div>';
    return;
  }
  parts.forEach(part => {
    const card = buildPartCard(part, zoneName, gs);
    el.appendChild(card);
  });
}

function buildPartCard(part, zone, gs) {
  const card = document.createElement('div');
  card.className = `part-card color-${part.color}`;
  if (state.selectedPartId === part.id) card.classList.add('selected');
  if (part.inspected === true)  card.classList.add('inspected-ok');
  if (part.inspected === false) card.classList.add('inspected-no');

  // Invert click if panicking
  const isPanicking = state.panicking;

  card.innerHTML = `
    <div class="shape-icon">${SHAPE_ICONS[part.shape] || '?'}</div>
    <div class="part-label">${COLOR_ABBREV[part.color] || part.color}</div>
    ${part.inspected === true  ? '<div class="inspect-badge ok">✓</div>' : ''}
    ${part.inspected === false ? '<div class="inspect-badge no">✗</div>' : ''}
  `;
  card.title = `${COLOR_NAMES[part.color]} ${SHAPE_NAMES[part.shape]}`;

  card.addEventListener('click', () => {
    if (gs.role === 'assembler' || gs.role === 'operator') {
      handlePartClick(part, zone, isPanicking);
    }
  });
  return card;
}

function handlePartClick(part, zone, panicking) {
  if (panicking) {
    // Invert: clicking warehouse moves to assembly and vice versa — but move in opposite direction
    const invertedZone = zone === 'warehouse' ? 'assembly' : 'warehouse';
    // Still allow selecting for shipping
    state.selectedPartId = part.id;
    updateShipButton();
    // Also attempt inverted move
    if (zone === 'assembly') {
      send({ type: 'move_part', partId: part.id, from: 'assembly', to: 'warehouse' });
    } else {
      send({ type: 'move_part', partId: part.id, from: 'warehouse', to: 'assembly' });
    }
    return;
  }

  if (zone === 'warehouse') {
    send({ type: 'move_part', partId: part.id, from: 'warehouse', to: 'assembly' });
  } else if (zone === 'assembly') {
    if (state.selectedPartId === part.id) {
      // Deselect
      state.selectedPartId = null;
    } else {
      state.selectedPartId = part.id;
    }
    updateShipButton();
  }
}

function renderOrdersAssembler(orders) {
  const el = $('orders-assembler');
  el.innerHTML = '';
  orders.filter(o => o.status === 'pending').forEach(order => {
    const card = buildOrderCard(order, 'assembler');
    el.appendChild(card);
  });
  // Completed/failed
  const done = orders.filter(o => o.status !== 'pending');
  done.forEach(order => {
    const card = buildOrderCard(order, 'assembler');
    el.appendChild(card);
  });
}

function buildOrderCard(order, role) {
  const card = document.createElement('div');
  card.className = `order-card ${order.status !== 'pending' ? order.status : ''}`;
  if (state.selectedOrderId === order.id && order.status === 'pending') card.classList.add('selected');

  const statusText = { pending: '', completed: '✅ Выполнен', failed: '❌ Брак', expired: '⏰ Истёк' };
  const colorDot = `<div class="order-color-dot" style="background:${order.color || '#888'}" title="${order.color}"></div>`;
  const shapeStr = order.shape ? `${SHAPE_ICONS[order.shape]} ${SHAPE_NAMES[order.shape]}` : '???';
  const colorStr = order.color ? `${COLOR_NAMES[order.color] || order.color}` : '???';

  let attrsHtml = '';
  if (role === 'assembler') {
    attrsHtml = `
      <div class="order-attrs">
        <div class="order-attr">${colorDot} ${colorStr}</div>
        <div class="order-attr" style="color:var(--text-dim)">Форма: ???</div>
      </div>`;
  } else if (role === 'inspector') {
    attrsHtml = `
      <div class="order-attrs">
        <div class="order-attr">${colorDot} ${colorStr}</div>
        <div class="order-attr">${shapeStr}</div>
      </div>`;
  } else {
    attrsHtml = `<div class="order-attrs"><div style="color:var(--text-dim);font-size:0.75rem">Статус: ${statusText[order.status] || order.status}</div></div>`;
  }

  const timerHtml = order.expiresAt && order.status === 'pending'
    ? `<div class="order-timer">⏰ ${fmtTime(order.expiresAt - Date.now())}</div>` : '';
  const statusHtml = order.status !== 'pending'
    ? `<div class="order-status ${order.status === 'completed' ? 'ok' : 'fail'}">${statusText[order.status]}</div>` : '';

  card.innerHTML = `
    <div class="order-top">
      <div class="order-id">#${order.id.slice(-4)}</div>
      <div class="order-pts">+${order.points}pts</div>
    </div>
    ${attrsHtml}
    ${timerHtml}
    ${statusHtml}
  `;

  if (order.status === 'pending' && role !== 'operator') {
    card.addEventListener('click', () => {
      state.selectedOrderId = state.selectedOrderId === order.id ? null : order.id;
      updateShipButton();
      renderOrdersAssembler(state.gameState.orders);
      // Re-render order list for inspector too
      if (role === 'inspector') renderOrdersInspector(state.gameState.orders);
    });
  }
  return card;
}

function updateShipButton() {
  const btn = $('ship-btn');
  if (!btn) return;
  const ready = !!state.selectedPartId && !!state.selectedOrderId;
  btn.disabled = !ready;
}

// ── Inspector ────────────────────────────────────────────────────────────
function renderInspector(gs) {
  const assemblyParts = gs.parts.filter(p => p.zone === 'assembly');

  // Stats
  $('insp-ok').textContent = gs.parts.filter(p => p.inspected === true).length;
  $('insp-no').textContent = gs.parts.filter(p => p.inspected === false).length;
  $('insp-pending').textContent = assemblyParts.filter(p => p.inspected === null).length;

  // Assembly zone
  const zone = $('zone-assembly-insp');
  zone.innerHTML = '';
  if (assemblyParts.length === 0) {
    zone.innerHTML = '<div style="color:var(--text-dim);font-size:0.75rem;padding:8px">Нет деталей в Сборке</div>';
  } else {
    assemblyParts.forEach(part => {
      const card = buildPartCard(part, 'assembly-insp', gs);
      card.addEventListener('click', () => {
        state.selectedInspPartId = state.selectedInspPartId === part.id ? null : part.id;
        renderInspector(gs);
      });
      if (state.selectedInspPartId === part.id) card.classList.add('selected');
      zone.appendChild(card);
    });
  }

  // Inspect buttons
  const hasSelected = !!state.selectedInspPartId && assemblyParts.some(p => p.id === state.selectedInspPartId && p.inspected === null);
  $('btn-approve').disabled = !hasSelected;
  $('btn-reject').disabled = !hasSelected;

  renderOrdersInspector(gs.orders);
}

function renderOrdersInspector(orders) {
  const el = $('orders-inspector');
  el.innerHTML = '';
  orders.forEach(order => el.appendChild(buildOrderCard(order, 'inspector')));
}

// ── Operator ─────────────────────────────────────────────────────────────
function renderOperator(gs) {
  // Conveyor speed
  const speed = gs.conveyorSpeed;
  const pct = ((speed - 0.5) / 2.5) * 100;
  $('conveyor-fill').style.width = `${pct}%`;
  $('conveyor-speed-txt').textContent = `${speed.toFixed(1)}x`;

  // Orders overview
  const el = $('orders-operator');
  el.innerHTML = '';
  const pending  = gs.orders.filter(o => o.status === 'pending').length;
  const done     = gs.orders.filter(o => o.status === 'completed').length;
  const failed   = gs.orders.filter(o => o.status === 'failed' || o.status === 'expired').length;
  el.innerHTML = `
    <div class="stats-row" style="flex-direction:column;gap:6px">
      <div class="stat-box"><div class="stat-val">${pending}</div><div class="stat-lbl">В ОЖИДАНИИ</div></div>
      <div class="stat-box"><div class="stat-val" style="color:var(--success)">${done}</div><div class="stat-lbl">ВЫПОЛНЕНО</div></div>
      <div class="stat-box"><div class="stat-val" style="color:var(--danger)">${failed}</div><div class="stat-lbl">БРАК/ИСТЁК</div></div>
    </div>
  `;

  // Log
  const log = $('op-log');
  log.innerHTML = '';
  (gs.operatorLog || []).forEach(line => {
    const d = document.createElement('div');
    d.className = 'op-log-line';
    d.textContent = line;
    log.appendChild(d);
  });
  log.scrollTop = log.scrollHeight;
}

// ── End screen ────────────────────────────────────────────────────────────
function renderEndScreen(gs) {
  showScreen('screen-end');
  $('end-score').textContent = gs.score;
  $('end-shipped').textContent = gs.shipped;
  $('end-pen').textContent = gs.penalties;

  const rulesEl = $('revealed-rules');
  rulesEl.innerHTML = '';
  (gs.revealedRules || []).forEach(rule => {
    const div = document.createElement('div');
    div.className = 'rule-item';
    div.innerHTML = `<div class="rule-name">⚡ ${rule.name}</div><div class="rule-desc">${rule.desc}</div>`;
    rulesEl.appendChild(div);
  });
}

// ── Action hint ────────────────────────────────────────────────────────────
function updateActionHint(gs) {
  const hints = {
    assembler: state.selectedPartId && state.selectedOrderId
      ? '✅ Деталь и заказ выбраны → нажми ОТПРАВИТЬ'
      : state.selectedPartId
        ? '📋 Теперь выбери заказ для отправки'
        : '📦 Кликни деталь на СКЛАДЕ чтобы переместить в СБОРКУ; в СБОРКЕ — выбрать для отправки',
    inspector: state.selectedInspPartId
      ? '🔍 Деталь выбрана → нажми OK или БРАК'
      : '🔍 Кликни деталь в СБОРКЕ чтобы проверить',
    operator: '🎛 Управляй конвейером. РЕЖИМ B / КАНАЛ 3 — на свой страх и риск!'
  };
  const hint = $('action-hint');
  hint.innerHTML = hints[gs.role] || '';
}

// ── Event listeners ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // Welcome
  $('btn-create').addEventListener('click', () => {
    const name = $('player-name').value.trim() || 'Рабочий';
    connect(() => send({ type: 'create_room', name }));
  });

  $('btn-join').addEventListener('click', () => {
    const name = $('player-name').value.trim() || 'Рабочий';
    const roomId = $('room-code').value.trim().toUpperCase();
    if (!roomId) { showNotif('Введите код комнаты', 'warn'); return; }
    connect(() => send({ type: 'join_room', roomId, name }));
  });

  $('player-name').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-create').click(); });
  $('room-code').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-join').click(); });

  // Lobby — role selection
  document.querySelectorAll('.role-card').forEach(card => {
    card.addEventListener('click', () => {
      if (card.classList.contains('taken')) return;
      send({ type: 'select_role', role: card.dataset.role });
    });
  });

  $('btn-start').addEventListener('click', () => {
    send({ type: 'start_game' });
  });

  // Assembler — ship button
  $('ship-btn').addEventListener('click', () => {
    if (!state.selectedPartId || !state.selectedOrderId) return;
    send({ type: 'ship_part', partId: state.selectedPartId, orderId: state.selectedOrderId });
    state.selectedPartId = null;
    state.selectedOrderId = null;
    updateShipButton();
  });

  // Inspector — approve/reject
  $('btn-approve').addEventListener('click', () => {
    if (!state.selectedInspPartId) return;
    send({ type: 'inspect_part', partId: state.selectedInspPartId, approved: true });
    state.selectedInspPartId = null;
  });
  $('btn-reject').addEventListener('click', () => {
    if (!state.selectedInspPartId) return;
    send({ type: 'inspect_part', partId: state.selectedInspPartId, approved: false });
    state.selectedInspPartId = null;
  });

  // Operator buttons
  const opMap = {
    'op-speed-up':   'speed_up',
    'op-speed-down': 'speed_down',
    'op-press':      'press',
    'op-sort':       'sort',
    'op-mystery':    'mystery'
  };
  Object.entries(opMap).forEach(([btnId, action]) => {
    $(btnId).addEventListener('click', () => send({ type: 'operator_action', action }));
  });

  // End screen — play again
  $('btn-play-again').addEventListener('click', () => {
    state.selectedPartId = null;
    state.selectedOrderId = null;
    state.selectedInspPartId = null;
    state.gameState = null;
    showScreen('screen-welcome');
  });
});
