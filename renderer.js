'use strict';

const statusEl = document.getElementById('status');
const btnOmen = document.getElementById('btn-omen');
const btnShuffle = document.getElementById('btn-shuffle');
const btnQuit = document.getElementById('btn-quit');
const btnByCard = document.getElementById('btn-by-card');
const btnSave = document.getElementById('btn-save');
const btnDeep = document.getElementById('btn-deep');
const btnLoad = document.getElementById('btn-load');
const btnEnd = document.getElementById('btn-end');
const btnViewInit = document.getElementById('btn-view-init');
const btnViewDeep = document.getElementById('btn-view-deep');
const btnViewSummary = document.getElementById('btn-view-summary');
const questionInput = document.getElementById('question-input');
const deityInput = document.getElementById('deity-input');
const btnDeityLock = document.getElementById('btn-deity-lock');
const btnInterpret = document.getElementById('btn-interpret');
const resultEl = document.getElementById('interpret-result');
const deepResultEl = document.getElementById('deep-result');
const summaryResultEl = document.getElementById('summary-result');
const cardExplanationsEl = document.getElementById('card-explanations');
const canvasEl = document.getElementById('tree-canvas');
const contentEl = document.getElementById('tree-content');
const linesSvg = document.getElementById('tree-lines');
const cardTipEl = document.getElementById('card-tip');
const modalOverlayEl = document.getElementById('modal-overlay');
const modalTitleEl = document.getElementById('modal-title');
const modalBodyEl = document.getElementById('modal-body');

let lastByCardText = '';
let roundId = '';
let roundCompleted = false;
let lastInterpretRaw = '';
let lastInterpretJson = null;
let lastInterpretedAt = null;
let lastDeepRaw = '';
let lastDeepJson = null;
let lastDeepAt = null;
let lastClosing = '';
let lastSummaryRaw = '';
let lastCompletedAt = null;

