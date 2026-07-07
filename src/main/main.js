const {
  app,
  BaseWindow,
  WebContentsView,
  session,
  ipcMain,
  shell,
  dialog,
  Menu
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const APP_URL = 'https://pc.llitong.com/';
const APP_ORIGIN = 'https://pc.llitong.com';
const SIDEBAR_WIDTH = 236;
const ALLOWED_PERMISSIONS = new Set(['media', 'notifications', 'fullscreen']);
const USER_DATA_DIR_NAME = 'linlitongpc-desktop';
const NICKNAME_SYNC_DELAY_MS = 1200;
const NICKNAME_SYNC_INTERVAL_MS = 10000;
const NICKNAME_SCRIPT = String.raw`
(() => {
  const badNames = new Set([
    '聊天',
    '好友',
    '群聊',
    '群信息',
    '群成员',
    '搜索',
    '发送',
    '修改信息',
    '账号',
    '在线',
    '离线',
    '登录',
    '退出登录',
    '本群昵称'
  ]);
  const candidates = [];
  const seen = typeof WeakSet === 'function' ? new WeakSet() : null;
  const keyScores = {
    nickname: 130,
    nickName: 130,
    nick_name: 130,
    nick: 120,
    displayName: 115,
    realName: 110,
    real_name: 110,
    userName: 105,
    username: 105,
    loginName: 95,
    loginname: 95,
    name: 70
  };

  function clean(value) {
    if (typeof value !== 'string' && typeof value !== 'number') {
      return '';
    }

    const text = String(value)
      .replace(/\s+/g, ' ')
      .trim();

    if (!text || text.length > 40 || /^https?:\/\//i.test(text) || /^\d+$/.test(text)) {
      return '';
    }

    if (badNames.has(text) || /^账号\s*\d+$/i.test(text)) {
      return '';
    }

    return text;
  }

  function addCandidate(value, score, source) {
    const nickname = clean(value);
    if (!nickname) {
      return;
    }

    candidates.push({ nickname, score, source });
  }

  function scoreForKey(key, path) {
    const direct = keyScores[key] || keyScores[key.toLowerCase()];
    if (!direct) {
      return 0;
    }

    let score = direct;
    const fullPath = (path + '.' + key).toLowerCase();

    if (/(self|mine|my|me|login|account|member|profile|userinfo|user_info|currentuser)/.test(fullPath)) {
      score += 45;
    }

    if (/(chat|message|session|group|friend|list|history|room)/.test(fullPath)) {
      score -= 35;
    }

    return score;
  }

  function walk(value, path, depth, nodeBudget) {
    if (!value || depth > 5 || nodeBudget.count > 1400) {
      return;
    }

    nodeBudget.count += 1;

    if (typeof value === 'string' || typeof value === 'number') {
      return;
    }

    if (typeof value !== 'object') {
      return;
    }

    if (seen) {
      if (seen.has(value)) {
        return;
      }
      seen.add(value);
    }

    for (const [key, child] of Object.entries(value)) {
      const score = scoreForKey(key, path);
      if (score) {
        addCandidate(child, score, path + '.' + key);
      }

      if (child && typeof child === 'object') {
        walk(child, path + '.' + key, depth + 1, nodeBudget);
      }
    }
  }

  function inspectStorage(storage, label) {
    if (!storage) {
      return;
    }

    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      const value = storage.getItem(key);
      const keyScore = scoreForKey(key || '', label);

      if (keyScore) {
        addCandidate(value, keyScore, label + '.' + key);
      }

      if (!value || value.length > 400000) {
        continue;
      }

      try {
        walk(JSON.parse(value), label + '.' + key, 0, { count: 0 });
      } catch {
        // Non-JSON storage values are expected.
      }
    }
  }

  function inspectVue() {
    const root = document.querySelector('#app');
    const vm = root && root.__vue__;
    if (!vm) {
      return;
    }

    if (vm.$store && vm.$store.state) {
      walk(vm.$store.state, 'vuex.state', 0, { count: 0 });
    }

    if (vm.$data) {
      walk(vm.$data, 'vue.data', 0, { count: 0 });
    }
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  function inspectVisibleProfileCard() {
    for (const element of document.querySelectorAll('body *')) {
      if (!isVisible(element)) {
        continue;
      }

      const text = element.innerText || '';
      if (!text.includes('修改信息') || !text.includes('发送消息')) {
        continue;
      }

      const lines = text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      for (let index = 0; index < lines.length; index += 1) {
        if (/^\d{3,}$/.test(lines[index]) && index > 0) {
          addCandidate(lines[index - 1], 220, 'visible.profile-card');
        }
      }
    }
  }

  inspectStorage(window.localStorage, 'localStorage');
  inspectStorage(window.sessionStorage, 'sessionStorage');
  inspectVue();
  inspectVisibleProfileCard();

  candidates.sort((a, b) => b.score - a.score || a.nickname.length - b.nickname.length);
  return candidates[0] || null;
})();
`;

let mainWindow = null;
let chromeView = null;
let profiles = [];
let profilesPath = '';

const profileViews = new Map();
const runtimeStates = new Map();
const configuredPartitions = new Set();
const nicknameTimers = new Map();
const nicknameIntervals = new Map();
let saveProfilesTimer = null;

function nowIso() {
  return new Date().toISOString();
}

function configureUserDataPath() {
  const userDataPath = path.join(app.getPath('appData'), USER_DATA_DIR_NAME);
  fs.mkdirSync(userDataPath, { recursive: true });
  app.setPath('userData', userDataPath);
}

function cleanDisplayName(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.replace(/\s+/g, ' ').trim().slice(0, 40);
}

function isPlaceholderDisplayName(value) {
  const clean = cleanDisplayName(value);
  return (
    !clean ||
    /^账号\s*\d+$/i.test(clean) ||
    /^account\s*\d+$/i.test(clean) ||
    (clean.includes('璐') && clean.includes('彿'))
  );
}

function createProfile(displayName) {
  const id = crypto.randomUUID();
  const normalizedDisplayName = cleanDisplayName(displayName) || `账号 ${profiles.length + 1}`;

  return {
    id,
    displayName: normalizedDisplayName,
    displayNameSource: isPlaceholderDisplayName(normalizedDisplayName) ? 'auto' : 'manual',
    detectedDisplayName: '',
    partitionName: `persist:llt-profile-${id}`,
    lastUrl: APP_URL,
    lastTitle: '',
    createdAt: nowIso(),
    lastActiveAt: nowIso(),
    isActive: false
  };
}

function getUserDataFilePath() {
  return path.join(app.getPath('userData'), 'profiles.json');
}

function getWindowIconPath() {
  const iconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  return path.join(app.getAppPath(), 'build', 'icons', iconName);
}

function ensureStoreReady() {
  profilesPath = getUserDataFilePath();
  fs.mkdirSync(path.dirname(profilesPath), { recursive: true });
}

function normalizeProfiles(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => {
      const id = typeof item.id === 'string' && item.id ? item.id : crypto.randomUUID();
      const fallbackDisplayName = cleanDisplayName(item.displayName) || `账号 ${index + 1}`;
      const detectedDisplayName = cleanDisplayName(item.detectedDisplayName);
      const displayNameSource =
        item.displayNameSource === 'manual' && !isPlaceholderDisplayName(fallbackDisplayName)
          ? 'manual'
          : 'auto';

      return {
        id,
        displayName:
          displayNameSource === 'auto' && detectedDisplayName ? detectedDisplayName : fallbackDisplayName,
        displayNameSource,
        detectedDisplayName,
        partitionName:
          typeof item.partitionName === 'string' && item.partitionName.startsWith('persist:')
            ? item.partitionName
            : `persist:llt-profile-${id}`,
        lastUrl: getRestorableUrl(item.lastUrl),
        lastTitle: typeof item.lastTitle === 'string' ? item.lastTitle.slice(0, 120) : '',
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : nowIso(),
        lastActiveAt: typeof item.lastActiveAt === 'string' ? item.lastActiveAt : nowIso(),
        isActive: Boolean(item.isActive)
      };
    });
}

