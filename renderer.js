'use strict';

const statusEl = document.getElementById('status');
const btnOmen = document.getElementById('btn-omen');
const btnQuit = document.getElementById('btn-quit');
const questionInput = document.getElementById('question-input');
const btnInterpret = document.getElementById('btn-interpret');
const resultEl = document.getElementById('interpret-result');

function showStatus(msg, isError) {
  statusEl.textContent = msg || '';
  statusEl.classList.toggle('error', !!isError);
  if (msg && typeof showToast === 'function') {
    showToast(msg);
  }
}

// ---- 塔羅運勢 ----
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

const OMEN_KEY = 'tarot.lastDraw';

// 每日重置基準：凌晨 4:00。日期鍵為「目前時間 - 4 小時」的日期字串
function omenDayKey() {
  const d = new Date();
  d.setHours(d.getHours() - 4);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function drawOmen() {
  const deck = [...FULL_DECK];
  // Fisher-Yates 洗牌後取前 3 張，避免重複
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck.slice(0, 3).map(({ idx, card }) => {
    const upright = Math.random() < 0.5;
    return `${idx}-${card}${upright ? '+' : '-'}`;
  });
}

function showOmen() {
  const unlimited = localStorage.getItem('omen.unlimited') === '1';
  const today = omenDayKey();
  statusEl.classList.add('omen');
  if (!unlimited && localStorage.getItem(OMEN_KEY) === today) {
    const drawn = localStorage.getItem('tarot.lastCards');
    showStatus(drawn ? `今日已抽過：${drawn}` : '今日已抽過，凌晨 4:00 後可再抽');
    return;
  }
  const cards = drawOmen();
  const joined = cards.join(', ');
  localStorage.setItem(OMEN_KEY, today);
  localStorage.setItem('tarot.lastCards', joined);
  resultEl.hidden = true;
  resultEl.textContent = '';
  showStatus(joined);
  questionInput.focus();
  try {
    window.api.historyAdd({ cards: joined });
  } catch (e) {
    // 歷史記錄寫入失敗不影響抽牌
  }
}

btnOmen.addEventListener('click', showOmen);

// 設定視窗按下「重置今日抽牌機會」時清空紀錄
window.api.onOmenReset(() => {
  localStorage.removeItem(OMEN_KEY);
  localStorage.removeItem('tarot.lastCards');
  resultEl.hidden = true;
  resultEl.textContent = '';
  statusEl.classList.add('omen');
  showStatus('今日抽牌機會已重置');
});

// ---- 解牌 ----
const TOKEN_KEY = 'api.token';
const BASE_URL_KEY = 'api.baseUrl';
const MODEL_KEY = 'api.model';

const TAROT_SYSTEM_PROMPT =
  '你是一位專業的塔羅牌解讀師。你熟悉大阿卡那與小阿卡那的象徵意義、' +
  '以及正位與逆位（- 為逆位，+ 為正位）的差異。你的解牌風格沉穩、具體、務實，使用繁體中文。';

function buildInterpretPrompt(cards, question) {
  return (
    `請針對以下三張塔羅牌進行解牌。\n\n` +
    `本次抽牌結果：${cards}\n\n` +
    (question ? `占卜問題：${question}\n\n` : '') +
    `編號格式說明：數字為牌面編號，牌名後方的 + 代表正位、- 代表逆位。\n` +
    `（小阿卡那的權杖/聖杯/寶劍/錢幣四種花色，對應火/水/風/土四元素。）\n\n` +
    `請依以下結構回覆：\n` +
    `1. 逐張解釋：每張牌的象徵意義，以及當前正/逆位帶來的影響\n` +
    `2. 三張組合的整體脈絡：牌面之間的關聯與整體想傳達的訊息\n` +
    `3. 行動建議：簡潔、務實、可執行的建議`
  );
}

async function interpret() {
  const cards = localStorage.getItem('tarot.lastCards');
  if (!cards) {
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
    showStatus('解牌完成');
    try {
      await window.api.historyUpdateInterpretation({ cards, interpretation: content });
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

btnInterpret.addEventListener('click', interpret);
questionInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') interpret();
});

// ---- 佈局 ----
// 依據窗口尺寸應用緊湊佈局
function applyPresetClass(name) {
  document.body.classList.toggle('compact', name === 'compact');
}

async function init() {
  // 依目前窗口尺寸設定佈局
  try {
    const { current } = await window.api.windowGetCurrentPreset();
    applyPresetClass(current);
  } catch (e) {
    // 忽略
  }
  window.api.onWindowPresetChanged(applyPresetClass);

  btnQuit.addEventListener('click', () => {
    window.close();
  });
}

init();