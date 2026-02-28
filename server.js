'use strict';
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

const PORT = 3000;

// ─── Constants ────────────────────────────────────────────────────────────────
const COLORS = ['red', 'blue', 'green', 'yellow'];
const SHAPES = ['circle', 'square', 'triangle', 'star'];
const GAME_DURATION = 360000; // 6 minutes

// ─── Hidden rules pool (10 rules) ─────────────────────────────────────────────
const RULES_POOL = [
  {
    id: 'red_curse',
    name: 'Красное проклятие',
    desc: 'Красные детали автоматически помечаются БРАК при инспекции',
    hint: 'Красные детали ведут себя странно…'
  },
  {
    id: 'blue_bonus',
    name: 'Синий бонус',
    desc: 'Синие детали приносят двойные очки при отправке',
    hint: 'Некоторые цвета ценятся дороже обычного…'
  },
  {
    id: 'circle_fragility',
    name: 'Хрупкие круги',
    desc: 'Круглые детали рассыпаются в Сборке после 30 секунд',
    hint: 'Определённые формы плохо переносят ожидание…'
  },
  {
    id: 'night_shift',
    name: 'Ночная смена',
    desc: 'Каждые 45 секунд свет гаснет на 5 секунд',
    hint: 'Завод экономит на электричестве по ночам…'
  },
  {
    id: 'false_color',
    name: 'Ложные ярлыки',
    desc: '~20% заказов показывают неверный цвет Сборщику',
    hint: 'Принтер этикеток иногда врёт…'
  },
  {
    id: 'time_pressure',
    name: 'Давление времени',
    desc: 'Заказы истекают через 90 секунд',
    hint: 'Клиенты нетерпеливы сегодня…'
  },
  {
    id: 'inspector_veto',
    name: 'Вето инспектора',
    desc: 'Без штампа Инспектора (OK) деталь нельзя отправить',
    hint: 'ОТК требует обязательной проверки…'
  },
  {
    id: 'panic_mode',
    name: 'Паника',
    desc: 'Каждые 60 сек случайный игрок получает инвертированные действия на 10 сек',
    hint: 'Кто-то явно выпил лишнего перед сменой…'
  },
  {
    id: 'green_magnet',
    name: 'Зелёный магнит',
    desc: 'Зелёные детали сами едут в Сборку каждые 20 секунд',
    hint: 'Конвейер ведёт себя странно с определёнными деталями…'
  },
  {
    id: 'speed_demon',
    name: 'Демон скорости',
    desc: 'Оператор может ускорить конвейер, но это вдвое сокращает время жизни деталей',
    hint: 'Рычаг скорости что-то делает необычное…'
  }
];

// ─── Game state management ─────────────────────────────────────────────────────
const rooms = {};
const roomTimers = {};
const roomIntervals = {};

function randomId() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

function generateParts(count = 20) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    parts.push({
      id: `p${i}_${Date.now()}`,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      shape: SHAPES[Math.floor(Math.random() * SHAPES.length)],
      zone: 'warehouse',
      inspected: null,
      assembledAt: null
    });
  }
  return parts;
}

function generateOrders(count, activeRuleIds) {
  const orders = [];
  for (let i = 0; i < count; i++) {
    const realColor = COLORS[Math.floor(Math.random() * COLORS.length)];
    const realShape = SHAPES[Math.floor(Math.random() * SHAPES.length)];
    let displayColor = realColor;
    if (activeRuleIds.includes('false_color') && Math.random() < 0.2) {
      const others = COLORS.filter(c => c !== realColor);
      displayColor = others[Math.floor(Math.random() * others.length)];
    }
    orders.push({
      id: `o${i}_${Date.now()}`,
      realColor,
      realShape,
      displayColor,
      points: 1,
      status: 'pending',
      createdAt: Date.now(),
      expiresAt: activeRuleIds.includes('time_pressure') ? Date.now() + 90000 : null
    });
  }
  return orders;
}

function createRoom() {
  const roomId = randomId();
  const shuffled = [...RULES_POOL].sort(() => Math.random() - 0.5);
  const activeRuleIds = [shuffled[0].id, shuffled[1].id];
  return {
    id: roomId,
    players: {},
    state: 'lobby',
    parts: generateParts(20),
    orders: generateOrders(7, activeRuleIds),
    activeRuleIds,
    score: 0,
    penalties: 0,
    shipped: 0,
    startTime: null,
    conveyorSpeed: 1,
    lightsOut: false,
    operatorLog: []
  };
}

