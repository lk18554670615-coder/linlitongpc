(function () {
  const profilesList = document.getElementById('profilesList');
  const addProfileButton = document.getElementById('addProfileButton');
  const statusText = document.getElementById('statusText');

  const statusLabels = {
    idle: '待加载',
    loading: '连接中',
    ready: '在线',
    error: '连接失败'
  };

  let profiles = [];
  let busy = false;

  function setBusy(nextBusy, message) {
    busy = nextBusy;
    addProfileButton.disabled = busy;
    statusText.textContent = message || (busy ? '处理中' : '准备就绪');
  }

  function getInitials(displayName) {
    const clean = (displayName || '?').trim();
    return clean ? clean.slice(0, 2).toUpperCase() : '?';
  }

  function formatStatus(profile) {
    return statusLabels[profile.status] || statusLabels.idle;
  }

  function renderProfiles(nextProfiles) {
    profiles = Array.isArray(nextProfiles) ? nextProfiles : [];
    profilesList.replaceChildren();

    for (const profile of profiles) {
      const row = document.createElement('div');
      row.className = `profile-row${profile.isActive ? ' active' : ''}`;

      const mainButton = document.createElement('button');
      mainButton.className = 'profile-main';
      mainButton.type = 'button';
      mainButton.title = `切换到 ${profile.displayName}`;
      mainButton.disabled = busy || profile.isActive;
      mainButton.addEventListener('click', () => switchProfile(profile.id));

      const avatar = document.createElement('span');
      avatar.className = 'avatar';
      avatar.textContent = getInitials(profile.displayName);

      const copy = document.createElement('span');
      copy.className = 'profile-copy';

      const name = document.createElement('strong');
      name.textContent = profile.displayName;

      const status = document.createElement('span');
      status.className = `profile-status ${profile.status || 'idle'}`;
      status.textContent = formatStatus(profile);

      copy.append(name, status);
      mainButton.append(avatar, copy);

      const actions = document.createElement('div');
      actions.className = 'profile-actions';

      const renameButton = document.createElement('button');
      renameButton.className = 'icon-button subtle';
      renameButton.type = 'button';
      renameButton.title = '重命名账号';
      renameButton.setAttribute('aria-label', '重命名账号');
      renameButton.textContent = 'R';
      renameButton.disabled = busy;
      renameButton.addEventListener('click', () => renameProfile(profile));

      const removeButton = document.createElement('button');
      removeButton.className = 'icon-button danger';
      removeButton.type = 'button';
      removeButton.title = '移除账号';
      removeButton.setAttribute('aria-label', '移除账号');
      removeButton.textContent = 'X';
      removeButton.disabled = busy;
      removeButton.addEventListener('click', () => removeProfile(profile));

      actions.append(renameButton, removeButton);
      row.append(mainButton, actions);
      profilesList.append(row);
    }

    if (profiles.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = '暂无账号';
      profilesList.append(empty);
    }
  }

  async function refreshProfiles() {
    try {
      renderProfiles(await window.lltDesktop.profiles.list());
    } catch (error) {
      statusText.textContent = error.message || '读取账号失败';
    }
  }

  async function addProfile() {
    const defaultName = `账号 ${profiles.length + 1}`;
    setBusy(true, '正在添加账号');
    try {
      renderProfiles(await window.lltDesktop.profiles.add(defaultName));
      statusText.textContent = '已添加账号';
    } catch (error) {
      statusText.textContent = error.message || '添加账号失败';
    } finally {
      setBusy(false);
    }
  }

  async function switchProfile(profileId) {
    setBusy(true, '正在切换账号');
    try {
      renderProfiles(await window.lltDesktop.profiles.switch(profileId));
      statusText.textContent = '已切换账号';
    } catch (error) {
      statusText.textContent = error.message || '切换账号失败';
    } finally {
      setBusy(false);
    }
  }

  async function renameProfile(profile) {
    const displayName = window.prompt('请输入新的显示名称', profile.displayName);
    if (displayName === null || displayName.trim() === '') {
      return;
    }

    setBusy(true, '正在重命名');
    try {
      renderProfiles(await window.lltDesktop.profiles.rename(profile.id, displayName));
      statusText.textContent = '已重命名';
    } catch (error) {
      statusText.textContent = error.message || '重命名失败';
    } finally {
      setBusy(false);
    }
  }

  async function removeProfile(profile) {
    const confirmed = window.confirm(`确定移除「${profile.displayName}」吗？本地登录态和缓存会被清理。`);
    if (!confirmed) {
      return;
    }

    setBusy(true, '正在移除账号');
    try {
      renderProfiles(await window.lltDesktop.profiles.remove(profile.id));
      statusText.textContent = '已移除账号';
    } catch (error) {
      statusText.textContent = error.message || '移除账号失败';
    } finally {
      setBusy(false);
    }
  }

  addProfileButton.addEventListener('click', addProfile);

  window.lltDesktop.profiles.onChanged(renderProfiles);
  refreshProfiles();
})();