function showStatus(msg, isError) {
  statusEl.textContent = msg || '';
  statusEl.classList.toggle('error', !!isError);
  if (msg && typeof showToast === 'function') {
    showToast(msg);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function fmtTime(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---- 塔羅牌組 ----
const MAJOR_ARCANA = [
  '愚者', '魔術師', '女祭司', '皇后', '皇帝', '教皇', '戀人', '戰車',
  '力量', '隱者', '命運之輪', '正義', '倒吊人', '死神', '節制', '惡魔',
  '高塔', '星星', '月亮', '太陽', '審判', '世界'
];

const MINOR_RANKS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '侍者', '騎士', '王后', '國王'];
const MINOR_SUITS = ['權杖', '聖杯', '寶劍', '錢幣'];

function buildDeck() {
  const deck = MAJOR_ARCANA.map((card, idx) => ({ idx, card }));
  let num = MAJOR_ARCANA.length;
  for (const suit of MINOR_SUITS) {
    for (const rank of MINOR_RANKS) {
      deck.push({ idx: num, card: `${suit}${rank}` });
      num++;
    }
  }
  return deck;
}

const FULL_DECK = buildDeck();

// ---- 樹狀結構 ----
const NODE_W = 76;
const NODE_H = 104;
const H_GAP = 14;
const V_GAP = 48;
const ROOT_GAP = 24;
const MARGIN = 28;

// 相同深度的卡牌使用同一種顏色
const DEPTH_COLORS = [
  { border: 'rgba(150, 120, 220, 0.95)', text: '#c9b7f0' },
  { border: 'rgba(80, 180, 200, 0.95)', text: '#9fd8e6' },
  { border: 'rgba(240, 170, 60, 0.95)', text: '#f5d08f' },
  { border: 'rgba(240, 110, 140, 0.95)', text: '#f2b6c4' },
  { border: 'rgba(110, 200, 130, 0.95)', text: '#a9e0b8' }
];

let nextNodeId = 1;
const nodes = [];
const nodeById = new Map();
const drawnIdx = new Set();

function childrenOf(id) {
  return nodes.filter((n) => n.parentId === id);
}

function roots() {
  return nodes.filter((n) => n.parentId === null);
}

function depthColor(depth) {
  return DEPTH_COLORS[depth % DEPTH_COLORS.length];
}

// 第一層卡牌上限（設置頁可調整，預設 6）
function rootLimit() {
  const v = parseInt(localStorage.getItem('spread.rootLimit') || '6', 10);
  return Number.isFinite(v) && v >= 1 ? v : 6;
}

function parseToken(token) {
  const m = /^(\d+)-(.+)([+-])$/.exec(token);
  return m ? { idx: Number(m[1]), name: m[2], upright: m[3] === '+' } : null;
}

function cardLabel(token) {
  const p = parseToken(token);
  return p ? `${p.name}${p.upright ? '（正）' : '（逆）'}` : token;
}

// 從未抽出的牌中隨機取一張（洗牌前不重複）
function pickCard() {
  const available = FULL_DECK.filter((c) => !drawnIdx.has(c.idx));
  if (available.length === 0) return null;
  const c = available[Math.floor(Math.random() * available.length)];
  drawnIdx.add(c.idx);
  const upright = Math.random() < 0.5;
  const token = `${c.idx}-${c.card}${upright ? '+' : '-'}`;
  return { token, label: cardLabel(token), idx: c.idx };
}

// 樹狀自動佈局：根節點橫向（廣度），子節點縱向（深度）
function layoutTree() {
  function subtreeWidth(node) {
    const ch = childrenOf(node.id);
    if (ch.length === 0) return NODE_W;
    let w = 0;
    for (const c of ch) w += subtreeWidth(c) + H_GAP;
    return w - H_GAP;
  }

  function place(node, cx, depth) {
    node.x = Math.round(cx - NODE_W / 2);
    node.y = MARGIN + depth * (NODE_H + V_GAP);
    const ch = childrenOf(node.id);
    if (ch.length === 0) return;
    const total = subtreeWidth(node);
    let x = cx - total / 2;
    for (const c of ch) {
      const w = subtreeWidth(c);
      place(c, x + w / 2, depth + 1);
      x += w + H_GAP;
    }
  }

  let offset = MARGIN;
  for (const root of roots()) {
    const w = subtreeWidth(root);
    place(root, offset + w / 2, 0);
    offset += w + ROOT_GAP;
  }
}

function contentSize() {
  let w = MARGIN;
  let h = MARGIN;
  for (const n of nodes) {
    w = Math.max(w, n.x + NODE_W + MARGIN);
    h = Math.max(h, n.y + NODE_H + MARGIN);
  }
  const cw = canvasEl.clientWidth || 0;
  const ch = canvasEl.clientHeight || 0;
  return { w: Math.max(w, cw), h: Math.max(h, ch) };
}

// 父節點 → 子節點的縱向連線
function renderLines() {
  const parts = [];
  for (const n of nodes) {
    if (!n.parentId) continue;
    const p = nodeById.get(n.parentId);
    if (!p) continue;
    const x1 = p.x + NODE_W / 2;
    const y1 = p.y + NODE_H;
    const x2 = n.x + NODE_W / 2;
    const y2 = n.y;
    const midY = (y1 + y2) / 2;
    parts.push(`M${x1},${y1} V${midY} H${x2} V${y2}`);
  }
  linesSvg.innerHTML = parts
    .map((d) => `<path d="${d}" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1.5"/>`)
    .join('');
}

function renderTree() {
  const { w, h } = contentSize();
  contentEl.style.width = w + 'px';
  contentEl.style.height = h + 'px';
  linesSvg.setAttribute('width', w);
  linesSvg.setAttribute('height', h);
  renderLines();

  const existing = new Map();
  contentEl.querySelectorAll('.tree-card').forEach((el) => existing.set(Number(el.dataset.id), el));
  const seen = new Set();

  for (const n of nodes) {
    seen.add(n.id);
    let el = existing.get(n.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'tree-card';
      el.dataset.id = String(n.id);

      const name = document.createElement('div');
      name.className = 'card-name';

      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'card-add';
      add.title = '增加節點';
      add.textContent = '+';
      add.addEventListener('mousedown', (e) => e.stopPropagation());
      add.addEventListener('click', (e) => {
        e.stopPropagation();
        addNode(n.id);
      });

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'card-del';
      del.title = '刪除';
      del.textContent = '✕';
      del.addEventListener('mousedown', (e) => e.stopPropagation());
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        removeNode(n.id);
      });

      el.appendChild(name);
      el.appendChild(add);
      el.appendChild(del);

      // 子節點：懸停顯示「?」按鈕，可綁定想解析的問題
      if (n.depth > 0) {
        const q = document.createElement('button');
        q.type = 'button';
        q.className = 'card-q';
        q.title = '設定想解析的問題';
        q.textContent = '?';
        q.addEventListener('mousedown', (e) => e.stopPropagation());
        q.addEventListener('click', (e) => {
          e.stopPropagation();
          openQuestionModal(n);
        });
        el.appendChild(q);
      }

      el.addEventListener('mousedown', (e) => startDrag(n, e));
      el.addEventListener('mouseenter', () => showCardTip(n));
      el.addEventListener('mouseleave', hideCardTip);
      contentEl.appendChild(el);
    }
    el.style.left = n.x + 'px';
    el.style.top = n.y + 'px';
    const color = depthColor(n.depth);
    el.style.setProperty('--dc', color.border);
    el.style.borderColor = color.border;
    el.querySelector('.card-name').textContent = n.label;
    el.querySelector('.card-name').style.color = color.text;
    const qEl = el.querySelector('.card-q');
    if (qEl) qEl.classList.toggle('active', !!n.question);
    el.classList.toggle('interpreted', !!(n.interp || n.deepInterp));
    el.classList.toggle('locked', roundCompleted);
  }

  existing.forEach((el, id) => {
    if (!seen.has(id)) el.remove();
  });
}

// ---- 卡牌解釋提示（懸停已解牌時顯示） ----
function showCardTip(node) {
  const text = node.deepInterp || node.interp;
  if (dragState || !text) {
    hideCardTip();
    return;
  }
  const { w } = contentSize();
  cardTipEl.textContent = text;
  const left = node.x + NODE_W + 10;
  cardTipEl.style.left = (left + 280 > w ? node.x - 10 - 280 : left) + 'px';
  cardTipEl.style.top = (node.y + NODE_H / 2 - 24) + 'px';
  cardTipEl.hidden = false;
}

function hideCardTip() {
  cardTipEl.hidden = true;
  cardTipEl.textContent = '';
}

// ---- 拖拽 ----
let dragState = null;

function startDrag(node, e) {
  if (roundCompleted || e.button !== 0) return;
  e.preventDefault();
  hideCardTip();
  dragState = {
    node,
    startX: e.clientX,
    startY: e.clientY,
    origX: node.x,
    origY: node.y
  };
  document.body.classList.add('dragging');
}