// ─── Role-specific views ───────────────────────────────────────────────────────
function getView(room, playerId) {
  const player = room.players[playerId];
  if (!player) return null;
  const role = player.role;

  const timeLeft = room.startTime
    ? Math.max(0, GAME_DURATION - (Date.now() - room.startTime))
    : GAME_DURATION;

  const base = {
    type: 'game_state',
    roomId: room.id,
    playerId,
    role,
    state: room.state,
    score: room.score,
    penalties: room.penalties,
    shipped: room.shipped,
    conveyorSpeed: room.conveyorSpeed,
    lightsOut: room.lightsOut,
    timeLeft,
    operatorLog: room.operatorLog.slice(-5),
    players: Object.values(room.players).map(p => ({
      id: p.id,
      name: p.name,
      role: p.role,
      panicking: p.panicking || false
    }))
  };

  // Parts view
  base.parts = room.parts.map(p => ({ ...p }));

  // Orders — role-specific
  if (role === 'inspector') {
    base.orders = room.orders.map(o => ({
      id: o.id,
      color: o.realColor,
      shape: o.realShape,
      points: o.points,
      status: o.status,
      expiresAt: o.expiresAt
    }));
  } else if (role === 'assembler') {
    // Assembler sees display color (potentially wrong) but shape is hidden
    base.orders = room.orders.map(o => ({
      id: o.id,
      color: o.displayColor,
      shape: null,
      points: o.points,
      status: o.status,
      expiresAt: o.expiresAt
    }));
  } else {
    // operator sees only status/count
    base.orders = room.orders.map(o => ({
      id: o.id,
      status: o.status,
      points: o.points
    }));
  }

  // Reveal rules at game end
  if (room.state === 'ended') {
    base.revealedRules = room.activeRuleIds.map(id => RULES_POOL.find(r => r.id === id));
  }

  return base;
}

function broadcastAll(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  Object.values(room.players).forEach(p => {
    if (p.ws && p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(JSON.stringify(getView(room, p.id)));
    }
  });
}

// ─── Shipping validation ───────────────────────────────────────────────────────
function tryShip(room, partId, orderId) {
  const part = room.parts.find(p => p.id === partId);
  const order = room.orders.find(o => o.id === orderId);

  if (!part || !order) return { success: false, reason: 'Деталь или заказ не найдены' };
  if (part.zone !== 'assembly') return { success: false, reason: 'Деталь должна быть в Сборке' };
  if (order.status !== 'pending') return { success: false, reason: 'Заказ уже закрыт' };
  if (part.inspected === false) return { success: false, reason: 'Деталь помечена как БРАК' };

  if (room.activeRuleIds.includes('inspector_veto') && part.inspected !== true) {
    return { success: false, reason: '⚠ ПРАВИЛО: Требуется штамп Инспектора!' };
  }

  const colorOk = part.color === order.realColor;
  const shapeOk = part.shape === order.realShape;

  if (!colorOk || !shapeOk) {
    room.penalties++;
    part.zone = 'trash';
    order.status = 'failed';
    return { success: false, reason: `Несоответствие! Нужно: ${order.realColor} ${order.realShape}` };
  }

  let pts = order.points;
  if (room.activeRuleIds.includes('blue_bonus') && part.color === 'blue') pts *= 2;

  room.score += pts;
  room.shipped++;
  part.zone = 'shipped';
  order.status = 'completed';
  return { success: true, points: pts };
}

// ─── Operator actions ──────────────────────────────────────────────────────────
function handleOperator(room, action) {
  const log = (msg) => {
    room.operatorLog.push(`[${new Date().toLocaleTimeString('ru')}] ${msg}`);
  };

  switch (action) {
    case 'speed_up':
      room.conveyorSpeed = Math.min(3, room.conveyorSpeed + 0.5);
      log(`Скорость конвейера: ${room.conveyorSpeed}x`);
      // At high speed, auto-move one part from warehouse to assembly
      if (room.conveyorSpeed >= 2) {
        const wh = room.parts.find(p => p.zone === 'warehouse');
        if (wh) {
          wh.zone = 'assembly';
          wh.assembledAt = Date.now();
          log(`Автоперемещение детали на Сборку`);
        }
      }
      break;
    case 'speed_down':
      room.conveyorSpeed = Math.max(0.5, room.conveyorSpeed - 0.5);
      log(`Скорость конвейера: ${room.conveyorSpeed}x`);
      break;
    case 'press':
      {
        const removed = room.parts.filter(p => p.zone === 'assembly').length;
        room.parts.filter(p => p.zone === 'assembly').forEach(p => { p.zone = 'trash'; });
        log(`Пресс сработал — ${removed} деталей утилизировано`);
      }
      break;
    case 'sort':
      log(`Сортировщик активирован — детали в складе перегруппированы`);
      // Sort warehouse parts by color for UI clarity
      room.parts.sort((a, b) => {
        if (a.zone === 'warehouse' && b.zone === 'warehouse') return a.color.localeCompare(b.color);
        return 0;
      });
      break;
    case 'mystery':
      // Abstract lever — random effect
      {
        const effects = [
          () => { room.parts.filter(p => p.zone === 'assembly').forEach(p => { p.inspected = null; }); log('Рычаг B: сброс инспекции всех деталей в Сборке'); },
          () => { const wh = room.parts.filter(p => p.zone === 'warehouse'); wh.forEach(p => { p.zone = 'assembly'; p.assembledAt = Date.now(); }); log('Рычаг B: весь склад попал в Сборку!'); },
          () => { room.score = Math.max(0, room.score - 2); room.penalties++; log('Рычаг B: что-то пошло не так (-2 очка)'); },
          () => { room.score += 3; log('Рычаг B: неожиданная премия (+3 очка)!'); }
        ];
        effects[Math.floor(Math.random() * effects.length)]();
      }
      break;
  }
}

