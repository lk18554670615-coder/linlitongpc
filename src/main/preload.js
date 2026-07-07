const { contextBridge, ipcRenderer } = require('electron');

function cleanName(value) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 40) : undefined;
}

contextBridge.exposeInMainWorld('lltDesktop', {
  profiles: {
    list: () => ipcRenderer.invoke('profiles:list'),
    add: (displayName) => ipcRenderer.invoke('profiles:add', cleanName(displayName)),
    switch: (id) => ipcRenderer.invoke('profiles:switch', id),
    rename: (id, displayName) => ipcRenderer.invoke('profiles:rename', id, cleanName(displayName)),
    remove: (id) => ipcRenderer.invoke('profiles:remove', id),
    onChanged: (callback) => {
      if (typeof callback !== 'function') {
        return () => {};
      }

      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('profiles:changed', listener);
      return () => ipcRenderer.removeListener('profiles:changed', listener);
    }
  }
});
