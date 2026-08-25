'use strict';

const statusEl = document.getElementById('status');
const btnOmen = document.getElementById('btn-omen');
const btnShuffle = document.getElementById('btn-shuffle');
const btnQuit = document.getElementById('btn-quit');
const btnByCard = document.getElementById('btn-by-card');
const questionInput = document.getElementById('question-input');
const btnInterpret = document.getElementById('btn-interpret');
const resultEl = document.getElementById('interpret-result');
const cardExplanationsEl = document.getElementById('card-explanations');
const canvasEl = document.getElementById('tree-canvas');
const contentEl = document.getElementById('tree-content');
const linesSvg = document.getElementById('tree-lines');

let lastByCardText = '';
let roundId = '';

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

function depthColor(depth) {
  return DEPTH_COLORS[depth % DEPTH_COLORS.length];
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
  return { token, label: cardLabel(token) };
}

// 樹狀自動佈局：根節點橫向（廣度），子節點縱向（深度）
function layoutTree() {
  const roots = nodes.filter((n) => n.parentId === null);

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
  for (const root of roots) {
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

      el.appendChild(name);
      el.appendChild(add);
      el.addEventListener('mousedown', (e) => startDrag(n, e));
      contentEl.appendChild(el);
    }
    el.style.left = n.x + 'px';
    el.style.top = n.y + 'px';
    const color = depthColor(n.depth);
    el.style.setProperty('--dc', color.border);
    el.style.borderColor = color.border;
    el.querySelector('.card-name').textContent = n.label;
    el.querySelector('.card-name').style.color = color.text;
  }

  existing.forEach((el, id) => {
    if (!seen.has(id)) el.remove();
  });
}

// ---- 拖拽 ----
let dragState = null;

function startDrag(node, e) {
  if (e.button !== 0) return;
  e.preventDefault();
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

// ---- 抽牌節點 ----
function syncHistory() {
  const cards = nodes.map((n) => n.token).join(', ');
  try {
    if (nodes.length === 1) {
      window.api.historyAdd({ roundId, cards });
    } else {
      window.api.historyUpdateCards({ roundId, cards });
    }
  } catch (e) {
    // 歷史記錄寫入失敗不影響抽牌
  }
}

function addNode(parentId) {
  const card = pickCard();
  if (!card) {
    showStatus('整副牌已抽完，請重新洗牌', true);
    return;
  }
  const parent = parentId ? nodeById.get(parentId) : null;
  const node = {
    id: nextNodeId++,
    token: card.token,
    label: card.label,
    depth: parent ? parent.depth + 1 : 0,
    parentId: parentId || null,
    x: 0,
    y: 0
  };
  nodes.push(node);
  nodeById.set(node.id, node);
  layoutTree();
  renderTree();
  revealNode(node);
  clearInterpretState();
  showStatus(`已抽出：${card.label}`);
  syncHistory();
  questionInput.focus();
}

function startNewRound(notify) {
  roundId = String(Date.now());
  nextNodeId = 1;
  nodes.length = 0;
  nodeById.clear();
  drawnIdx.clear();
  dragState = null;
  contentEl.querySelectorAll('.tree-card').forEach((el) => el.remove());
  renderTree();
  clearInterpretState();
  showStatus(notify ? '已開始新輪次，請抽牌' : '');
  questionInput.focus();
}

function clearInterpretState() {
  lastByCardText = '';
  cardExplanationsEl.hidden = true;
  cardExplanationsEl.textContent = '';
  btnByCard.classList.remove('active');
  resultEl.hidden = true;
  resultEl.textContent = '';
}

btnOmen.addEventListener('click', () => addNode(null));
btnShuffle.addEventListener('click', () => startNewRound(true));

// ---- 解牌 ----
const TOKEN_KEY = 'api.token';
const BASE_URL_KEY = 'api.baseUrl';
const MODEL_KEY = 'api.model';

const TAROT_SYSTEM_PROMPT =
  '你是一位專業的塔羅牌解讀師。你熟悉大阿卡那與小阿卡那的象徵意義、' +
  '以及正位與逆位（- 為逆位，+ 為正位）的差異。你的解牌風格沉穩、具體、務實，使用繁體中文。';

function buildInterpretPrompt(cards, question) {
  return (
    `請針對本次抽出的塔羅牌進行解牌。\n\n` +
    `本次抽牌結果：${cards}\n\n` +
    (question ? `占卜問題：${question}\n\n` : '') +
    `編號格式說明：數字為牌面編號，牌名後方的 + 代表正位、- 代表逆位。\n` +
    `（小阿卡那的權杖/聖杯/寶劍/錢幣四種花色，對應火/水/風/土四元素。）\n\n` +
    `請依以下結構回覆：\n` +
    `1. 逐張解釋：每張牌的象徵意義，以及當前正/逆位帶來的影響\n` +
    `2. 整體脈絡：牌面之間的關聯與整體想傳達的訊息\n` +
    `3. 行動建議：簡潔、務實、可執行的建議`
  );
}

// 從解牌全文摘取「逐張解釋」段落（截至下一個段落標題）
function extractByCard(text) {
  if (!text) return '';
  const start = text.indexOf('逐張解釋');
  if (start === -1) return '';
  let end = text.length;
  const markers = ['三張組合', '整體脈絡', '行動建議', '綜合建議'];
  for (const m of markers) {
    const idx = text.indexOf(m, start + 1);
    if (idx !== -1 && idx < end) end = idx;
  }
  return text.substring(start, end).trim();
}

async function interpret() {
  if (nodes.length === 0) {
    showStatus('尚未抽牌，請先抽牌', true);
    return;
  }
  const url = (localStorage.getItem(BASE_URL_KEY) || '').replace(/\/+$/, '');
  const key = localStorage.getItem(TOKEN_KEY) || '';
  const model = localStorage.getItem(MODEL_KEY) || '';
  if (!url || !key || !model) {
    showStatus('請先在設置中完成 API 設定與選擇模型', true);
    return;
  }
  const cards = nodes.map((n) => n.token).join(', ');
  const question = questionInput.value.trim();
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
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: TAROT_SYSTEM_PROMPT },
          { role: 'user', content: buildInterpretPrompt(cards, question) }
        ]
      })
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
    resultEl.textContent = content;
    lastByCardText = extractByCard(content);
    cardExplanationsEl.textContent = lastByCardText;
    showStatus(lastByCardText ? '解牌完成' : '解牌完成（未偵測到逐張解釋段落）');
    try {
      await window.api.historyUpdateInterpretation({ roundId, interpretation: content });
    } catch (e) {
      // 忽略歷史寫入失敗
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

btnInterpret.addEventListener('click', interpret);
btnByCard.addEventListener('click', toggleByCard);
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