// ─── Game lifecycle ────────────────────────────────────────────────────────────
function startGame(roomId) {
  const room = rooms[roomId];
  room.state = 'playing';
  room.startTime = Date.now();

  // 1-second heartbeat: timer, circle fragility, order expiry
  roomTimers[roomId] = setInterval(() => {
    const r = rooms[roomId];
    if (!r) return clearInterval(roomTimers[roomId]);

    const elapsed = Date.now() - r.startTime;

    if (r.activeRuleIds.includes('circle_fragility')) {
      r.parts.forEach(p => {
        if (p.zone === 'assembly' && p.shape === 'circle' && p.assembledAt) {
          const speedFactor = r.activeRuleIds.includes('speed_demon') ? r.conveyorSpeed : 1;
          const age = (Date.now() - p.assembledAt) * speedFactor;
          if (age > 30000) {
            p.zone = 'trash';
            p.assembledAt = null;
          }
        }
      });
    }

    if (r.activeRuleIds.includes('time_pressure')) {
      r.orders.forEach(o => {
        if (o.status === 'pending' && o.expiresAt && Date.now() > o.expiresAt) {
          o.status = 'expired';
          r.penalties++;
        }
      });
    }

    if (elapsed >= GAME_DURATION) {
      endGame(roomId);
    } else {
      broadcastAll(roomId);
    }
  }, 1000);

  // Night shift
  if (room.activeRuleIds.includes('night_shift')) {
    roomIntervals[`${roomId}_night`] = setInterval(() => {
      const r = rooms[roomId];
      if (!r || r.state !== 'playing') return;
      r.lightsOut = true;
      broadcastAll(roomId);
      setTimeout(() => {
        if (rooms[roomId]) { rooms[roomId].lightsOut = false; broadcastAll(roomId); }
      }, 5000);
    }, 45000);
  }

  // Panic mode
  if (room.activeRuleIds.includes('panic_mode')) {
    roomIntervals[`${roomId}_panic`] = setInterval(() => {
      const r = rooms[roomId];
      if (!r || r.state !== 'playing') return;
      const ids = Object.keys(r.players);
      if (!ids.length) return;
      const pid = ids[Math.floor(Math.random() * ids.length)];
      r.players[pid].panicking = true;
      broadcastAll(roomId);
      setTimeout(() => {
        if (rooms[roomId] && rooms[roomId].players[pid]) {
          rooms[roomId].players[pid].panicking = false;
          broadcastAll(roomId);
        }
      }, 10000);
    }, 60000);
  }

  // Green magnet
  if (room.activeRuleIds.includes('green_magnet')) {
    roomIntervals[`${roomId}_magnet`] = setInterval(() => {
      const r = rooms[roomId];
      if (!r || r.state !== 'playing') return;
      r.parts.filter(p => p.zone === 'warehouse' && p.color === 'green').forEach(p => {
        p.zone = 'assembly';
        p.assembledAt = Date.now();
      });
      broadcastAll(roomId);
    }, 20000);
  }
}

function endGame(roomId) {
  const room = rooms[roomId];
  if (!room || room.state === 'ended') return;
  room.state = 'ended';
  clearInterval(roomTimers[roomId]);
  Object.keys(roomIntervals)
    .filter(k => k.startsWith(roomId))
    .forEach(k => { clearInterval(roomIntervals[k]); delete roomIntervals[k]; });
  broadcastAll(roomId);
}

function cleanupRoom(roomId) {
  clearInterval(roomTimers[roomId]);
  delete roomTimers[roomId];
  Object.keys(roomIntervals).filter(k => k.startsWith(roomId)).forEach(k => {
    clearInterval(roomIntervals[k]); delete roomIntervals[k];
  });
  delete rooms[roomId];
}