document.addEventListener('mousemove', (e) => {
  if (!dragState) return;
  const n = dragState.node;
  n.x = Math.max(0, dragState.origX + (e.clientX - dragState.startX));
  n.y = Math.max(0, dragState.origY + (e.clientY - dragState.startY));
  const el = contentEl.querySelector(`.tree-card[data-id="${n.id}"]`);
  if (el) {
    el.style.left = n.x + 'px';
    el.style.top = n.y + 'px';
  }
  renderLines();
});

document.addEventListener('mouseup', () => {
  if (!dragState) return;
  dragState = null;
  document.body.classList.remove('dragging');
  renderTree();
});

function revealNode(node) {
  const cw = canvasEl.clientWidth;
  const ch = canvasEl.clientHeight;
  const nx = node.x + NODE_W / 2;
  const ny = node.y + NODE_H / 2;
  let sx = canvasEl.scrollLeft;
  let sy = canvasEl.scrollTop;
  if (nx < sx) sx = nx - 40;
  else if (nx > sx + cw) sx = nx - cw + 40;
  if (ny < sy) sy = ny - 40;
  else if (ny > sy + ch) sy = ny - ch + 40;
  canvasEl.scrollLeft = sx;
  canvasEl.scrollTop = sy;
}

// ---- 通用彈窗 ----
function showModal(title, bodyHtml, onMount) {
  modalTitleEl.textContent = title;
  modalBodyEl.innerHTML = bodyHtml;
  modalOverlayEl.hidden = false;
  if (onMount) onMount(modalBodyEl);
}

function closeModal() {
  modalOverlayEl.hidden = true;
  modalBodyEl.innerHTML = '';
  modalTitleEl.textContent = '';
}

// ---- 保存 ----
function spreadSnapshot() {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      idx: n.idx,
      token: n.token,
      label: n.label,
      depth: n.depth,
      parentId: n.parentId,
      x: n.x,
      y: n.y,
      interp: n.interp || '',
      question: n.question || '',
      deepInterp: n.deepInterp || ''
    }))
  };
}

// 將目前牌陣與解牌結果（如有）寫入歷史；解牌後自動呼叫
function saveSpread() {
  const payload = {
    roundId,
    cards: nodes.map((n) => n.token).join(', '),
    spread: spreadSnapshot()
  };
  if (lastInterpretRaw) {
    payload.interpretation = lastInterpretRaw;
    payload.interpretationJson = lastInterpretJson;
    payload.interpretedAt = lastInterpretedAt;
  }
  if (lastDeepRaw) {
    payload.deepInterpretationRaw = lastDeepRaw;
    payload.deepInterpretationJson = lastDeepJson;
    payload.deepInterpretedAt = lastDeepAt;
  }
  if (roundCompleted) {
    payload.completed = true;
    payload.completedAt = lastCompletedAt;
    payload.closing = lastClosing || '';
    payload.summary = lastSummaryRaw || '';
  }
  try {
    window.api.historySave(payload);
  } catch (e) {
    // 保存失敗不影響操作
  }
  return payload;
}

// ---- 抽牌節點 ----
function insertNode(card, parentId, verb) {
  const parent = parentId ? nodeById.get(parentId) : null;
  const node = {
    id: nextNodeId++,
    idx: card.idx,
    token: card.token,
    label: card.label,
    depth: parent ? parent.depth + 1 : 0,
    parentId: parentId || null,
    x: 0,
    y: 0,
    interp: '',
    question: '',
    deepInterp: ''
  };
  nodes.push(node);
  nodeById.set(node.id, node);
  layoutTree();
  renderTree();
  revealNode(node);
  showStatus(`${verb || '已加入'}：${card.label}`);
  saveSpread();
  questionInput.focus();
}

function addNode(parentId) {
  if (roundCompleted) {
    showStatus('占卜已結束，無法再抽牌', true);
    return;
  }
  if (parentId === null && roots().length >= rootLimit()) {
    showStatus(`第一層最多 ${rootLimit()} 張，可在設置中調整`, true);
    return;
  }
  const card = pickCard();
  if (!card) {
    showStatus('整副牌已抽完，請重新洗牌', true);
    return;
  }
  // 保留既有的解牌結果（不覆蓋），新節點本身為「未解牌」
  insertNode(card, parentId, '已抽出');
}

// ---- 手動選牌（第一層） ----
const pickerOverlayEl = document.getElementById('picker-overlay');
const pickerGridEl = document.getElementById('picker-grid');

function pickerHeader(idx) {
  if (idx < MAJOR_ARCANA.length) return '大阿卡那';
  return MINOR_SUITS[Math.floor((idx - MAJOR_ARCANA.length) / MINOR_RANKS.length)];
}

function openPicker() {
  const limit = rootLimit();
  const remain = limit - roots().length;
  pickerGridEl.innerHTML = '';
  if (remain <= 0) {
    pickerGridEl.innerHTML = `<div class="picker-empty">第一層已達上限（${limit} 張），可在設置中調整</div>`;
  } else {
    const available = FULL_DECK.filter((c) => !drawnIdx.has(c.idx));
    if (available.length === 0) {
      pickerGridEl.innerHTML = '<div class="picker-empty">整副牌已抽完，請重新洗牌</div>';
    } else {
      let lastHeader = null;
      for (const c of available) {
        const h = pickerHeader(c.idx);
        if (h !== lastHeader) {
          lastHeader = h;
          const hd = document.createElement('div');
          hd.className = 'picker-header';
          hd.textContent = h;
          pickerGridEl.appendChild(hd);
        }
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'picker-card';
        cell.textContent = c.card;
        // 左鍵 = 正位，右鍵 = 逆位
        cell.addEventListener('click', () => {
          addManualCard(c, true);
          closePicker();
        });
        cell.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          addManualCard(c, false);
          closePicker();
        });
        pickerGridEl.appendChild(cell);
      }
    }
  }
  pickerOverlayEl.hidden = false;
}

