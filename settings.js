'use strict';

const tokenInput = document.getElementById('api-token');
const baseUrlInput = document.getElementById('api-base-url');
const btnConnect = document.getElementById('btn-connect');
const modelField = document.getElementById('model-field');
const modelSelect = document.getElementById('model-select');
const btnReset = document.getElementById('btn-reset-omen');
const unlimitedSwitch = document.getElementById('unlimited-switch');
const btnInterpret = document.getElementById('btn-interpret');
const resultEl = document.getElementById('result');
const todayCardsEl = document.getElementById('today-cards');
const todayInterpretEl = document.getElementById('today-interpret');
const btnHistory = document.getElementById('btn-history');
const historyListEl = document.getElementById('history-list');
const winSizeSelect = document.getElementById('win-size-select');
const msg = document.getElementById('msg');

const TOKEN_KEY = 'api.token';
const BASE_URL_KEY = 'api.baseUrl';
const MODEL_KEY = 'api.model';
const UNLIMITED_KEY = 'omen.unlimited';

function showMsg(text, isError) {
  msg.textContent = text;
  msg.classList.toggle('error', !!isError);
  if (text && typeof showToast === 'function') {
    showToast(text);
  }
}

function baseUrl() {
  return baseUrlInput.value.trim().replace(/\/+$/, '');
}

function apiKey() {
  return tokenInput.value.trim();
}

// 載入已儲存設定
tokenInput.value = localStorage.getItem(TOKEN_KEY) || '';
baseUrlInput.value = localStorage.getItem(BASE_URL_KEY) || '';

tokenInput.addEventListener('input', () => {
  localStorage.setItem(TOKEN_KEY, tokenInput.value);
});

baseUrlInput.addEventListener('input', () => {
  localStorage.setItem(BASE_URL_KEY, baseUrlInput.value);
});

// 無限抽卡開關
unlimitedSwitch.checked = localStorage.getItem(UNLIMITED_KEY) === '1';
unlimitedSwitch.addEventListener('change', () => {
  localStorage.setItem(UNLIMITED_KEY, unlimitedSwitch.checked ? '1' : '0');
});

// 連接：取得可用模型清單
async function connect() {
  const url = baseUrl();
  const key = apiKey();
  if (!url || !key) {
    showMsg('請先填寫 API Token 與 BASE URL', true);
    return;
  }
  btnConnect.disabled = true;
  showMsg('連接中...');
  try {
    const res = await fetch(`${url}/models`, {
      headers: { Authorization: `Bearer ${key}` }
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    const ids = Array.isArray(data.data)
      ? data.data.map((m) => m.id).filter(Boolean)
      : [];
    if (ids.length === 0) {
      throw new Error('回應中沒有模型清單');
    }
    modelSelect.innerHTML = '';
    for (const id of ids) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = id;
      modelSelect.appendChild(opt);
    }
    const saved = localStorage.getItem(MODEL_KEY);
    if (saved && ids.includes(saved)) modelSelect.value = saved;
    localStorage.setItem(MODEL_KEY, modelSelect.value);
    modelField.style.display = '';
    showMsg(`連接成功，共 ${ids.length} 個模型`);
  } catch (e) {
    modelField.style.display = 'none';
    showMsg(`連接失敗：${e.message}`, true);
  } finally {
    btnConnect.disabled = false;
  }
}

modelSelect.addEventListener('change', () => {
  localStorage.setItem(MODEL_KEY, modelSelect.value);
});

btnConnect.addEventListener('click', connect);

// 解牌
const TAROT_SYSTEM_PROMPT =
  '你是一位專業的塔羅牌解讀師。你熟悉大阿卡那與小阿卡那的象徵意義、' +
  '以及正位與逆位（- 為逆位，+ 為正位）的差異。你的解牌風格沉穩、具體、務實，使用繁體中文。';

function buildInterpretPrompt(cards, question) {
  return (
    `請針對以下三張塔羅牌進行解牌。\n\n` +
    `本次抽牌結果：${cards}\n\n` +
    (question && question.trim() ? `占卜問題：${question.trim()}\n\n` : '') +
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
    showMsg('今天尚未抽牌，請先在主視窗抽牌', true);
    return;
  }
  const url = baseUrl();
  const key = apiKey();
  const model = modelSelect.value;
  if (!url || !key || !model) {
    showMsg('請先完成連接並選擇模型', true);
    return;
  }
  btnInterpret.disabled = true;
  resultEl.hidden = false;
  resultEl.textContent = '解牌中，請稍候...';
  showMsg('');
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
          { role: 'user', content: buildInterpretPrompt(cards) }
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
    // 寫入今日解讀與歷史記錄
    todayInterpretEl.textContent = content;
    try {
      await window.api.historyUpdateInterpretation({ cards, interpretation: content });
    } catch (e) {
      // 忽略歷史寫入失敗
    }
  } catch (e) {
    resultEl.textContent = `解牌失敗：${e.message}`;
  } finally {
    btnInterpret.disabled = false;
  }
}