function loadProfiles() {
  ensureStoreReady();

  if (!fs.existsSync(profilesPath)) {
    profiles = [];
    ensureAtLeastOneProfile();
    saveProfiles();
    return;
  }

  try {
    const raw = fs.readFileSync(profilesPath, 'utf8');
    profiles = normalizeProfiles(JSON.parse(raw));
  } catch (error) {
    console.error('Failed to read profiles.json, starting with a fresh profile.', error);
    profiles = [];
  }

  ensureAtLeastOneProfile();
  normalizeActiveProfile();
  saveProfiles();
}

function saveProfiles() {
  if (saveProfilesTimer) {
    clearTimeout(saveProfilesTimer);
    saveProfilesTimer = null;
  }

  const tmpPath = `${profilesPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(profiles, null, 2), 'utf8');
  fs.renameSync(tmpPath, profilesPath);
}

function queueSaveProfiles() {
  if (saveProfilesTimer) {
    return;
  }

  saveProfilesTimer = setTimeout(() => {
    saveProfilesTimer = null;
    saveProfiles();
  }, 350);
}

function ensureAtLeastOneProfile() {
  if (profiles.length === 0) {
    const profile = createProfile('账号 1');
    profile.isActive = true;
    profiles.push(profile);
  }
}

function normalizeActiveProfile(activeId) {
  const requested = activeId ? profiles.find((profile) => profile.id === activeId) : null;
  const current = requested || profiles.find((profile) => profile.isActive) || profiles[0];

  if (!current) {
    return null;
  }

  for (const profile of profiles) {
    profile.isActive = profile.id === current.id;
  }

  current.lastActiveAt = nowIso();
  return current;
}

function getActiveProfile() {
  return profiles.find((profile) => profile.isActive) || profiles[0] || null;
}

function toRendererProfile(profile) {
  return {
    id: profile.id,
    displayName: profile.displayName,
    createdAt: profile.createdAt,
    lastActiveAt: profile.lastActiveAt,
    isActive: profile.isActive,
    status: runtimeStates.get(profile.id) || 'idle'
  };
}

function getProfilesPayload() {
  return profiles.map(toRendererProfile);
}

function emitProfilesChanged() {
  if (!chromeView || chromeView.webContents.isDestroyed()) {
    return;
  }

  chromeView.webContents.send('profiles:changed', getProfilesPayload());
}

function setRuntimeState(profileId, status) {
  runtimeStates.set(profileId, status);
  emitProfilesChanged();
}

function applyDetectedDisplayName(profile, nickname, source) {
  const nextName = cleanDisplayName(nickname);
  if (!nextName || isPlaceholderDisplayName(nextName)) {
    return false;
  }

  let changed = false;

  if (profile.detectedDisplayName !== nextName) {
    profile.detectedDisplayName = nextName;
    changed = true;
  }

  if (profile.displayNameSource !== 'manual' && profile.displayName !== nextName) {
    profile.displayName = nextName;
    changed = true;
  }

  if (changed) {
    profile.lastActiveAt = nowIso();
    queueSaveProfiles();
    emitProfilesChanged();
  }

  return changed;
}

async function syncProfileNickname(profile) {
  const view = profileViews.get(profile.id);
  if (!view || view.webContents.isDestroyed() || !isAllowedAppUrl(view.webContents.getURL())) {
    return;
  }

  try {
    const result = await view.webContents.executeJavaScript(NICKNAME_SCRIPT, true);
    if (result && result.nickname) {
      applyDetectedDisplayName(profile, result.nickname, result.source);
    }
  } catch (error) {
    if (!/render frame was disposed|Cannot execute JavaScript|Script failed/i.test(error.message || '')) {
      console.warn('Failed to sync profile nickname.', error);
    }
  }
}

function scheduleProfileNicknameSync(profile, delay = NICKNAME_SYNC_DELAY_MS) {
  const previousTimer = nicknameTimers.get(profile.id);
  if (previousTimer) {
    clearTimeout(previousTimer);
  }

  const timer = setTimeout(() => {
    nicknameTimers.delete(profile.id);
    syncProfileNickname(profile);
  }, delay);
  nicknameTimers.set(profile.id, timer);
}

function startProfileNicknamePolling(profile) {
  if (nicknameIntervals.has(profile.id)) {
    return;
  }

  const interval = setInterval(() => {
    syncProfileNickname(profile);
  }, NICKNAME_SYNC_INTERVAL_MS);
  nicknameIntervals.set(profile.id, interval);
}

function stopProfileNicknameSync(profileId) {
  const timer = nicknameTimers.get(profileId);
  if (timer) {
    clearTimeout(timer);
    nicknameTimers.delete(profileId);
  }

  const interval = nicknameIntervals.get(profileId);
  if (interval) {
    clearInterval(interval);
    nicknameIntervals.delete(profileId);
  }
}

function stopAllProfileNicknameSync() {
  for (const profileId of nicknameTimers.keys()) {
    stopProfileNicknameSync(profileId);
  }

  for (const profileId of nicknameIntervals.keys()) {
    stopProfileNicknameSync(profileId);
  }
}

function parseUrl(rawUrl) {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

function isAllowedAppUrl(rawUrl) {
  const parsed = parseUrl(rawUrl);
  return Boolean(parsed && parsed.origin === APP_ORIGIN);
}

function getRestorableUrl(rawUrl) {
  return isAllowedAppUrl(rawUrl) ? rawUrl : APP_URL;
}

function isHttpUrl(rawUrl) {
  const parsed = parseUrl(rawUrl);
  return Boolean(parsed && (parsed.protocol === 'https:' || parsed.protocol === 'http:'));
}

async function openExternalUrl(rawUrl) {
  if (!isHttpUrl(rawUrl)) {
    return { ok: false, error: 'Only http and https links can be opened.' };
  }

  await shell.openExternal(rawUrl);
  return { ok: true };
}

function sanitizeDownloadName(fileName) {
  const safeBase = path.basename(fileName || 'download');
  return safeBase.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_') || 'download';
}

function getUniqueDownloadPath(fileName) {
  const downloadsDir = app.getPath('downloads');
  const safeName = sanitizeDownloadName(fileName);
  const ext = path.extname(safeName);
  const name = path.basename(safeName, ext);
  let candidate = path.join(downloadsDir, safeName);
  let counter = 1;

  while (fs.existsSync(candidate)) {
    candidate = path.join(downloadsDir, `${name} (${counter})${ext}`);
    counter += 1;
  }

  return candidate;
}

function configureProfileSession(profile) {
  if (configuredPartitions.has(profile.partitionName)) {
    return;
  }

  configuredPartitions.add(profile.partitionName);

  const profileSession = session.fromPartition(profile.partitionName);

  profileSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = details.requestingUrl || webContents.getURL();
    callback(isAllowedAppUrl(requestingUrl) && ALLOWED_PERMISSIONS.has(permission));
  });

  profileSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return isAllowedAppUrl(requestingOrigin) && ALLOWED_PERMISSIONS.has(permission);
  });

  profileSession.on('will-download', (_event, item) => {
    const savePath = getUniqueDownloadPath(item.getFilename());
    item.setSavePath(savePath);

    item.once('done', (_doneEvent, state) => {
      if (state === 'completed') {
        console.info(`Download completed: ${savePath}`);
      } else if (state !== 'cancelled') {
        console.warn(`Download ${state}: ${savePath}`);
      }
    });
  });
}

function configureRemoteWebContents(profile, webContents) {
  webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedAppUrl(url)) {
      webContents.loadURL(url);
    } else {
      openExternalUrl(url).catch((error) => console.error('Failed to open external link.', error));
    }

    return { action: 'deny' };
  });

  webContents.on('will-navigate', (event, url) => {
    if (isAllowedAppUrl(url)) {
      return;
    }

    event.preventDefault();
    openExternalUrl(url).catch((error) => console.error('Failed to open external link.', error));
  });

  webContents.on('will-redirect', (event, url) => {
    if (isAllowedAppUrl(url)) {
      return;
    }

    event.preventDefault();
    openExternalUrl(url).catch((error) => console.error('Failed to open external redirect.', error));
  });

  webContents.on('did-start-loading', () => setRuntimeState(profile.id, 'loading'));
  webContents.on('did-stop-loading', () => {
    setRuntimeState(profile.id, 'ready');
    scheduleProfileNicknameSync(profile);
  });
  webContents.on('did-navigate', (_event, url) => {
    rememberProfileLocation(profile, url);
    scheduleProfileNicknameSync(profile);
  });
  webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (isMainFrame) {
      rememberProfileLocation(profile, url);
      scheduleProfileNicknameSync(profile);
    }
  });
  webContents.on('page-title-updated', (_event, title) => rememberProfileTitle(profile, title));
  webContents.on('did-fail-load', (_event, _code, _description, _url, isMainFrame) => {
    if (isMainFrame) {
      setRuntimeState(profile.id, 'error');
    }
  });
  webContents.on('focus', () => {
    if (!profile.isActive) {
      switchProfile(profile.id, { fromWebContentsFocus: true }).catch((error) => {
        console.error('Failed to switch profile after webContents focus.', error);
      });
    }
  });
}

function rememberProfileLocation(profile, url) {
  if (!isAllowedAppUrl(url) || profile.lastUrl === url) {
    return;
  }

  profile.lastUrl = url;
  profile.lastActiveAt = nowIso();
  queueSaveProfiles();
}

function rememberProfileTitle(profile, title) {
  if (typeof title !== 'string') {
    return;
  }

  const nextTitle = title.trim().slice(0, 120);
  if (profile.lastTitle === nextTitle) {
    return;
  }

  profile.lastTitle = nextTitle;
  queueSaveProfiles();
}

function persistOpenProfileLocations() {
  for (const profile of profiles) {
    const view = profileViews.get(profile.id);
    if (view && !view.webContents.isDestroyed()) {
      rememberProfileLocation(profile, view.webContents.getURL());
      rememberProfileTitle(profile, view.webContents.getTitle());
    }
  }
}

function createProfileView(profile) {
  const existing = profileViews.get(profile.id);
  if (existing && !existing.webContents.isDestroyed()) {
    return existing;
  }

  configureProfileSession(profile);

  const view = new WebContentsView({
    webPreferences: {
      partition: profile.partitionName,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      backgroundThrottling: false,
      devTools: !app.isPackaged
    }
  });

  profileViews.set(profile.id, view);
  runtimeStates.set(profile.id, 'loading');
  configureRemoteWebContents(profile, view.webContents);
  startProfileNicknamePolling(profile);
  mainWindow.contentView.addChildView(view);
  const startupUrl = getRestorableUrl(profile.lastUrl);
  view.webContents.loadURL(startupUrl).catch((error) => {
    console.error(`Failed to load ${startupUrl}`, error);
    setRuntimeState(profile.id, 'error');
  });

  return view;
}

function layoutViews() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const [width, height] = mainWindow.getContentSize();
  const contentWidth = Math.max(0, width - SIDEBAR_WIDTH);
  const activeProfile = getActiveProfile();

  if (chromeView && !chromeView.webContents.isDestroyed()) {
    chromeView.setBounds({ x: 0, y: 0, width: SIDEBAR_WIDTH, height });
  }

  for (const profile of profiles) {
    const view = profileViews.get(profile.id);
    if (!view || view.webContents.isDestroyed()) {
      continue;
    }

    if (activeProfile && profile.id === activeProfile.id) {
      view.setBounds({ x: SIDEBAR_WIDTH, y: 0, width: contentWidth, height });
    } else {
      view.setBounds({ x: SIDEBAR_WIDTH, y: 0, width: 0, height: 0 });
    }
  }
}

async function switchProfile(profileId, options = {}) {
  const profile = normalizeActiveProfile(profileId);

  if (!profile) {
    throw new Error('Profile not found.');
  }

  saveProfiles();
  createProfileView(profile);
  layoutViews();

  if (!options.fromWebContentsFocus && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
  }

  emitProfilesChanged();
  return getProfilesPayload();
}

async function removeProfile(profileId) {
  const profile = profiles.find((item) => item.id === profileId);
  if (!profile) {
    throw new Error('Profile not found.');
  }

  const view = profileViews.get(profile.id);
  if (view) {
    try {
      mainWindow.contentView.removeChildView(view);
      view.webContents.close();
    } catch (error) {
      console.warn('Failed to close removed profile view.', error);
    }

    profileViews.delete(profile.id);
  }
  stopProfileNicknameSync(profile.id);

  const profileSession = session.fromPartition(profile.partitionName);
  await profileSession.clearStorageData();
  await profileSession.clearCache();

  profiles = profiles.filter((item) => item.id !== profileId);
  runtimeStates.delete(profileId);
  ensureAtLeastOneProfile();
  normalizeActiveProfile();
  saveProfiles();

  for (const item of profiles) {
    createProfileView(item);
  }

  layoutViews();
  emitProfilesChanged();
  return getProfilesPayload();
}

function createChromeView() {
  chromeView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
      devTools: !app.isPackaged
    }
  });

  mainWindow.contentView.addChildView(chromeView);
  chromeView.webContents.loadFile(path.join(__dirname, '..', 'renderer', 'index.html')).catch((error) => {
    dialog.showErrorBox('邻里通启动失败', error.message);
  });
  chromeView.webContents.once('did-finish-load', () => {
    emitProfilesChanged();
  });
}

function createMainWindow() {
  loadProfiles();

  mainWindow = new BaseWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: '邻里通',
    icon: getWindowIconPath(),
    backgroundColor: '#f6f4ec',
    show: false
  });

  createChromeView();

  for (const profile of profiles) {
    createProfileView(profile);
  }

  layoutViews();

  mainWindow.on('resize', layoutViews);
  mainWindow.on('maximize', layoutViews);
  mainWindow.on('unmaximize', layoutViews);
  mainWindow.on('restore', layoutViews);
  mainWindow.on('close', () => {
    persistOpenProfileLocations();
    saveProfiles();
  });
  mainWindow.on('closed', () => {
    stopAllProfileNicknameSync();
    profileViews.clear();
    chromeView = null;
    mainWindow = null;
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());

  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  }, 800);
}

function registerIpcHandlers() {
  ipcMain.handle('profiles:list', () => getProfilesPayload());

  ipcMain.handle('profiles:add', async (_event, displayName) => {
    const profile = createProfile(displayName || `账号 ${profiles.length + 1}`);
    profiles.push(profile);
    createProfileView(profile);
    return switchProfile(profile.id);
  });

  ipcMain.handle('profiles:switch', async (_event, profileId) => {
    return switchProfile(profileId);
  });

  ipcMain.handle('profiles:rename', async (_event, profileId, displayName) => {
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) {
      throw new Error('Profile not found.');
    }

    if (!displayName) {
      throw new Error('Display name cannot be empty.');
    }

    profile.displayName = cleanDisplayName(displayName);
    profile.displayNameSource = 'manual';
    profile.lastActiveAt = nowIso();
    saveProfiles();
    emitProfilesChanged();
    return getProfilesPayload();
  });

  ipcMain.handle('profiles:remove', async (_event, profileId) => {
    return removeProfile(profileId);
  });

}

function registerGlobalSecurityHandlers() {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => {
      event.preventDefault();
    });
  });
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

app.setName('邻里通');
configureUserDataPath();

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.setAppUserModelId('com.linlitong.desktop');
  registerGlobalSecurityHandlers();

  app.on('second-instance', focusMainWindow);

  app.whenReady().then(() => {
    if (!BaseWindow || !WebContentsView) {
      dialog.showErrorBox(
        'Electron 版本不兼容',
        '当前 Electron 版本不支持 BaseWindow 或 WebContentsView。'
      );
      app.quit();
      return;
    }

    Menu.setApplicationMenu(null);
    registerIpcHandlers();
    createMainWindow();
  });

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createMainWindow();
    }
  });

  app.on('window-all-closed', () => {
    if (profiles.length > 0) {
      saveProfiles();
    }

    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    persistOpenProfileLocations();

    if (profiles.length > 0) {
      saveProfiles();
    }
  });
}