function closePicker() {
  pickerOverlayEl.hidden = true;
}

// 手動將指定卡加入第一層（左鍵正位 / 右鍵逆位，洗牌前不重複）
function addManualCard(deckCard, upright) {
  if (roundCompleted) {
    showStatus('占卜已結束，無法再選牌', true);
    return;
  }
  if (roots().length >= rootLimit()) {
    showStatus(`第一層最多 ${rootLimit()} 張，可在設置中調整`, true);
    return;
  }
  if (drawnIdx.has(deckCard.idx)) return;
  drawnIdx.add(deckCard.idx);
  const token = `${deckCard.idx}-${deckCard.card}${upright ? '+' : '-'}`;
  insertNode({ token, label: cardLabel(token), idx: deckCard.idx }, null, '已加入');
}

// 刪除節點（含其所有子節點），並把該牌還回牌池
function removeNode(id) {
  if (roundCompleted) {
    showStatus('占卜已結束，無法刪除卡牌', true);
    return;
  }
  const toRemove = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    const n = nodeById.get(cur);
    if (!n) continue;
    toRemove.push(n);
    for (const c of childrenOf(cur)) stack.push(c.id);
  }
  for (const n of toRemove) {
    drawnIdx.delete(n.idx);
    nodeById.delete(n.id);
  }
  const ids = new Set(toRemove.map((n) => n.id));
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (ids.has(nodes[i].id)) nodes.splice(i, 1);
  }
  layoutTree();
  renderTree();
  saveSpread();
  showStatus(toRemove.length > 1 ? `已刪除 ${toRemove.length} 張牌` : '已刪除該牌');
}

function startNewRound(notify) {
  roundId = String(Date.now());
  nextNodeId = 1;
  nodes.length = 0;
  nodeById.clear();
  drawnIdx.clear();
  dragState = null;
  roundCompleted = false;
  lastInterpretRaw = '';
  lastInterpretJson = null;
  lastInterpretedAt = null;
  lastDeepRaw = '';
  lastDeepJson = null;
  lastDeepAt = null;
  lastClosing = '';
  lastSummaryRaw = '';
  lastCompletedAt = null;
  lastByCardText = '';
  summaryResultEl.hidden = true;
  summaryResultEl.textContent = '';
  contentEl.querySelectorAll('.tree-card').forEach((el) => el.remove());
  renderTree();
  clearInterpretState();
  applyCompletedState();
  showStatus(notify ? '已開始新輪次，請抽牌' : '');
  questionInput.focus();
}

// 完成後鎖定：不可再抽牌、選牌、解牌、深度解牌；洗牌可開啟新輪次
function applyCompletedState() {
  const done = roundCompleted;
  btnOmen.disabled = done;
  document.getElementById('btn-pick').disabled = done;
  btnInterpret.disabled = done;
  btnDeep.disabled = done;
  if (done) {
    statusEl.textContent = '本次占卜已完成';
    statusEl.classList.remove('error');
  }
}

function clearInterpretState() {
  for (const n of nodes) {
    n.interp = '';
    n.deepInterp = '';
  }
  lastByCardText = '';
  lastInterpretRaw = '';
  lastInterpretJson = null;
  lastInterpretedAt = null;
  lastDeepRaw = '';
  lastDeepJson = null;
  lastDeepAt = null;
  cardExplanationsEl.hidden = true;
  cardExplanationsEl.textContent = '';
  btnByCard.classList.remove('active');
  resultEl.hidden = true;
  resultEl.textContent = '';
  deepResultEl.hidden = true;
  deepResultEl.textContent = '';
  hideCardTip();
}

btnOmen.addEventListener('click', () => addNode(null));
btnShuffle.addEventListener('click', () => startNewRound(true));
document.getElementById('btn-pick').addEventListener('click', openPicker);
document.getElementById('picker-close').addEventListener('click', closePicker);
pickerOverlayEl.addEventListener('click', (e) => {
  if (e.target === pickerOverlayEl) closePicker();
});

// ---- 節點問題（子節點懸停 ? 按鈕） ----
function openQuestionModal(node) {
  showModal(
    '設定節點想解析的問題',
    `<input id="modal-question-input" type="text" placeholder="輸入想解析的問題（可留空）" />
     <div class="modal-actions">
       <button id="modal-question-ok">確定</button>
       <button id="modal-question-clear">清除</button>
     </div>`,
    (box) => {
      const input = box.querySelector('#modal-question-input');
      input.value = node.question || '';
      input.focus();
      box.querySelector('#modal-question-ok').addEventListener('click', () => {
        node.question = input.value.trim();
        closeModal();
        renderTree();
        saveSpread();
        showStatus(node.question ? `已設定問題：${node.question}` : '已清除該節點問題');
      });
      box.querySelector('#modal-question-clear').addEventListener('click', () => {
        node.question = '';
        closeModal();
        renderTree();
        saveSpread();
        showStatus('已清除該節點問題');
      });
    }
  );
}

// ---- 解牌 ----
const TOKEN_KEY = 'api.token';
const BASE_URL_KEY = 'api.baseUrl';
const MODEL_KEY = 'api.model';

// 祈求對象尊名以及語句：值與鎖定狀態都會保存
const DEITY_KEY = 'divination.deityName';
const DEITY_LOCK_KEY = 'divination.deityLocked';

