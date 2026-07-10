/**
 * ========================================
 *  📱 Instagram Inactive Followers Finder
 * ========================================
 * Trova i tuoi follower inattivi o senza post.
 *
 * COME USARLO:
 * 1. Vai su https://www.instagram.com e fai login
 * 2. Apri la console del browser (F12 → Console)
 * 3. Incolla tutto il contenuto di questo file e premi Invio
 * 4. Clicca RUN e aspetta la scansione
 *
 * ⚠️ ATTENZIONE: Usare a proprio rischio.
 *    Non affiliato con Instagram/Meta.
 */

(async function InstaInactiveFollowers() {
  'use strict';

  if (!location.hostname.includes('instagram.com')) {
    alert('❌ Esegui questo script su www.instagram.com');
    return;
  }

  // Rimuovi istanza precedente se esiste
  document.getElementById('iif-root')?.remove();

  // ─────────────────────────────────────
  // STATO
  // ─────────────────────────────────────
  const state = {
    currentUser: null,
    followers: [],
    inactiveUsers: [],
    selected: new Set(),
    scanning: false,
    progress: { current: 0, total: 0 },
    settings: {
      inactivityMonths: 12,
      includeNoPosts: true,
      checkLastPost: true,
      delayMs: 1200,
    },
    whitelist: new Set(JSON.parse(localStorage.getItem('iif_whitelist') || '[]')),
  };

  function saveWhitelist() {
    localStorage.setItem('iif_whitelist', JSON.stringify([...state.whitelist]));
  }

  // ─────────────────────────────────────
  // API INSTAGRAM
  // ─────────────────────────────────────
  function getCookie(name) {
    return document.cookie.split('; ').find(r => r.startsWith(name + '='))?.split('=').slice(1).join('=');
  }

  const HEADERS = {
    'x-csrftoken': getCookie('csrftoken'),
    'x-ig-app-id': '936619743392459',
    'x-requested-with': 'XMLHttpRequest',
  };

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function apiGet(url) {
    const res = await fetch(url, { headers: HEADERS, credentials: 'include' });
    if (res.status === 429) throw new Error('RATE_LIMIT');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function apiPost(url, body = '') {
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      credentials: 'include',
      body,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function withRetry(fn, retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (e) {
        if (e.message === 'RATE_LIMIT' || i < retries - 1) {
          const wait = state.settings.delayMs * (i + 2);
          setStatus(`⏳ Rate limit – attendo ${Math.round(wait / 1000)}s...`);
          await sleep(wait);
        } else {
          throw e;
        }
      }
    }
  }

  async function getCurrentUser() {
    const userId = getCookie('ds_user_id');
    if (!userId) throw new Error('Non sei loggato su Instagram. Effettua il login e riprova.');
    return { pk: userId, username: '(account corrente)' };
  }

  async function getFollowersPage(userId, maxId = '') {
    const qs = `count=200${maxId ? `&max_id=${maxId}` : ''}`;
    return apiGet(`https://i.instagram.com/api/v1/friendships/${userId}/followers/?${qs}`);
  }

  async function getAllFollowers(userId) {
    const all = [];
    let nextMaxId = '';
    while (true) {
      const data = await withRetry(() => getFollowersPage(userId, nextMaxId));
      if (data.users?.length) all.push(...data.users);
      setProgress(all.length, all.length, `Caricamento follower: ${all.length}...`);
      if (!data.next_max_id) break;
      nextMaxId = data.next_max_id;
      await sleep(state.settings.delayMs);
    }
    return all;
  }

  async function getUserInfo(userId) {
    const data = await withRetry(() => apiGet(`https://i.instagram.com/api/v1/users/${userId}/info/`));
    return data.user;
  }

  async function getLastPostDate(userId) {
    try {
      const data = await withRetry(() =>
        apiGet(`https://i.instagram.com/api/v1/feed/user/${userId}/?count=1`)
      );
      const items = data.items || [];
      if (items.length === 0) return null;
      return new Date(items[0].taken_at * 1000);
    } catch {
      return null;
    }
  }

  async function removeFollower(userId) {
    return apiPost(
      `https://i.instagram.com/api/v1/friendships/remove_follower/${userId}/`,
      `user_id=${userId}`
    );
  }

  // ─────────────────────────────────────
  // LOGICA PRINCIPALE
  // ─────────────────────────────────────
  async function runScan() {
    try {
      state.scanning = true;
      state.inactiveUsers = [];
      state.selected.clear();
      showScanning();

      setStatus('🔍 Recupero informazioni account...');
      state.currentUser = await getCurrentUser();

      setStatus('📥 Caricamento lista follower...');
      state.followers = await getAllFollowers(state.currentUser.pk);
      setStatus(`✅ ${state.followers.length} follower trovati. Analisi attività in corso...`);

      const thresholdDate = new Date();
      thresholdDate.setMonth(thresholdDate.getMonth() - state.settings.inactivityMonths);

      let checked = 0;
      for (const follower of state.followers) {
        if (state.whitelist.has(String(follower.pk))) {
          checked++;
          setProgress(checked, state.followers.length, `Analisi: @${follower.username}`);
          continue;
        }

        setProgress(checked, state.followers.length, `Analisi: @${follower.username}`);

        try {
          const info = await withRetry(() => getUserInfo(follower.pk));
          // NOTA: non usare ?? 0 — se media_count è assente non possiamo
          // assumere che sia 0, potrebbe essere un limite dell'API.
          const mediaCount = info?.media_count;

          let isInactive = false;
          let reason = '';
          let lastPostDate = null;

          if (state.settings.includeNoPosts && mediaCount === 0) {
            // Solo se esplicitamente 0, non se undefined/null
            isInactive = true;
            reason = '0 post';
          } else if (state.settings.checkLastPost && mediaCount > 0) {
            await sleep(state.settings.delayMs);
            lastPostDate = await getLastPostDate(follower.pk);
            if (lastPostDate && lastPostDate < thresholdDate) {
              isInactive = true;
              const months = Math.floor((Date.now() - lastPostDate) / (1000 * 60 * 60 * 24 * 30));
              reason = `inattivo da ${months} mesi`;
            }
          }

          if (isInactive) {
            state.inactiveUsers.push({
              pk: String(follower.pk),
              username: follower.username,
              full_name: follower.full_name || '',
              profile_pic_url: follower.profile_pic_url,
              media_count: mediaCount,
              is_private: info.is_private,
              follower_count: info.follower_count,
              following_count: info.following_count,
              last_post_date: lastPostDate,
              reason,
            });
            renderResults();
          }
        } catch (e) {
          console.warn(`[IIF] Errore per @${follower.username}:`, e.message);
        }

        checked++;
        await sleep(state.settings.delayMs);
      }

      state.scanning = false;
      setStatus(`✅ Scansione completata! ${state.inactiveUsers.length} account inattivi trovati.`);
      renderResults();

    } catch (e) {
      state.scanning = false;
      setStatus(`❌ Errore: ${e.message}`);
      console.error('[IIF]', e);
    }
  }

  async function removeSelected() {
    const toRemove = [...state.selected];
    if (!toRemove.length) return;
    if (!confirm(`Rimuovere ${toRemove.length} follower selezionati?`)) return;

    setStatus('🗑️ Rimozione in corso...');
    let done = 0;
    for (const userId of toRemove) {
      try {
        await removeFollower(userId);
        done++;
        state.inactiveUsers = state.inactiveUsers.filter(u => u.pk !== userId);
        state.selected.delete(userId);
        setProgress(done, toRemove.length, `Rimozione ${done}/${toRemove.length}...`);
        renderResults();
        await sleep(state.settings.delayMs * 2);
      } catch (e) {
        console.warn(`[IIF] Errore rimozione ${userId}:`, e.message);
      }
    }
    setStatus(`✅ Rimossi ${done} follower.`);
  }

  // ─────────────────────────────────────
  // UI
  // ─────────────────────────────────────
  const CSS = `
    #iif-root * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    #iif-root {
      position: fixed; top: 20px; right: 20px; z-index: 999999;
      width: 400px; max-height: 90vh;
      background: #fff; border-radius: 16px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.2);
      display: flex; flex-direction: column;
      overflow: hidden; border: 1px solid #e0e0e0;
    }
    #iif-header {
      background: linear-gradient(135deg, #833ab4, #fd1d1d, #fcb045);
      color: #fff; padding: 16px 20px;
      display: flex; align-items: center; justify-content: space-between;
    }
    #iif-header h2 { margin: 0; font-size: 16px; font-weight: 700; }
    #iif-header span { font-size: 11px; opacity: 0.85; }
    #iif-close {
      background: rgba(255,255,255,0.25); border: none; border-radius: 50%;
      width: 28px; height: 28px; color: #fff; cursor: pointer;
      font-size: 16px; display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    #iif-close:hover { background: rgba(255,255,255,0.4); }
    #iif-settings {
      padding: 14px 16px; border-bottom: 1px solid #f0f0f0; background: #fafafa;
    }
    #iif-settings label {
      display: flex; align-items: center; gap: 8px;
      font-size: 13px; color: #333; margin-bottom: 8px; cursor: pointer;
    }
    #iif-settings label:last-child { margin-bottom: 0; }
    #iif-settings input[type=checkbox] { width: 16px; height: 16px; cursor: pointer; }
    #iif-settings .row { display: flex; align-items: center; gap: 8px; }
    #iif-settings select {
      border: 1px solid #ddd; border-radius: 8px;
      padding: 4px 8px; font-size: 13px; background: #fff;
    }
    #iif-run {
      margin: 12px 16px; padding: 10px;
      background: linear-gradient(135deg, #833ab4, #fd1d1d);
      color: #fff; border: none; border-radius: 10px;
      font-size: 14px; font-weight: 700; cursor: pointer; transition: opacity 0.2s;
    }
    #iif-run:hover { opacity: 0.9; }
    #iif-run:disabled { opacity: 0.5; cursor: not-allowed; }
    #iif-status { padding: 6px 16px; font-size: 12px; color: #555; min-height: 26px; }
    #iif-progress-bar {
      height: 3px; background: #f0f0f0; margin: 0 16px 8px;
      border-radius: 2px; overflow: hidden;
    }
    #iif-progress-fill {
      height: 100%; width: 0%;
      background: linear-gradient(90deg, #833ab4, #fd1d1d);
      transition: width 0.3s; border-radius: 2px;
    }
    #iif-actions { display: flex; gap: 8px; padding: 0 16px 10px; }
    #iif-select-all {
      flex: 1; padding: 7px; font-size: 12px; font-weight: 600;
      border: 1px solid #ddd; border-radius: 8px; background: #fff; cursor: pointer;
    }
    #iif-select-all:hover { background: #f5f5f5; }
    #iif-remove-btn {
      flex: 1; padding: 7px; font-size: 12px; font-weight: 600;
      background: #ed4956; color: #fff; border: none; border-radius: 8px; cursor: pointer;
    }
    #iif-remove-btn:hover { background: #d63030; }
    #iif-remove-btn:disabled { background: #ccc; cursor: not-allowed; }
    #iif-list { overflow-y: auto; flex: 1; padding: 0 8px 8px; }
    #iif-empty { text-align: center; padding: 30px 16px; color: #999; font-size: 13px; }
    .iif-user {
      display: flex; align-items: center; gap: 10px;
      padding: 9px 8px; border-radius: 10px;
      cursor: pointer; transition: background 0.15s;
    }
    .iif-user:hover { background: #f9f9f9; }
    .iif-user.selected { background: #fff0f0; }
    .iif-user img {
      width: 42px; height: 42px; border-radius: 50%;
      object-fit: cover; flex-shrink: 0; border: 2px solid #eee;
    }
    .iif-user-info { flex: 1; min-width: 0; }
    .iif-user-info strong { display: block; font-size: 13px; color: #111; }
    .iif-user-info span { font-size: 11px; color: #888; }
    .iif-badge {
      font-size: 10px; padding: 2px 7px; border-radius: 20px;
      font-weight: 600; white-space: nowrap;
    }
    .iif-badge.ghost { background: #f0f0f0; color: #666; }
    .iif-badge.inactive { background: #fff3cd; color: #856404; }
    .iif-cb { width: 18px; height: 18px; flex-shrink: 0; cursor: pointer; }
    .iif-wl-btn {
      background: none; border: 1px solid #ddd; border-radius: 6px;
      padding: 3px 7px; font-size: 11px; cursor: pointer; color: #555;
    }
    .iif-wl-btn:hover { background: #f5f5f5; }
    #iif-count { font-size: 11px; color: #888; padding: 0 16px 6px; text-align: right; }
  `;

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'iif-root';
  document.body.appendChild(root);

  function buildUI() {
    root.innerHTML = `
      <div id="iif-header">
        <div>
          <h2>📱 Inactive Followers</h2>
          <span>Trova follower inattivi su Instagram</span>
        </div>
        <button id="iif-close">✕</button>
      </div>
      <div id="iif-settings">
        <label>
          <input type="checkbox" id="iif-no-posts" ${state.settings.includeNoPosts ? 'checked' : ''}>
          Includi account con <b>0 post</b>
        </label>
        <label>
          <input type="checkbox" id="iif-check-last" ${state.settings.checkLastPost ? 'checked' : ''}>
          Controlla data ultimo post (più lento)
        </label>
        <label class="row">
          <span>Inattivi da almeno</span>
          <select id="iif-months">
            <option value="3" ${state.settings.inactivityMonths===3?'selected':''}>3 mesi</option>
            <option value="6" ${state.settings.inactivityMonths===6?'selected':''}>6 mesi</option>
            <option value="12" ${state.settings.inactivityMonths===12?'selected':''}>1 anno</option>
            <option value="24" ${state.settings.inactivityMonths===24?'selected':''}>2 anni</option>
          </select>
        </label>
      </div>
      <button id="iif-run">▶ RUN</button>
      <div id="iif-status"></div>
      <div id="iif-progress-bar"><div id="iif-progress-fill"></div></div>
      <div id="iif-actions" style="display:none">
        <button id="iif-select-all">☐ Seleziona tutti</button>
        <button id="iif-remove-btn" disabled>🗑️ Rimuovi selezionati (0)</button>
      </div>
      <div id="iif-count" style="display:none"></div>
      <div id="iif-list"></div>
    `;

    document.getElementById('iif-close').onclick = () => root.remove();
    document.getElementById('iif-no-posts').onchange = e => { state.settings.includeNoPosts = e.target.checked; };
    document.getElementById('iif-check-last').onchange = e => { state.settings.checkLastPost = e.target.checked; };
    document.getElementById('iif-months').onchange = e => { state.settings.inactivityMonths = parseInt(e.target.value); };

    document.getElementById('iif-run').onclick = async () => {
      if (state.scanning) return;
      document.getElementById('iif-run').disabled = true;
      document.getElementById('iif-actions').style.display = 'none';
      document.getElementById('iif-count').style.display = 'none';
      document.getElementById('iif-list').innerHTML = '';
      await runScan();
      document.getElementById('iif-run').disabled = false;
    };

    document.getElementById('iif-select-all').onclick = () => {
      const all = state.inactiveUsers.map(u => u.pk);
      if (state.selected.size === all.length) state.selected.clear();
      else all.forEach(id => state.selected.add(id));
      renderResults();
    };

    document.getElementById('iif-remove-btn').onclick = removeSelected;
  }

  function setStatus(msg) {
    const el = document.getElementById('iif-status');
    if (el) el.textContent = msg;
  }

  function setProgress(current, total, label) {
    const fill = document.getElementById('iif-progress-fill');
    if (fill && total > 0) fill.style.width = `${Math.round((current / total) * 100)}%`;
    if (label) setStatus(label);
  }

  function showScanning() {
    const list = document.getElementById('iif-list');
    if (list) list.innerHTML = `<div id="iif-empty">🔍 Scansione in corso...<br><small>Questo può richiedere diversi minuti.</small></div>`;
    const actions = document.getElementById('iif-actions');
    if (actions) actions.style.display = 'none';
  }

  function formatDate(date) {
    if (!date) return '';
    return date.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function renderResults() {
    const list = document.getElementById('iif-list');
    const actions = document.getElementById('iif-actions');
    const countEl = document.getElementById('iif-count');
    const removeBtn = document.getElementById('iif-remove-btn');
    const selectAllBtn = document.getElementById('iif-select-all');
    if (!list) return;

    const users = state.inactiveUsers;

    if (users.length === 0 && !state.scanning) {
      list.innerHTML = `<div id="iif-empty">🎉 Nessun follower inattivo trovato!</div>`;
      if (actions) actions.style.display = 'none';
      if (countEl) countEl.style.display = 'none';
      return;
    }

    if (users.length > 0) {
      if (actions) actions.style.display = 'flex';
      if (countEl) { countEl.style.display = 'block'; countEl.textContent = `${users.length} account inattivi trovati`; }
    }

    const selCount = state.selected.size;
    if (removeBtn) { removeBtn.disabled = selCount === 0; removeBtn.textContent = `🗑️ Rimuovi selezionati (${selCount})`; }
    if (selectAllBtn) {
      selectAllBtn.textContent = (users.length > 0 && selCount === users.length) ? '☑ Deseleziona tutti' : '☐ Seleziona tutti';
    }

    list.innerHTML = users.map(user => {
      const selected = state.selected.has(user.pk);
      const isWL = state.whitelist.has(user.pk);
      const badgeClass = user.media_count === 0 ? 'ghost' : 'inactive';
      const badgeText = user.media_count === 0 ? '👻 0 post' : `💤 ${user.reason}`;
      const lastPostStr = user.last_post_date ? `Ultimo post: ${formatDate(user.last_post_date)}` : '';
      const followersStr = user.follower_count != null ? `${user.follower_count} follower` : '';
      const subInfo = [followersStr, lastPostStr].filter(Boolean).join(' · ');
      return `
        <div class="iif-user ${selected ? 'selected' : ''}" data-id="${user.pk}">
          <input class="iif-cb" type="checkbox" ${selected ? 'checked' : ''} data-id="${user.pk}">
          <img src="${user.profile_pic_url}" alt="" onerror="this.src='https://www.instagram.com/static/images/anonymousUser.jpg/23e7b3b2a737.jpg'">
          <div class="iif-user-info">
            <strong>@${user.username}</strong>
            <span>${user.full_name || ''} ${subInfo ? '· ' + subInfo : ''}</span>
          </div>
          <span class="iif-badge ${badgeClass}">${badgeText}</span>
          <button class="iif-wl-btn" data-wl="${user.pk}">${isWL ? '🤍 WL' : '♡'}</button>
        </div>`;
    }).join('');

    list.querySelectorAll('.iif-cb').forEach(cb => {
      cb.onclick = e => {
        e.stopPropagation();
        const id = cb.dataset.id;
        if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
        renderResults();
      };
    });
    list.querySelectorAll('.iif-user').forEach(row => {
      row.onclick = e => {
        if (e.target.classList.contains('iif-cb') || e.target.classList.contains('iif-wl-btn')) return;
        const id = row.dataset.id;
        if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
        renderResults();
      };
    });
    list.querySelectorAll('.iif-wl-btn').forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        const id = btn.dataset.wl;
        if (state.whitelist.has(id)) state.whitelist.delete(id);
        else { state.whitelist.add(id); state.selected.delete(id); }
        saveWhitelist();
        renderResults();
      };
    });
  }

  buildUI();

  console.log('%c📱 Instagram Inactive Followers Finder caricato!', 'color: #833ab4; font-size: 14px; font-weight: bold;');
})();
