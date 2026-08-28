'use strict';

const statusEl = document.getElementById('status');
const btnOmen = document.getElementById('btn-omen');
const btnShuffle = document.getElementById('btn-shuffle');
const btnQuit = document.getElementById('btn-quit');
const btnByCard = document.getElementById('btn-by-card');
const btnSave = document.getElementById('btn-save');
const questionInput = document.getElementById('question-input');
const btnInterpret = document.getElementById('btn-interpret');
const resultEl = document.getElementById('interpret-result');
const cardExplanationsEl = document.getElementById('card-explanations');
const canvasEl = document.getElementById('tree-canvas');
const contentEl = document.getElementById('tree-content');
const linesSvg = document.getElementById('tree-lines');
const cardTipEl = document.getElementById('card-tip');

let lastByCardText = '';
let roundId = '';
let lastInterpretRaw = '';
let lastInterpretJson = null;
let lastInterpretedAt = null;

function showStatus(msg, isError) {
  statusEl.textContent = msg || '';
  statusEl.classList.toggle('error', !!isError);
  if (msg && typeof showToast === 'function') {
    showToast(msg);
  }
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
    el.classList.toggle('interpreted', !!n.interp);
  }

  existing.forEach((el, id) => {
    if (!seen.has(id)) el.remove();
  });
}

// ---- 卡牌解釋提示（懸停已解牌時顯示） ----
function showCardTip(node) {
  if (dragState || !node.interp) {
    hideCardTip();
    return;
  }
  const { w } = contentSize();
  cardTipEl.textContent = node.interp;
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
  if (e.button !== 0) return;
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

// ---- 保存 ----
function spreadSnapshot() {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      token: n.token,
      label: n.label,
      depth: n.depth,
      parentId: n.parentId,
      x: n.x,
      y: n.y
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
    interp: ''
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
  if (parentId === null && roots().length >= rootLimit()) {
    showStatus(`第一層最多 ${rootLimit()} 張，可在設置中調整`, true);
    return;
  }
  const card = pickCard();
  if (!card) {
    showStatus('整副牌已抽完，請重新洗牌', true);
    return;
  }
  clearInterpretState();
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
  if (roots().length >= rootLimit()) {
    showStatus(`第一層最多 ${rootLimit()} 張，可在設置中調整`, true);
    return;
  }
  if (drawnIdx.has(deckCard.idx)) return;
  drawnIdx.add(deckCard.idx);
  const token = `${deckCard.idx}-${deckCard.card}${upright ? '+' : '-'}`;
  clearInterpretState();
  insertNode({ token, label: cardLabel(token), idx: deckCard.idx }, null, '已加入');
}

// 刪除節點（含其所有子節點），並把該牌還回牌池
function removeNode(id) {
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
  clearInterpretState();
  layoutTree();
  renderTree();
  saveSpread();
  showStatus(toRemove.length > 1 ? `已刪除 ${toRemove.length} 張牌` : '已刪除該牌');
}

document.getElementById('btn-pick').addEventListener('click', openPicker);
document.getElementById('picker-close').addEventListener('click', closePicker);
pickerOverlayEl.addEventListener('click', (e) => {
  if (e.target === pickerOverlayEl) closePicker();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !pickerOverlayEl.hidden) closePicker();
});

function startNewRound(notify) {
  roundId = String(Date.now());
  nextNodeId = 1;
  nodes.length = 0;
  nodeById.clear();
  drawnIdx.clear();
  dragState = null;
  lastInterpretRaw = '';
  lastInterpretJson = null;
  lastInterpretedAt = null;
  lastByCardText = '';
  contentEl.querySelectorAll('.tree-card').forEach((el) => el.remove());
  renderTree();
  clearInterpretState();
  showStatus(notify ? '已開始新輪次，請抽牌' : '');
  questionInput.focus();
}

function clearInterpretState() {
  for (const n of nodes) n.interp = '';
  lastByCardText = '';
  lastInterpretRaw = '';
  lastInterpretJson = null;
  lastInterpretedAt = null;
  cardExplanationsEl.hidden = true;
  cardExplanationsEl.textContent = '';
  btnByCard.classList.remove('active');
  resultEl.hidden = true;
  resultEl.textContent = '';
  hideCardTip();
}

btnOmen.addEventListener('click', () => addNode(null));
btnShuffle.addEventListener('click', () => startNewRound(true));

// ---- 解牌 ----
const TOKEN_KEY = 'api.token';
const BASE_URL_KEY = 'api.baseUrl';
const MODEL_KEY = 'api.model';

const TAROT_SYSTEM_PROMPT =
  '你是一位專業的塔羅牌解讀師。你熟悉大阿卡那與小阿卡那的象徵意義、' +
  '以及正位與逆位（- 為逆位，+ 為正位）的差異。你的解牌風格沉穩、具體、務實，使用繁體中文。' +
  '請依照使用者的要求以固定的 JSON 結構輸出，不要輸出 JSON 以外的文字。';

// 只提交第一層深度的卡牌，並要求 AI 以 JSON 回覆以利逐張拆分
function buildInterpretPrompt(firstLayer, question) {
  const list = firstLayer.map((n, i) => `${i + 1}. ${n.label}`).join('\n');
  return (
    `請針對以下第一層抽出的塔羅牌進行解牌。\n\n` +
    `第一層卡牌：\n${list}\n\n` +
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
  const messages = [
    { role: 'system', content: TAROT_SYSTEM_PROMPT },
    { role: 'user', content: buildInterpretPrompt(firstLayer, question) }
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

    for (const n of firstLayer) {
      n.interp = perCardMap ? lookupPerCard(perCardMap, n) : '';
    }
    renderTree();

    lastByCardText = buildByCardText(firstLayer);
    cardExplanationsEl.textContent = lastByCardText;
    resultEl.textContent = content;
    showStatus(perCardMap ? '解牌完成' : '解牌完成（未依 JSON 格式回覆，無法拆分）');
    saveSpread();

    // 寫入解牌日誌
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
  showStatus(`已保存（${n} 張牌${payload.interpretation ? '，含解牌結果' : ''}）`);
}

btnInterpret.addEventListener('click', interpret);
btnByCard.addEventListener('click', toggleByCard);
btnSave.addEventListener('click', onSave);
questionInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') interpret();
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