function applyDeityLock() {
  const locked = localStorage.getItem(DEITY_LOCK_KEY) === '1';
  deityInput.readOnly = locked;
  deityInput.classList.toggle('locked', locked);
  btnDeityLock.textContent = locked ? '解鎖' : '鎖定';
  btnDeityLock.classList.toggle('active', locked);
}

deityInput.value = localStorage.getItem(DEITY_KEY) || '';
deityInput.addEventListener('input', () => {
  localStorage.setItem(DEITY_KEY, deityInput.value);
});
btnDeityLock.addEventListener('click', () => {
  localStorage.setItem(DEITY_LOCK_KEY, deityInput.readOnly ? '0' : '1');
  applyDeityLock();
  showStatus(deityInput.readOnly ? '已鎖定祈求對象尊名以及語句' : '已解鎖祈求對象尊名以及語句');
});
applyDeityLock();

const TAROT_SYSTEM_PROMPT =
  '你是一位專業的塔羅牌解讀師。你熟悉大阿卡那與小阿卡那的象徵意義、' +
  '以及正位與逆位（- 為逆位，+ 為正位）的差異。你的解牌風格沉穩、具體、務實，使用繁體中文。' +
  '請依照使用者的要求以固定的 JSON 結構輸出，不要輸出 JSON 以外的文字。';

// 初始解牌：只提交第一層深度的卡牌，要求 AI 以 JSON 回覆以利逐張拆分
function buildInterpretPrompt(firstLayer, question, deityName) {
  const list = firstLayer.map((n, i) => `${i + 1}. ${n.label}`).join('\n');
  return (
    `請針對以下第一層抽出的塔羅牌進行解牌。\n\n` +
    `第一層卡牌：\n${list}\n\n` +
    (deityName ? `祈求對象尊名以及語句：${deityName}\n\n` : '') +
    (question ? `占卜問題：${question}\n\n` : '') +
    `編號格式說明：數字為牌面編號，牌名後方的 + 代表正位、- 代表逆位。\n` +
    `（小阿卡那的權杖/聖杯/寶劍/錢幣四種花色，對應火/水/風/土四元素。）\n\n` +
    `請嚴格依照下列 JSON 格式回覆（不要使用 Markdown 程式碼區塊包圍，不要輸出其他文字）：\n` +
    `{\n` +
    `  "逐張解釋": {\n` +
    `    "卡牌名稱（與上方第一層卡牌清單完全一致）": "該張牌的解釋…",\n` +
    `    "另一張牌名": "該張牌的解釋…"\n` +
    `  },\n` +
    `  "整體脈絡": "牌面之間的關聯與整體想傳達的訊息",\n` +
    `  "行動建議": "簡潔、務實、可執行的建議"\n` +
    `}\n\n` +
    `「逐張解釋」中的每個鍵都必須是清單中的卡牌名稱（含正/逆標記，例如「愚者（正）」），且每張牌都要有一個鍵。`
  );
}

// 深度解牌：僅針對一棵牌樹，需已有初始解牌結果
function buildDeepPrompt(tree, initialResult, deepResult, deityName, question) {
  const lines = tree
    .map((n) => `${'　'.repeat(n.depth)}${n.label}${n.question ? `　【問題：${n.question}】` : ''}`)
    .join('\n');
  return (
    `請對以下單棵塔羅牌樹進行深度解牌。\n\n` +
    `牌樹結構（縮排代表深度，【問題：…】為該節點綁定想解析的問題）：\n${lines}\n\n` +
    (deityName ? `祈求對象尊名以及語句：${deityName}\n\n` : '') +
    (question ? `占卜問題：${question}\n\n` : '') +
    (initialResult ? `既有的初始解牌結果（第一層）：\n${initialResult}\n\n` : '') +
    (deepResult ? `既有的深度解牌結果（供參考，可在此基礎上進一步深入）：\n${deepResult}\n\n` : '') +
    `請針對整棵牌樹的關聯與各節點綁定的問題進行深入解析，並依照下列 JSON 格式回覆（不要使用 Markdown 程式碼區塊，不要輸出其他文字）：\n` +
    `{\n` +
    `  "逐點解牌": {\n` +
    `    "卡牌名稱（含正/逆，需與上方牌樹一致）": "該節點的深度解釋…",\n` +
    `    "另一張牌名": "…"\n` +
    `  },\n` +
    `  "整體深度解牌": "整棵樹整體的深入解析",\n` +
    `  "行動建議": "簡潔、務實、可執行的建議"\n` +
    `}`
  );
}

// 解析 AI 回傳的 JSON（容忍 Markdown 區塊或前後雜訊）
function parseInterpretJson(raw) {
  if (!raw) return null;
  const text = raw.trim();
  let json = text;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) json = fence[1].trim();
  const tryParse = (s) => {
    try { return JSON.parse(s); } catch (e) { return null; }
  };
  const obj = tryParse(json);
  if (obj) return obj;
  const start = json.indexOf('{');
  const end = json.lastIndexOf('}');
  if (start !== -1 && end > start) {
    const sliced = tryParse(json.slice(start, end + 1));
    if (sliced) return sliced;
  }
  return null;
}

function lookupPerCard(map, node) {
  if (!map) return '';
  if (typeof map[node.label] === 'string') return map[node.label];
  const clean = node.name;
  const key = Object.keys(map).find((k) => {
    const k2 = k.replace(/[（(].*?[）)]/g, '').trim();
    return k2 === clean || k.includes(clean);
  });
  return key ? map[key] : '';
}