btnInterpret.addEventListener('click', interpret);

function getDayKey() {
  const d = new Date();
  d.setHours(d.getHours() - 4);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function fmtTime(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 顯示今日抽牌與解讀（從歷史記錄抓）
async function loadToday() {
  try {
    const history = await window.api.historyGetAll();
    const today = getDayKey();
    const todayEntries = history.filter((r) => {
      const d = new Date(r.timestamp);
      d.setHours(d.getHours() - 4);
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` === today;
    });
    if (todayEntries.length > 0) {
      const last = todayEntries[todayEntries.length - 1];
      todayCardsEl.textContent = last.cards || '（無牌面記錄）';
      todayInterpretEl.textContent = last.interpretation || '尚無解讀';
    } else {
      todayCardsEl.textContent = '尚未抽牌';
      todayInterpretEl.textContent = '尚無解讀';
    }
  } catch (e) {
    todayCardsEl.textContent = '讀取失敗';
  }
}

// 顯示歷史記錄（可展開/折疊解牌）
async function showHistory() {
  const visible = historyListEl.hidden;
  if (!visible) {
    historyListEl.hidden = true;
    btnHistory.textContent = '顯示歷史記錄';
    return;
  }
  btnHistory.disabled = true;
  try {
    const history = await window.api.historyGetAll();
    if (history.length === 0) {
      historyListEl.innerHTML = '<div class="history-entry">尚無抽牌記錄</div>';
    } else {
      const reversed = [...history].reverse();
      historyListEl.innerHTML = reversed.map((r, i) => {
        const cards = r.cards
          ? `<div class="history-cards">${escapeHtml(r.cards)}</div>`
          : '<div class="history-cards">（無牌面記錄）</div>';
        const hasInterp = !!r.interpretation;
        const interpBody = hasInterp
          ? `<div class="history-interpretation">${escapeHtml(r.interpretation)}</div>`
          : '<div class="history-interpretation" style="color:#9aa0b4;">（尚未解讀）</div>';
        const chevron = hasInterp ? '▸' : '';
        return (
          `<div class="history-entry" data-idx="${i}">` +
          `<div class="history-time">${fmtTime(r.timestamp)}</div>` +
          `<div class="history-head" ${hasInterp ? 'role="button" tabindex="0"' : ''}>` +
          `<span class="history-chevron">${chevron}</span>${cards}</div>` +
          `<div class="history-interp-wrap" hidden>${interpBody}</div>` +
          `</div>`
        );
      }).join('');
    }
    historyListEl.hidden = false;
    btnHistory.textContent = '隱藏歷史記錄';

    // 點擊牌面標題展開/折疊解牌
    historyListEl.querySelectorAll('.history-entry').forEach((entry) => {
      const head = entry.querySelector('.history-head');
      if (!head) return;
      const wrap = entry.querySelector('.history-interp-wrap');
      const chevron = entry.querySelector('.history-chevron');
      head.addEventListener('click', () => {
        const isOpen = !wrap.hidden;
        wrap.hidden = isOpen;
        chevron.textContent = isOpen ? '' : '▾';
      });
      head.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          head.click();
        }
      });
    });
  } catch (e) {
    showMsg('讀取歷史失敗：' + e.message, true);
  } finally {
    btnHistory.disabled = false;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

btnHistory.addEventListener('click', showHistory);

// 主視窗尺寸
async function loadWindowSize() {
  try {
    const { presets, current } = await window.api.windowGetPresets();
    winSizeSelect.innerHTML = '';
    for (const [name, p] of Object.entries(presets)) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = `${p.label} (${p.width}×${p.height})`;
      winSizeSelect.appendChild(opt);
    }
    winSizeSelect.value = current;
  } catch (e) {
    showMsg('讀取窗口尺寸失敗：' + e.message, true);
  }
}

winSizeSelect.addEventListener('change', async () => {
  try {
    const ok = await window.api.windowSetPreset(winSizeSelect.value);
    showMsg(ok ? '主視窗尺寸已更新' : '套用失敗', !ok);
  } catch (e) {
    showMsg('套用尺寸失敗：' + e.message, true);
  }
});

// 重置抽牌
btnReset.addEventListener('click', () => {
  try {
    window.api.resetOmen();
    localStorage.removeItem('tarot.lastCards');
    todayCardsEl.textContent = '尚未抽牌';
    todayInterpretEl.textContent = '尚無解讀';
    showMsg('今日抽牌機會已重置，可在主視窗重新抽牌');
  } catch (e) {
    showMsg('重置失敗：' + e.message, true);
  }
});

loadToday();
loadWindowSize();
