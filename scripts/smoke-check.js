const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const requiredFiles = [
  'package.json',
  'src/main/main.js',
  'src/main/preload.js',
  'src/renderer/index.html',
  'src/renderer/renderer.js',
  'src/renderer/styles.css'
];

for (const file of requiredFiles) {
  const absolute = path.join(root, file);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Missing required file: ${file}`);
  }
}

const mainSource = fs.readFileSync(path.join(root, 'src/main/main.js'), 'utf8');
const requiredSnippets = [
  'session.fromPartition',
  'WebContentsView',
  'lastUrl',
  'getRestorableUrl',
  'did-navigate-in-page',
  'NICKNAME_SCRIPT',
  'detectedDisplayName',
  'configureUserDataPath',
  'setPermissionRequestHandler',
  'setWindowOpenHandler',
  'clearStorageData',
  'nodeIntegration: false',
  'contextIsolation: true'
];

for (const snippet of requiredSnippets) {
  if (!mainSource.includes(snippet)) {
    throw new Error(`Missing expected Electron hardening or session code: ${snippet}`);
  }
}

console.log('Smoke check passed.');