function buildByCardText(firstLayer) {
  const parts = firstLayer.map((n) => `${n.label}：${n.interp || '（尚未解牌）'}`);
  return parts.join('\n\n');
}

async function interpret() {
  const firstLayer = roots();
  if (firstLayer.length === 0) {
    showStatus('尚未抽牌，請先抽第一層的牌', true);
    return;
  }
  const url = (localStorage.getItem(BASE_URL_KEY) || '').replace(/\/+$/, '');
  const key = localStorage.getItem(TOKEN_KEY) || '';
  const model = localStorage.getItem(MODEL_KEY) || '';
  if (!url || !key || !model) {
    showStatus('請先在設置中完成 API 設定與選擇模型', true);
    return;
  }
  const cards = firstLayer.map((n) => n.token).join(', ');
  const question = questionInput.value.trim();
  const deityName = deityInput.value.trim();
  const messages = [
    { role: 'system', content: TAROT_SYSTEM_PROMPT },
    { role: 'user', content: buildInterpretPrompt(firstLayer, question, deityName) }
  ];
  btnInterpret.disabled = true;
  resultEl.hidden = false;
  resultEl.textContent = '解牌中，請稍候...';
  try {
    const res = await fetch(`${url}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({ model, messages })
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    const content = data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : '';
    if (!content) {
      throw new Error('回應中沒有解牌內容');
    }
    const parsed = parseInterpretJson(content);
    const perCardMap = parsed && parsed['逐張解釋'] ? parsed['逐張解釋'] : null;

    lastInterpretRaw = content;
    lastInterpretJson = parsed;
    lastInterpretedAt = new Date().toISOString();

    // 初始解牌後清空先前的深度解牌
    lastDeepRaw = '';
    lastDeepJson = null;
    lastDeepAt = null;
    for (const n of nodes) n.deepInterp = '';

    for (const n of firstLayer) {
      n.interp = perCardMap ? lookupPerCard(perCardMap, n) : '';
    }
    renderTree();

    lastByCardText = buildByCardText(firstLayer);
    cardExplanationsEl.textContent = lastByCardText;
    resultEl.textContent = content;
    showStatus(perCardMap ? '解牌完成' : '解牌完成（未依 JSON 格式回覆，無法拆分）');
    saveSpread();

    try {
      await window.api.interpretLogAdd({ roundId, cards, input: messages, output: content });
    } catch (e) {
      // 忽略日誌寫入失敗
    }
  } catch (e) {
    resultEl.textContent = `解牌失敗：${e.message}`;
    showStatus('解牌失敗', true);
  } finally {
    btnInterpret.disabled = false;
  }
}

function toggleByCard() {
  if (!lastByCardText) {
    showStatus('尚未解牌，請先抽牌並解牌', true);
    return;
  }
  const open = cardExplanationsEl.hidden;
  cardExplanationsEl.hidden = !open;
  cardExplanationsEl.textContent = lastByCardText;
  btnByCard.classList.toggle('active', open);
}

function onSave() {
  const payload = saveSpread();
  const n = nodes.length;
  showStatus(`已保存（${n} 張牌${payload.interpretation ? '，含解牌結果' : ''}${payload.deepInterpretationRaw ? '，含深度解牌' : ''}${payload.summary ? '，含總結' : ''}）`);
}

// ---- 結果檢視（彈窗顯示各類解牌結果） ----
function openResultModal(title, text) {
  if (!text) {
    showStatus(`${title}：尚無結果`, true);
    return;
  }
  showModal(title, `<pre class="result-view">${escapeHtml(text)}</pre>`);
}

btnViewInit.addEventListener('click', () => openResultModal('解牌結果', lastInterpretRaw));
btnViewDeep.addEventListener('click', () => openResultModal('深度解牌', lastDeepRaw));
btnViewSummary.addEventListener('click', () => openResultModal('總結', lastSummaryRaw));

// ---- 結束占卜 ----
function buildSummaryPrompt(treeText, deityName, question, closing, initialResult, deepResult) {
  return (
    `請為本次塔羅占卜做最終總結。\n\n` +
    `完整牌陣（縮排代表深度，【問題：…】為該節點綁定的問題，並附上各牌已取得的解析）：\n${treeText}\n\n` +
    (deityName ? `祈求對象尊名以及語句：${deityName}\n\n` : '') +
    (question ? `占卜問題：${question}\n\n` : '') +
    (closing ? `結束語句：${closing}\n\n` : '') +
    (initialResult ? `初始解牌結果：\n${initialResult}\n\n` : '') +
    (deepResult ? `深度解牌結果：\n${deepResult}\n\n` : '') +
    `請綜合以上所有資訊（所有牌面、前後關係、所有已取得的解析、占卜問題與結束語句），給出一份完整且條理分明的最終總結，包含：\n` +
    `1. 整體結論\n` +
    `2. 占卜過程的發展脈絡（第一層 → 深入層）\n` +
    `3. 最後的行動指引\n` +
    `使用繁體中文。`
  );
}

async function generateSummary(closing) {
  const url = (localStorage.getItem(BASE_URL_KEY) || '').replace(/\/+$/, '');
  const key = localStorage.getItem(TOKEN_KEY) || '';
  const model = localStorage.getItem(MODEL_KEY) || '';
  if (!url || !key || !model) {
    throw new Error('請先在設置中完成 API 設定與選擇模型');
  }
  const deityName = deityInput.value.trim();
  const question = questionInput.value.trim();
  const treeText = nodes
    .map((n) =>
      `${'　'.repeat(n.depth)}${n.label}` +
      (n.question ? `　【問題：${n.question}】` : '') +
      (n.interp ? `　（${n.interp}）` : '') +
      (n.deepInterp ? `　〔深度：${n.deepInterp}〕` : '')
    )
    .join('\n');
  const messages = [
    { role: 'system', content: TAROT_SYSTEM_PROMPT },
    { role: 'user', content: buildSummaryPrompt(treeText, deityName, question, closing, lastInterpretRaw, lastDeepRaw) }
  ];
  const res = await fetch(`${url}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify({ model, messages })
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  const content = data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : '';
  if (!content) {
    throw new Error('回應中沒有總結內容');
  }
  try {
    await window.api.interpretLogAdd({
      roundId,
      cards: nodes.map((n) => n.token).join(', '),
      input: messages,
      output: content
    });
  } catch (e) {
    // 忽略日誌寫入失敗
  }
  return content;
}

function completeRound(closing, summary) {
  roundCompleted = true;
  lastCompletedAt = new Date().toISOString();
  lastClosing = closing || '';
  lastSummaryRaw = summary || '';
  summaryResultEl.textContent = summary;
  summaryResultEl.hidden = !summary;
  applyCompletedState();
  renderTree();
  hideCardTip();
  const payload = saveSpread();
  closeModal();
  showStatus(`占卜已結束${payload.summary ? '（含總結）' : ''}`);
}

function openEndModal() {
  if (roundCompleted) {
    showStatus('本次占卜已完成', true);
    return;
  }
  if (nodes.length === 0) {
    showStatus('尚未抽牌，無法結束占卜', true);
    return;
  }
  showModal(
    '結束占卜',
    `<div class="end-message">是否確定結束占卜？</div>
     <label class="end-check">
       <input type="checkbox" id="end-summary" />
       <span>生成總結</span>
     </label>
     <input id="end-closing" type="text" placeholder="結束語句（可選）" />
     <div class="modal-actions">
       <button id="end-confirm">結束</button>
       <button id="end-back">返回</button>
     </div>`,
    (box) => {
      const confirmBtn = box.querySelector('#end-confirm');
      box.querySelector('#end-back').addEventListener('click', closeModal);
      confirmBtn.addEventListener('click', async () => {
        const wantSummary = box.querySelector('#end-summary').checked;
        const closing = box.querySelector('#end-closing').value.trim();
        confirmBtn.disabled = true;
        if (!wantSummary) {
          completeRound(closing, '');
          return;
        }
        confirmBtn.textContent = '總結生成中...';
        try {
          const summary = await generateSummary(closing);
          completeRound(closing, summary);
        } catch (e) {
          confirmBtn.textContent = '結束';
          confirmBtn.disabled = false;
          showStatus('總結生成失敗：' + e.message, true);
        }
      });
    }
  );
}

// ---- 深度解牌 ----
function gatherTree(rootId) {
  const result = [];
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop();
    const n = nodeById.get(cur);
    if (!n) continue;
    result.push(n);
    const ch = childrenOf(cur);
    for (let i = ch.length - 1; i >= 0; i--) stack.push(ch[i].id);
  }
  return result;
}

function startDeepInterpret() {
  if (roots().length === 0) {
    showStatus('尚未抽牌，請先抽牌', true);
    return;
  }
  if (!lastInterpretRaw) {
    showStatus('請先進行初始解牌（解牌）才能深度解牌', true);
    return;
  }
  if (roots().length === 1) {
    deepInterpret(roots()[0].id);
    return;
  }
  const opts = roots().map((r) => {
    const size = gatherTree(r.id).length;
    return `<option value="${r.id}">${escapeHtml(r.label)}（${size} 張）</option>`;
  }).join('');
  showModal(
    '選擇深度解牌的牌樹',
    `<select id="modal-deep-select">${opts}</select>
     <div class="modal-actions"><button id="modal-deep-ok">開始深度解牌</button></div>`,
    (box) => {
      box.querySelector('#modal-deep-ok').addEventListener('click', () => {
        const id = Number(box.querySelector('#modal-deep-select').value);
        closeModal();
        deepInterpret(id);
      });
    }
  );
}

async function deepInterpret(rootId) {
  const tree = gatherTree(rootId);
  if (tree.length === 0) return;
  const url = (localStorage.getItem(BASE_URL_KEY) || '').replace(/\/+$/, '');
  const key = localStorage.getItem(TOKEN_KEY) || '';
  const model = localStorage.getItem(MODEL_KEY) || '';
  if (!url || !key || !model) {
    showStatus('請先在設置中完成 API 設定與選擇模型', true);
    return;
  }
  const deityName = deityInput.value.trim();
  const question = questionInput.value.trim();
  const messages = [
    { role: 'system', content: TAROT_SYSTEM_PROMPT },
    { role: 'user', content: buildDeepPrompt(tree, lastInterpretRaw, lastDeepRaw, deityName, question) }
  ];
  btnDeep.disabled = true;
  deepResultEl.hidden = false;
  deepResultEl.textContent = '深度解牌中，請稍候...';
  try {
    const res = await fetch(`${url}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({ model, messages })
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    const content = data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : '';
    if (!content) {
      throw new Error('回應中沒有解牌內容');
    }
    const parsed = parseInterpretJson(content);
    const deepMap = parsed && parsed['逐點解牌'] ? parsed['逐點解牌'] : null;
    lastDeepRaw = content;
    lastDeepJson = parsed;
    lastDeepAt = new Date().toISOString();
    for (const n of tree) n.deepInterp = deepMap ? lookupPerCard(deepMap, n) : '';
    renderTree();
    deepResultEl.textContent = content;
    showStatus(deepMap ? '深度解牌完成' : '深度解牌完成（未依 JSON 格式回覆）');
    saveSpread();
    try {
      await window.api.interpretLogAdd({
        roundId,
        cards: tree.map((n) => n.token).join(', '),
        input: messages,
        output: content
      });
    } catch (e) {
      // 忽略日誌寫入失敗
    }
  } catch (e) {
    deepResultEl.textContent = `深度解牌失敗：${e.message}`;
    showStatus('深度解牌失敗', true);
  } finally {
    btnDeep.disabled = false;
  }
}

// ---- 載入歷史 ----
async function openLoadModal() {
  let history = [];
  try {
    history = await window.api.historyGetAll();
  } catch (e) {
    showStatus('讀取歷史失敗：' + e.message, true);
    return;
  }
  if (history.length === 0) {
    showStatus('尚無歷史記錄', true);
    return;
  }
  const reversed = [...history].reverse();
  const rows = reversed.map((r) =>
    `<button class="load-item">` +
    `<span class="load-time">${fmtTime(r.timestamp)}</span>` +
    `<span class="load-cards">${escapeHtml(r.cards || '（無牌面）')}</span>` +
    (r.interpretation ? '<span class="load-badge">已解</span>' : '') +
    (r.deepInterpretationRaw ? '<span class="load-badge">深解</span>' : '') +
    `</button>`
  ).join('');
  showModal('載入歷史記錄', `<div class="load-list">${rows}</div>`, (box) => {
    const items = box.querySelectorAll('.load-item');
    items.forEach((item, idx) => {
      item.addEventListener('click', () => {
        loadRecord(reversed[idx]);
        closeModal();
      });
    });
  });
}

function loadRecord(record) {
  roundId = record.roundId || String(Date.now());
  nextNodeId = 1;
  nodes.length = 0;
  nodeById.clear();
  drawnIdx.clear();
  dragState = null;

  if (record.spread && Array.isArray(record.spread.nodes) && record.spread.nodes.length > 0) {
    for (const sn of record.spread.nodes) {
      const p = parseToken(sn.token);
      const node = {
        id: nextNodeId++,
        idx: sn.idx !== undefined ? sn.idx : (p ? p.idx : -1),
        token: sn.token,
        label: sn.label || (p ? cardLabel(sn.token) : sn.token),
        depth: sn.depth || 0,
        parentId: sn.parentId || null,
        x: sn.x || 0,
        y: sn.y || 0,
        interp: sn.interp || '',
        question: sn.question || '',
        deepInterp: sn.deepInterp || ''
      };
      nodes.push(node);
      nodeById.set(node.id, node);
      if (p) drawnIdx.add(p.idx);
    }
  } else {
    const tokens = (record.cards || '').split(', ').filter(Boolean);
    for (const t of tokens) {
      const p = parseToken(t);
      if (!p) continue;
      drawnIdx.add(p.idx);
      const node = {
        id: nextNodeId++,
        idx: p.idx,
        token: t,
        label: cardLabel(t),
        depth: 0,
        parentId: null,
        x: 0,
        y: 0,
        interp: '',
        question: '',
        deepInterp: ''
      };
      nodes.push(node);
      nodeById.set(node.id, node);
    }
  }

  lastInterpretRaw = record.interpretation || '';
  lastInterpretJson = record.interpretationJson || null;
  lastInterpretedAt = record.interpretedAt || null;
  lastDeepRaw = record.deepInterpretationRaw || '';
  lastDeepJson = record.deepInterpretationJson || null;
  lastDeepAt = record.deepInterpretedAt || null;
  roundCompleted = !!record.completed;
  lastCompletedAt = record.completedAt || null;
  lastClosing = record.closing || '';
  lastSummaryRaw = record.summary || '';
  lastByCardText = buildByCardText(roots());
  cardExplanationsEl.textContent = lastByCardText;
  resultEl.textContent = lastInterpretRaw;
  resultEl.hidden = !lastInterpretRaw;
  deepResultEl.textContent = lastDeepRaw;
  deepResultEl.hidden = !lastDeepRaw;
  summaryResultEl.textContent = lastSummaryRaw;
  summaryResultEl.hidden = !lastSummaryRaw;

  layoutTree();
  renderTree();
  canvasEl.scrollLeft = 0;
  canvasEl.scrollTop = 0;
  showStatus(`已載入歷史記錄（${nodes.length} 張牌）`);
  applyCompletedState();
}

// ---- 事件綁定 ----
btnInterpret.addEventListener('click', interpret);
btnByCard.addEventListener('click', toggleByCard);
btnSave.addEventListener('click', onSave);
btnDeep.addEventListener('click', startDeepInterpret);
btnLoad.addEventListener('click', openLoadModal);
btnEnd.addEventListener('click', openEndModal);
questionInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') interpret();
});

document.getElementById('modal-close').addEventListener('click', closeModal);
modalOverlayEl.addEventListener('click', (e) => {
  if (e.target === modalOverlayEl) closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!pickerOverlayEl.hidden) closePicker();
  if (!modalOverlayEl.hidden) closeModal();
});

// ---- 佈局 ----
// 窗口可調整大小；較窄時套用緊湊佈局
function updateCompact() {
  document.body.classList.toggle('compact', window.innerWidth < 440);
}

function init() {
  updateCompact();
  window.addEventListener('resize', () => {
    updateCompact();
    renderTree();
  });
  btnQuit.addEventListener('click', () => {
    window.close();
  });
  startNewRound(false);
}

init();