// ─── WebSocket handler ─────────────────────────────────────────────────────────
wss.on('connection', ws => {
  let playerId = null;
  let roomId = null;

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      case 'create_room': {
        const room = createRoom();
        roomId = room.id;
        rooms[roomId] = room;
        playerId = `pl_${randomId()}`;
        room.players[playerId] = { id: playerId, name: (msg.name || 'Игрок').slice(0, 20), role: null, ws, panicking: false };
        ws.send(JSON.stringify({ type: 'room_created', roomId, playerId }));
        break;
      }

      case 'join_room': {
        const r = rooms[msg.roomId];
        if (!r) { ws.send(JSON.stringify({ type: 'error', message: 'Комната не найдена' })); return; }
        if (r.state !== 'lobby') { ws.send(JSON.stringify({ type: 'error', message: 'Игра уже началась' })); return; }
        roomId = msg.roomId;
        playerId = `pl_${randomId()}`;
        r.players[playerId] = { id: playerId, name: (msg.name || 'Игрок').slice(0, 20), role: null, ws, panicking: false };
        ws.send(JSON.stringify({ type: 'room_joined', roomId, playerId }));
        broadcastAll(roomId);
        break;
      }

      case 'select_role': {
        const r = rooms[roomId];
        if (!r || r.state !== 'lobby') return;
        const taken = Object.values(r.players).some(p => p.id !== playerId && p.role === msg.role);
        if (taken) { ws.send(JSON.stringify({ type: 'error', message: 'Роль уже занята' })); return; }
        r.players[playerId].role = msg.role;
        broadcastAll(roomId);
        break;
      }

      case 'start_game': {
        const r = rooms[roomId];
        if (!r || r.state !== 'lobby') return;
        const missing = Object.values(r.players).filter(p => !p.role);
        if (missing.length) { ws.send(JSON.stringify({ type: 'error', message: 'Не все игроки выбрали роль' })); return; }
        startGame(roomId);
        broadcastAll(roomId);
        break;
      }

      case 'move_part': {
        const r = rooms[roomId];
        if (!r || r.state !== 'playing') return;
        const player = r.players[playerId];
        if (!player || player.role === 'inspector') {
          ws.send(JSON.stringify({ type: 'error', message: 'Инспектор не может двигать детали' })); return;
        }
        const part = r.parts.find(p => p.id === msg.partId);
        if (!part) return;
        const { from, to } = msg;
        const allowed = { warehouse: ['assembly'], assembly: ['warehouse'] };
        if (allowed[part.zone] && allowed[part.zone].includes(to)) {
          part.zone = to;
          if (to === 'assembly') part.assembledAt = Date.now();
          else { part.assembledAt = null; part.inspected = null; }
          broadcastAll(roomId);
        }
        break;
      }

      case 'inspect_part': {
        const r = rooms[roomId];
        if (!r || r.state !== 'playing') return;
        const player = r.players[playerId];
        if (!player || player.role !== 'inspector') {
          ws.send(JSON.stringify({ type: 'error', message: 'Только Инспектор может проверять' })); return;
        }
        const part = r.parts.find(p => p.id === msg.partId);
        if (!part || part.zone !== 'assembly') {
          ws.send(JSON.stringify({ type: 'error', message: 'Деталь не в Сборке' })); return;
        }
        // Red curse: force reject
        if (r.activeRuleIds.includes('red_curse') && part.color === 'red') {
          part.inspected = false;
          ws.send(JSON.stringify({ type: 'notify', message: '⚠ Красная деталь автоматически БРАК!' }));
        } else {
          part.inspected = msg.approved ? true : false;
        }
        broadcastAll(roomId);
        break;
      }

      case 'ship_part': {
        const r = rooms[roomId];
        if (!r || r.state !== 'playing') return;
        const player = r.players[playerId];
        if (!player || player.role === 'inspector') {
          ws.send(JSON.stringify({ type: 'error', message: 'Инспектор не может отправлять' })); return;
        }
        const result = tryShip(r, msg.partId, msg.orderId);
        ws.send(JSON.stringify({ type: 'ship_result', ...result }));
        broadcastAll(roomId);
        break;
      }

      case 'operator_action': {
        const r = rooms[roomId];
        if (!r || r.state !== 'playing') return;
        const player = r.players[playerId];
        if (!player || player.role !== 'operator') {
          ws.send(JSON.stringify({ type: 'error', message: 'Только Оператор управляет машинами' })); return;
        }
        handleOperator(r, msg.action);
        broadcastAll(roomId);
        break;
      }

      case 'ping': {
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!roomId || !rooms[roomId] || !playerId) return;
    const r = rooms[roomId];
    const name = r.players[playerId]?.name;
    delete r.players[playerId];
    if (Object.keys(r.players).length === 0) {
      cleanupRoom(roomId);
    } else {
      broadcastAll(roomId);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Shift From Hell server → http://localhost:${PORT}`);
});
