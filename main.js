const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

let win = null;
let tray = null;
let settingsWin = null;
let toastWin = null;
let toastTimer = null;

const HISTORY_FILE = path.join(app.getPath('userData'), 'tarot-history.json');
const INTERPRET_LOG_FILE = path.join(app.getPath('userData'), 'interpret-log.json');
const CONFIG_FILE = path.join(app.getPath('userData'), 'window-config.json');

const WINDOW_PRESETS = {
  standard: { width: 760, height: 540, label: '標準' },
  compact: { width: 400, height: 460, label: '緊湊' }
};

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function writeConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

function readHistory() {
  try {
    const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

function writeHistory(records) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(records, null, 2), 'utf8');
}

function readInterpretLog() {
  try {
    const raw = fs.readFileSync(INTERPRET_LOG_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

function writeInterpretLog(entries) {
  fs.writeFileSync(INTERPRET_LOG_FILE, JSON.stringify(entries, null, 2), 'utf8');
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workArea;

  const config = readConfig();
  const presetName = WINDOW_PRESETS[config.windowPreset] ? config.windowPreset : 'standard';
  const preset = WINDOW_PRESETS[presetName];

  const winWidth = preset.width;
  const winHeight = preset.height;

  win = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x: width - winWidth - 12,
    y: height - winHeight - 12,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    minWidth: 300,
    minHeight: 260,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile('index.html');

  win.on('closed', () => {
    win = null;
  });
}

function createSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }

  settingsWin = new BrowserWindow({
    width: 340,
    height: 520,
    resizable: true,
    maximizable: true,
    minimizable: false,
    title: '設置',
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  settingsWin.setMenu(null);
  settingsWin.loadFile('settings.html');

  settingsWin.on('closed', () => {
    settingsWin = null;
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray-32.png'));
  tray = new Tray(icon);
  tray.setToolTip('TarotPro');
  const menu = Menu.buildFromTemplate([
    {
      label: '設置',
      click: () => {
        createSettingsWindow();
      }
    },
    {
      label: '重置窗口',
      click: () => {
        resetWindow();
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(menu);
}

// 將主視窗重新定位到初始位置（右下角）；若已關閉則重新建立
function resetWindow() {
  if (!win || win.isDestroyed()) {
    createWindow();
    return;
  }
  const { width, height } = screen.getPrimaryDisplay().workArea;
  const config = readConfig();
  const presetName = WINDOW_PRESETS[config.windowPreset] ? config.windowPreset : 'standard';
  const preset = WINDOW_PRESETS[presetName];
  win.setBounds({
    width: preset.width,
    height: preset.height,
    x: width - preset.width - 12,
    y: height - preset.height - 12
  });
  win.show();
  win.focus();
}

function getToastWindow() {
  if (toastWin && !toastWin.isDestroyed()) return toastWin;
  toastWin = new BrowserWindow({
    width: 320,
    height: 40,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'toast-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  toastWin.loadFile('toast-window.html');
  toastWin.on('closed', () => {
    toastWin = null;
  });
  return toastWin;
}

// 顯示通知視窗（獨立於主視窗，避免主視窗過小無法完整顯示）
function showToastMessage(message, durationMs) {
  const toast = getToastWindow();
  const ttl = typeof durationMs === 'number' && durationMs > 0 ? durationMs : 3000;
  clearTimeout(toastTimer);

  // 將通知視窗置於主視窗上方，超出螢幕時靠螢幕底部
  positionToastWindow(toast);

  const send = () => toast.webContents.send('toast-show', message);
  if (toast.webContents.isLoading()) {
    toast.webContents.once('did-finish-load', send);
  } else {
    send();
  }
  toast.show();
  toastTimer = setTimeout(() => {
    if (toastWin && !toastWin.isDestroyed()) toastWin.hide();
  }, ttl);
}

// 通知視窗位置：主視窗正上方（與主視窗同寬對齊），超高時貼螢幕底部
function positionToastWindow(toast) {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workArea;
  let x = screenW - 320 - 12;
  let y = screenH - 40 - 12;
  if (win && !win.isDestroyed()) {
    const b = win.getBounds();
    x = b.x + b.width - 320;
    y = b.y - 40 - 8;
    if (y < 0) y = screenH - 40 - 12;
  }
  toast.setBounds({ x, y, width: 320, height: 40 });
}

ipcMain.on('toast-dismiss', () => {
  clearTimeout(toastTimer);
  if (toastWin && !toastWin.isDestroyed()) toastWin.hide();
});

// 通知視窗根據文字寬度自適應調整大小（最多 80% 螢幕寬）
ipcMain.on('toast-resize', (_e, contentWidth) => {
  if (!toastWin || toastWin.isDestroyed()) return;
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workArea;
  const w = Math.max(40, Math.min(Math.round(contentWidth), Math.floor(screenW * 0.8)));
  let x = screenW - w - 12;
  let y = toastWin.getBounds().y;
  if (win && !win.isDestroyed()) {
    const b = win.getBounds();
    x = b.x + b.width - w;
    if (b.y - 40 - 8 < 0) y = screenH - 40 - 12;
  }
  toastWin.setBounds({ x, y, width: w, height: 40 });
});

ipcMain.on('show-toast', (_e, message, durationMs) => {
  showToastMessage(message, durationMs);
});

app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

// 窗口尺寸
ipcMain.handle('window-get-presets', () => {
  const config = readConfig();
  const current = WINDOW_PRESETS[config.windowPreset] ? config.windowPreset : 'standard';
  return { presets: WINDOW_PRESETS, current };
});

ipcMain.handle('window-set-preset', (_e, presetName) => {
  const preset = WINDOW_PRESETS[presetName];
  if (!preset) return false;
  const config = readConfig();
  config.windowPreset = presetName;
  writeConfig(config);

  if (win && !win.isDestroyed()) {
    const { width, height } = screen.getPrimaryDisplay().workArea;
    win.setBounds({
      width: preset.width,
      height: preset.height,
      x: width - preset.width - 12,
      y: height - preset.height - 12
    });
  }
  return true;
});

// 塔羅歷史記錄
ipcMain.handle('history-get-all', () => {
  return readHistory();
});

ipcMain.handle('history-add', (_e, entry) => {
  const records = readHistory();
  const item = {
    timestamp: entry.timestamp || new Date().toISOString(),
    roundId: entry.roundId || '',
    cards: entry.cards || '',
    interpretation: entry.interpretation || ''
  };
  records.push(item);
  writeHistory(records);
  return item;
});

// 更新某個輪次的牌面清單（每次抽一張後累加）
ipcMain.handle('history-update-cards', (_e, { roundId, cards }) => {
  if (!roundId) return false;
  const records = readHistory();
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].roundId === roundId) {
      records[i].cards = cards;
      writeHistory(records);
      return true;
    }
  }
  return false;
});

ipcMain.handle('history-update-interpretation', (_e, { roundId, cards, interpretation }) => {
  const records = readHistory();
  // 優先依輪次 ID 更新
  if (roundId) {
    for (let i = records.length - 1; i >= 0; i--) {
      if (records[i].roundId === roundId) {
        records[i].interpretation = interpretation;
        writeHistory(records);
        return true;
      }
    }
    return false;
  }
  // 相容舊行為：找最近的、尚未有解讀、且牌面相符的記錄
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    if (r.cards === cards && !r.interpretation) {
      r.interpretation = interpretation;
      writeHistory(records);
      return true;
    }
  }
  return false;
});

// 保存牌陣（含解牌結果，如有）；以 roundId 為準 upsert
ipcMain.handle('history-save', (_e, entry) => {
  const records = readHistory();
  const idx = records.findIndex((r) => r.roundId === entry.roundId);
  const item = {
    timestamp: new Date().toISOString(),
    roundId: entry.roundId || '',
    cards: entry.cards || '',
    spread: entry.spread || null,
    interpretation: entry.interpretation || '',
    interpretationJson: entry.interpretationJson || null,
    interpretedAt: entry.interpretedAt || null
  };
  if (idx >= 0) {
    const prev = records[idx];
    records[idx] = { ...prev, ...item, timestamp: prev.timestamp || item.timestamp };
  } else {
    records.push(item);
  }
  writeHistory(records);
  return item;
});

// 解牌日誌
ipcMain.handle('interpret-log-add', (_e, entry) => {
  const log = readInterpretLog();
  const item = {
    time: entry.time || new Date().toISOString(),
    roundId: entry.roundId || '',
    cards: entry.cards || '',
    input: entry.input || [],
    output: entry.output || ''
  };
  log.push(item);
  writeInterpretLog(log);
  return item;
});

ipcMain.handle('interpret-log-get-all', () => {
  return readInterpretLog();
});
