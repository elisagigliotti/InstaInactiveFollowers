/**
 * ============================================================
 *  📱 Instagram Profile Cleaner  v2.0
 * ============================================================
 * Pulisci follower e following in modo intelligente.
 *
 * COME USARLO:
 * 1. Vai su https://www.instagram.com e fai login
 * 2. Apri la console: Ctrl+Shift+J (Win) | ⌘+⌥+J (Mac)
 * 3. Incolla questo codice e premi Invio
 * 4. Scegli tab e filtri, poi clicca SCAN
 *
 * ⚠️ Non affiliato con Instagram/Meta. Usa a tuo rischio.
 * ============================================================
 */

(async function InstaProfileCleaner() {
  'use strict';

  if (!location.hostname.includes('instagram.com')) {
    alert('❌ Esegui su www.instagram.com');
    return;
  }
  document.getElementById('ipc-root')?.remove();

  // ══════════════════════════════════════════════
  // STATO
  // ══════════════════════════════════════════════
  const state = {
    currentUser: null,
    followers: [],
    following: [],
    results: [],
    filteredResults: [],
    selected: new Set(),
    scanning: false,
    activeTab: 'followers',
    searchQuery: '',
    sortKey: 'default',
    settings: {
      delayMs: 800,          // delay base tra richieste (ms)
      batchSize: 4,          // richieste parallele (max 5 per sicurezza)
      batchDelay: 1800,      // pausa tra batch (ms)
      inactivityMonths: 12,
      safeMode: true,        // limita rimozioni giornaliere
      dailyLimit: 50,        // max rimozioni al giorno in safe mode
      autoWhitelistVerified: true,
      // filtri follower
      f_noPosts: true,
      f_inactive: true,
      f_suspectedBot: true,
      f_noProfilePic: false,
      f_duplicates: false,
      // filtri following
      g_nonFollowers: true,
      g_inactive: false,
      g_private: false,
      // filtri interazioni
      i_postsToCheck: 6,
    },
    whitelist: new Set(JSON.parse(localStorage.getItem('ipc_whitelist') || '[]')),
    scanStats: {},
  };

  const saveWhitelist = () =>
    localStorage.setItem('ipc_whitelist', JSON.stringify([...state.whitelist]));

  // ══════════════════════════════════════════════
  // API
  // ══════════════════════════════════════════════
  const getCookie = name =>
    document.cookie.split('; ').find(r => r.startsWith(name + '='))?.split('=').slice(1).join('=');

  const HEADERS = {
    'x-csrftoken': getCookie('csrftoken'),
    'x-ig-app-id': '936619743392459',
    'x-ig-www-claim': getCookie('ig-www-claim') || '0',
    'x-asbd-id': '129477',
    'x-requested-with': 'XMLHttpRequest',
    'accept': '*/*',
  };

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function apiGet(url) {
    const res = await fetch(url, { headers: HEADERS, credentials: 'include' });
    if (res.status === 429) throw new Error('RATE_LIMIT');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json')) {
      throw new Error('Instagram ha restituito HTML invece di JSON — assicurati di essere loggato su www.instagram.com');
    }
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
      try { return await fn(); }
      catch (e) {
        if (i < retries - 1) {
          const wait = state.settings.delayMs * Math.pow(2, i + 1);
          setStatus(`⏳ Rate limit – attendo ${Math.round(wait / 1000)}s...`);
          await sleep(wait);
        } else throw e;
      }
    }
  }

  // Esegue fn su ogni elemento di arr in batch paralleli
  async function batchMap(arr, fn, onProgress) {
    const { batchSize, batchDelay } = state.settings;
    const results = [];
    for (let i = 0; i < arr.length; i += batchSize) {
      const batch = arr.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(batch.map(fn));
      results.push(...batchResults);
      if (onProgress) onProgress(Math.min(i + batchSize, arr.length), arr.length);
      if (i + batchSize < arr.length) await sleep(batchDelay);
    }
    return results;
  }

  async function fetchAllPages(getPage, onProgress) {
    const all = [];
    let nextMaxId = '';
    while (true) {
      const data = await withRetry(() => getPage(nextMaxId));
      const users = data.users || data.items || [];
      all.push(...users);
      if (onProgress) onProgress(all.length);
      if (!data.next_max_id) break;
      nextMaxId = data.next_max_id;
      await sleep(state.settings.delayMs);
    }
    return all;
  }

  const loadFollowers = uid =>
    fetchAllPages(
      mid => apiGet(`https://www.instagram.com/api/v1/friendships/${uid}/followers/?count=200${mid ? `&max_id=${mid}` : ''}`),
      n => setStatus(`📥 Follower: ${n}...`)
    );

  const loadFollowing = uid =>
    fetchAllPages(
      mid => apiGet(`https://www.instagram.com/api/v1/friendships/${uid}/following/?count=200${mid ? `&max_id=${mid}` : ''}`),
      n => setStatus(`📥 Following: ${n}...`)
    );

  const getUserInfo = async uid => {
    const d = await withRetry(() => apiGet(`https://www.instagram.com/api/v1/users/${uid}/info/`));
    return d.user;
  };

  const getLastPostDate = async uid => {
    try {
      const d = await withRetry(() => apiGet(`https://www.instagram.com/api/v1/feed/user/${uid}/?count=1`));
      const items = d.items || [];
      return items.length ? new Date(items[0].taken_at * 1000) : null;
    } catch { return null; }
  };

  const getMyPosts = async (uid, count = 12) => {
    const d = await withRetry(() => apiGet(`https://www.instagram.com/api/v1/feed/user/${uid}/?count=${count}`));
    return d.items || [];
  };

  const getPostLikers = async mediaId => {
    try {
      const d = await withRetry(() => apiGet(`https://www.instagram.com/api/v1/media/${mediaId}/likers/`));
      return d.users || [];
    } catch { return []; }
  };

  const getPostCommenters = async mediaId => {
    try {
      const d = await withRetry(() => apiGet(`https://www.instagram.com/api/v1/media/${mediaId}/comments/?count=100`));
      return (d.comments || []).map(c => c.user);
    } catch { return []; }
  };

  const removeFollower = uid =>
    apiPost(`https://www.instagram.com/api/v1/friendships/remove_follower/${uid}/`, `user_id=${uid}`);

  const unfollow = uid =>
    apiPost(`https://www.instagram.com/api/v1/friendships/destroy/${uid}/`, `user_id=${uid}`);

  // ══════════════════════════════════════════════
  // UTILITY
  // ══════════════════════════════════════════════
  const isDefaultPic = url => !url || url.includes('anonymousUser') || url.includes('default');

  const isSuspectedBot = u => {
    const fw = u.following_count || 0, fr = u.follower_count || 1;
    return fw > 7500 || (fw > 3000 && fr < 500) || (isDefaultPic(u.profile_pic_url) && /\d{5,}/.test(u.username));
  };

  const fanScore = u => {
    const fr = u.follower_count || 0, fw = u.following_count || 1;
    return +(fw / Math.max(fr, 1)).toFixed(1);
  };

  function isSimilarUsername(a, b) {
    const clean = s => s.replace(/[._\-]/g, '').replace(/\d+$/, '').toLowerCase();
    const ca = clean(a), cb = clean(b);
    if (ca.length < 3 || cb.length < 3) return false;
    return ca === cb || ca.startsWith(cb) || cb.startsWith(ca);
  }

  function addResult(user, reason, type) {
    if (state.results.find(r => r.pk === String(user.pk))) return;
    if (state.settings.autoWhitelistVerified && user.is_verified) return;
    state.results.push({ ...user, pk: String(user.pk), reason, type });
    applyFilter();
  }

  function applyFilter() {
    const q = state.searchQuery.trim().toLowerCase();
    let list = q
      ? state.results.filter(u => u.username.toLowerCase().includes(q) || (u.full_name || '').toLowerCase().includes(q))
      : [...state.results];

    switch (state.sortKey) {
      case 'followers_desc': list.sort((a, b) => (b.follower_count || 0) - (a.follower_count || 0)); break;
      case 'followers_asc':  list.sort((a, b) => (a.follower_count || 0) - (b.follower_count || 0)); break;
      case 'following_desc': list.sort((a, b) => (b.following_count || 0) - (a.following_count || 0)); break;
      case 'username':       list.sort((a, b) => a.username.localeCompare(b.username)); break;
      case 'last_post':      list.sort((a, b) => (a.last_post_date || 0) - (b.last_post_date || 0)); break;
      case 'fan_score':      list.sort((a, b) => fanScore(b) - fanScore(a)); break;
    }
    state.filteredResults = list;
    renderResults();
  }

  // ══════════════════════════════════════════════
  // SAFE MODE
  // ══════════════════════════════════════════════
  function getTodayRemoved() {
    const key = `ipc_removed_${new Date().toISOString().slice(0, 10)}`;
    return parseInt(localStorage.getItem(key) || '0');
  }
  function trackRemoved(n) {
    const key = `ipc_removed_${new Date().toISOString().slice(0, 10)}`;
    localStorage.setItem(key, String(getTodayRemoved() + n));
  }
  function safeModeRemaining() {
    return state.settings.safeMode
      ? Math.max(0, state.settings.dailyLimit - getTodayRemoved())
      : Infinity;
  }

  // ══════════════════════════════════════════════
  // EXPORT
  // ══════════════════════════════════════════════
  function exportCSV() {
    if (!state.results.length) return;
    const rows = [['Username', 'Nome', 'Follower', 'Following', 'Fan Score', 'Motivo', 'Ultimo post', 'Privato']];
    for (const u of state.results) {
      rows.push([
        u.username,
        u.full_name || '',
        u.follower_count ?? '',
        u.following_count ?? '',
        fanScore(u),
        u.reason,
        u.last_post_date ? formatDate(u.last_post_date) : '',
        u.is_private ? 'Sì' : 'No',
      ]);
    }
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ipc_${state.activeTab}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function exportWhitelist() {
    const blob = new Blob([JSON.stringify([...state.whitelist], null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ipc_whitelist.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importWhitelist() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const ids = JSON.parse(ev.target.result);
          if (!Array.isArray(ids)) throw new Error();
          ids.forEach(id => state.whitelist.add(String(id)));
          saveWhitelist();
          setStatus(`✅ Whitelist importata: ${ids.length} account.`);
          applyFilter();
        } catch { setStatus('❌ File whitelist non valido.'); }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  // ══════════════════════════════════════════════
  // STATISTICHE
  // ══════════════════════════════════════════════
  function computeStats() {
    const counts = {};
    for (const u of state.results) counts[u.type] = (counts[u.type] || 0) + 1;
    return counts;
  }

  function statsHTML() {
    const counts = computeStats();
    const labels = {
      ghost: '👻 0 post', inactive: '💤 Inattivi', bot: '🤖 Bot',
      nopic: '📷 No foto', nonfollower: '🔄 Non ti seguono',
      private: '🔒 Privati', nointeraction: '💬 Mai interagito', duplicate: '👥 Duplicati',
    };
    const total = state.results.length;
    if (!total) return '';
    return `<div id="ipc-stats">
      ${Object.entries(counts).map(([k, v]) =>
        `<span class="ipc-stat">${labels[k] || k} <b>${v}</b></span>`
      ).join('')}
    </div>`;
  }

  // ══════════════════════════════════════════════
  // SCANSIONE FOLLOWER
  // ══════════════════════════════════════════════
  async function scanFollowers() {
    state.followers = await loadFollowers(state.currentUser.pk);
    const total = state.followers.length;
    setStatus(`✅ ${total} follower. Analisi in corso...`);

    const threshold = new Date();
    threshold.setMonth(threshold.getMonth() - state.settings.inactivityMonths);

    // Filtro senza API: no foto profilo
    const needsAPI = [];
    for (const f of state.followers) {
      if (state.whitelist.has(String(f.pk))) continue;
      if (state.settings.f_noProfilePic && isDefaultPic(f.profile_pic_url)) {
        addResult(f, '📷 Nessuna foto', 'nopic');
      } else {
        needsAPI.push(f);
      }
    }

    // Batch parallelo per user info
    let done = 0;
    await batchMap(needsAPI, async follower => {
      try {
        const info = await getUserInfo(follower.pk);
        const u = { ...follower, ...info };
        const mediaCount = info?.media_count;

        if (state.settings.f_noPosts && mediaCount === 0) {
          addResult(u, '👻 0 post', 'ghost');
        } else if (state.settings.f_suspectedBot && isSuspectedBot(u)) {
          addResult(u, '🤖 Bot sospetto', 'bot');
        } else if (state.settings.f_inactive && mediaCount > 0) {
          const lastPost = await getLastPostDate(follower.pk);
          if (lastPost && lastPost < threshold) {
            const months = Math.floor((Date.now() - lastPost) / (1000 * 60 * 60 * 24 * 30));
            addResult({ ...u, last_post_date: lastPost }, `💤 ${months} mesi fa`, 'inactive');
          }
        }
      } catch (e) { console.warn(`[IPC] skip @${follower.username}:`, e.message); }
    }, (cur, tot) => {
      done = cur;
      setProgress(cur, tot, `Analisi follower: ${cur}/${tot}`);
    });

    // Duplicate detection (solo nomi)
    if (state.settings.f_duplicates) {
      const allUsers = state.followers;
      for (let i = 0; i < allUsers.length; i++) {
        for (let j = i + 1; j < allUsers.length; j++) {
          if (isSimilarUsername(allUsers[i].username, allUsers[j].username)) {
            addResult(allUsers[j], `👥 Simile a @${allUsers[i].username}`, 'duplicate');
          }
        }
      }
    }
  }

  // ══════════════════════════════════════════════
  // SCANSIONE FOLLOWING
  // ══════════════════════════════════════════════
  async function scanFollowing() {
    state.following = await loadFollowing(state.currentUser.pk);

    let followerSet = null;
    if (state.settings.g_nonFollowers) {
      state.followers = await loadFollowers(state.currentUser.pk);
      followerSet = new Set(state.followers.map(u => String(u.pk)));
    }

    const threshold = new Date();
    threshold.setMonth(threshold.getMonth() - state.settings.inactivityMonths);
    const total = state.following.length;

    // Non-followers: nessuna API extra, solo confronto liste
    const needsInfo = [];
    for (const u of state.following) {
      if (state.whitelist.has(String(u.pk))) continue;
      let tagged = false;
      if (state.settings.g_nonFollowers && followerSet && !followerSet.has(String(u.pk))) {
        addResult(u, '🔄 Non ti segue', 'nonfollower');
        tagged = true;
      }
      if (state.settings.g_private && u.is_private && !tagged) {
        addResult(u, '🔒 Account privato', 'private');
        tagged = true;
      }
      if (state.settings.g_inactive) needsInfo.push(u);
    }

    // Batch per inattivi
    if (needsInfo.length > 0) {
      await batchMap(needsInfo, async u => {
        try {
          const info = await getUserInfo(u.pk);
          const mediaCount = info?.media_count;
          if (mediaCount === 0) {
            addResult({ ...u, ...info }, '👻 0 post', 'ghost');
          } else if (mediaCount > 0) {
            const lastPost = await getLastPostDate(u.pk);
            if (lastPost && lastPost < threshold) {
              const months = Math.floor((Date.now() - lastPost) / (1000 * 60 * 60 * 24 * 30));
              addResult({ ...u, ...info, last_post_date: lastPost }, `💤 ${months} mesi fa`, 'inactive');
            }
          }
        } catch (e) { console.warn(`[IPC] skip @${u.username}:`, e.message); }
      }, (cur, tot) => setProgress(cur, tot, `Analisi following: ${cur}/${tot}`));
    }
  }

  // ══════════════════════════════════════════════
  // SCANSIONE INTERAZIONI
  // ══════════════════════════════════════════════
  async function scanInteractions() {
    setStatus('📥 Caricamento tuoi post recenti...');
    state.followers = await loadFollowers(state.currentUser.pk);
    const posts = await getMyPosts(state.currentUser.pk, state.settings.i_postsToCheck);

    if (!posts.length) {
      setStatus('❌ Nessun post trovato. Hai post pubblici?');
      return;
    }

    setStatus(`🔍 Analisi interazioni su ${posts.length} post...`);
    const interactors = new Set();

    await batchMap(posts, async post => {
      const [likers, commenters] = await Promise.all([
        getPostLikers(post.pk || post.id),
        getPostCommenters(post.pk || post.id),
      ]);
      likers.forEach(u => interactors.add(String(u.pk)));
      commenters.forEach(u => u && interactors.add(String(u.pk)));
    }, (cur, tot) => setProgress(cur, tot, `Analisi post: ${cur}/${tot}`));

    setStatus(`🔍 Confronto con ${state.followers.length} follower...`);
    let checked = 0;
    for (const follower of state.followers) {
      checked++;
      setProgress(checked, state.followers.length, `Confronto: ${checked}/${state.followers.length}`);
      if (state.whitelist.has(String(follower.pk))) continue;
      if (!interactors.has(String(follower.pk))) {
        addResult(follower, '💬 Mai interagito', 'nointeraction');
      }
    }
  }

  // ══════════════════════════════════════════════
  // AZIONE RIMOZIONE
  // ══════════════════════════════════════════════
  async function executeAction() {
    const toProcess = [...state.selected];
    if (!toProcess.length) return;

    const isFollowers = state.activeTab !== 'following';
    const label = isFollowers ? 'Rimuovi follower' : 'Smetti di seguire';
    const remaining = safeModeRemaining();

    if (state.settings.safeMode && toProcess.length > remaining) {
      const cont = confirm(
        `⚠️ Safe Mode attiva.\n` +
        `Rimozioni rimaste oggi: ${remaining}/${state.settings.dailyLimit}\n` +
        `Stai cercando di rimuovere ${toProcess.length} account.\n\n` +
        `Procedo con i primi ${remaining}?`
      );
      if (!cont) return;
    } else if (!confirm(`${label}: ${toProcess.length} account. Continuare?`)) return;

    const limit = state.settings.safeMode ? Math.min(toProcess.length, remaining) : toProcess.length;
    let done = 0;

    for (const userId of toProcess.slice(0, limit)) {
      try {
        if (isFollowers) await removeFollower(userId);
        else await unfollow(userId);
        done++;
        trackRemoved(1);
        state.results = state.results.filter(u => u.pk !== userId);
        state.selected.delete(userId);
        setProgress(done, limit, `${label}: ${done}/${limit}...`);
        applyFilter();
        await sleep(state.settings.delayMs * 2);
      } catch (e) { console.warn(`[IPC] Errore ${userId}:`, e.message); }
    }
    setStatus(`✅ ${label}: ${done} account. Rimasti oggi: ${safeModeRemaining()}.`);
    updateStatsBar();
  }

  // ══════════════════════════════════════════════
  // UI
  // ══════════════════════════════════════════════
  const CSS = `
    #ipc-root *, #ipc-root *::before, #ipc-root *::after {
      box-sizing: border-box;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    #ipc-root {
      position: fixed; top: 14px; right: 14px; z-index: 999999;
      width: 430px; max-height: 93vh;
      background: #fff; border-radius: 18px;
      box-shadow: 0 14px 52px rgba(0,0,0,0.24);
      display: flex; flex-direction: column; overflow: hidden; border: 1px solid #e0e0e0;
    }
    /* Header */
    #ipc-header {
      background: linear-gradient(135deg, #833ab4 0%, #fd1d1d 55%, #fcb045 100%);
      color: #fff; padding: 13px 16px;
      display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;
    }
    #ipc-header h2 { margin: 0; font-size: 14px; font-weight: 800; }
    #ipc-header small { font-size: 10px; opacity: 0.8; }
    #ipc-hright { display: flex; align-items: center; gap: 6px; }
    .ipc-icon-btn {
      background: rgba(255,255,255,0.2); border: none; border-radius: 8px;
      color: #fff; cursor: pointer; padding: 4px 8px; font-size: 13px;
    }
    .ipc-icon-btn:hover { background: rgba(255,255,255,0.35); }
    /* Tabs */
    #ipc-tabs { display: flex; border-bottom: 1px solid #eee; flex-shrink: 0; background: #fafafa; }
    .ipc-tab {
      flex: 1; padding: 9px 4px; border: none; background: none;
      font-size: 12px; font-weight: 600; color: #999; cursor: pointer;
      border-bottom: 2px solid transparent; transition: all 0.15s;
    }
    .ipc-tab.active { color: #833ab4; border-bottom-color: #833ab4; background: #fff; }
    /* Filters */
    #ipc-filters {
      padding: 10px 14px 8px; border-bottom: 1px solid #f0f0f0;
      background: #fafafa; flex-shrink: 0;
    }
    .ipc-chips { display: flex; flex-wrap: wrap; gap: 5px; }
    .ipc-chip {
      background: #fff; border: 1.5px solid #ddd; border-radius: 20px;
      padding: 3px 10px; font-size: 11px; font-weight: 600;
      cursor: pointer; color: #555; transition: all 0.15s; user-select: none;
    }
    .ipc-chip.on { background: #f0e8ff; border-color: #833ab4; color: #833ab4; }
    .ipc-sub { display: flex; align-items: center; gap: 6px; margin-top: 7px; font-size: 11px; color: #777; }
    .ipc-sub select, .ipc-sub input[type=number] {
      border: 1px solid #ddd; border-radius: 7px;
      padding: 2px 7px; font-size: 11px; background: #fff; color: #333;
    }
    .ipc-sub input[type=number] { width: 54px; }
    /* Scan */
    #ipc-scan {
      margin: 8px 14px; padding: 9px;
      background: linear-gradient(135deg, #833ab4, #fd1d1d);
      color: #fff; border: none; border-radius: 10px;
      font-size: 13px; font-weight: 700; cursor: pointer; flex-shrink: 0;
      transition: opacity 0.2s;
    }
    #ipc-scan:hover { opacity: 0.88; }
    #ipc-scan:disabled { opacity: 0.4; cursor: not-allowed; }
    /* Status */
    #ipc-status { padding: 3px 14px; font-size: 11px; color: #777; min-height: 20px; flex-shrink: 0; }
    #ipc-bar { height: 3px; background: #f0f0f0; margin: 0 14px 6px; border-radius: 2px; overflow: hidden; flex-shrink: 0; }
    #ipc-fill { height: 100%; width: 0%; background: linear-gradient(90deg, #833ab4, #fd1d1d); transition: width 0.2s; }
    /* Stats */
    #ipc-stats {
      display: flex; flex-wrap: wrap; gap: 5px; padding: 4px 14px 6px;
      flex-shrink: 0; border-bottom: 1px solid #f5f5f5;
    }
    .ipc-stat {
      background: #f5f5f5; border-radius: 20px;
      padding: 2px 9px; font-size: 10px; color: #555;
    }
    .ipc-stat b { color: #333; }
    /* Toolbar */
    #ipc-toolbar { display: none; flex-wrap: wrap; gap: 5px; padding: 6px 14px; flex-shrink: 0; }
    #ipc-search {
      flex: 1; min-width: 100px; padding: 6px 10px;
      border: 1.5px solid #ddd; border-radius: 8px; font-size: 12px; color: #333;
    }
    #ipc-search:focus { outline: none; border-color: #833ab4; }
    #ipc-sort {
      padding: 6px 8px; border: 1.5px solid #ddd; border-radius: 8px;
      font-size: 12px; background: #fff; color: #333; cursor: pointer;
    }
    #ipc-export-btn {
      padding: 6px 10px; border: 1.5px solid #ddd; border-radius: 8px;
      background: #fff; font-size: 12px; cursor: pointer; color: #555; white-space: nowrap;
    }
    #ipc-export-btn:hover { background: #f5f5f5; }
    #ipc-toolbar-row2 { display: flex; gap: 5px; width: 100%; }
    #ipc-select-all {
      flex: 1; padding: 6px; font-size: 12px; font-weight: 600;
      border: 1.5px solid #ddd; border-radius: 8px; background: #fff; cursor: pointer; color: #333;
    }
    #ipc-select-all:hover { background: #f5f5f5; }
    #ipc-action-btn {
      flex: 2; padding: 6px 8px; font-size: 12px; font-weight: 700;
      background: #ed4956; color: #fff; border: none; border-radius: 8px; cursor: pointer;
    }
    #ipc-action-btn:hover { background: #c0392b; }
    #ipc-action-btn:disabled { background: #ccc; cursor: not-allowed; }
    #ipc-count { font-size: 10px; color: #bbb; padding: 0 14px 4px; text-align: right; flex-shrink: 0; }
    /* Safe mode badge */
    #ipc-safe-badge {
      font-size: 10px; padding: 2px 9px;
      background: #e8f5e9; color: #2e7d32; border-radius: 20px;
      flex-shrink: 0; align-self: center;
    }
    #ipc-safe-badge.warn { background: #fff3e0; color: #e65100; }
    /* List */
    #ipc-list { overflow-y: auto; flex: 1; padding: 0 6px 8px; }
    .ipc-empty { text-align: center; padding: 30px 16px; color: #ccc; font-size: 13px; line-height: 1.8; }
    /* User row */
    .ipc-user {
      display: flex; align-items: center; gap: 8px;
      padding: 7px 8px; border-radius: 10px; cursor: pointer; transition: background 0.1s;
    }
    .ipc-user:hover { background: #f8f8f8; }
    .ipc-user.sel { background: #fff0f0; }
    .ipc-user img {
      width: 38px; height: 38px; border-radius: 50%;
      object-fit: cover; flex-shrink: 0; border: 1.5px solid #eee;
    }
    .ipc-info { flex: 1; min-width: 0; }
    .ipc-info strong { display: block; font-size: 12px; color: #111; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ipc-info span { font-size: 10px; color: #aaa; }
    .ipc-row2 { display: flex; align-items: center; gap: 4px; }
    .ipc-badge { font-size: 10px; padding: 2px 7px; border-radius: 20px; font-weight: 700; white-space: nowrap; flex-shrink: 0; }
    .ipc-badge.ghost         { background: #f0f0f0; color: #555; }
    .ipc-badge.inactive       { background: #fff3cd; color: #856404; }
    .ipc-badge.bot            { background: #fde8e8; color: #c0392b; }
    .ipc-badge.nopic          { background: #e8f4fd; color: #2980b9; }
    .ipc-badge.nonfollower    { background: #e8f0ff; color: #3d5af1; }
    .ipc-badge.private        { background: #f0f0f0; color: #666; }
    .ipc-badge.nointeraction  { background: #fef9e7; color: #9a6700; }
    .ipc-badge.duplicate      { background: #fde8f5; color: #9b59b6; }
    .ipc-fs { font-size: 9px; color: #bbb; }
    .ipc-fs.high { color: #e74c3c; }
    .ipc-cb { width: 16px; height: 16px; cursor: pointer; flex-shrink: 0; }
    .ipc-wl { background: none; border: 1px solid #e5e5e5; border-radius: 6px; padding: 2px 6px; font-size: 10px; cursor: pointer; color: #888; flex-shrink: 0; }
    .ipc-wl:hover { background: #f5f5f5; }
    /* Settings panel */
    #ipc-settings-panel {
      display: none; position: absolute; top: 0; left: 0; right: 0; bottom: 0;
      background: #fff; z-index: 10; border-radius: 18px; overflow-y: auto; padding: 16px;
    }
    #ipc-settings-panel h3 { font-size: 14px; margin-bottom: 14px; }
    .ipc-set-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 0; border-bottom: 1px solid #f5f5f5; font-size: 13px; color: #333;
    }
    .ipc-set-row:last-child { border-bottom: none; }
    .ipc-set-row input[type=checkbox] { width: 18px; height: 18px; cursor: pointer; }
    .ipc-set-row input[type=number], .ipc-set-row select {
      border: 1px solid #ddd; border-radius: 8px; padding: 3px 8px;
      font-size: 12px; width: 80px;
    }
    .ipc-set-desc { font-size: 11px; color: #aaa; margin-top: 1px; }
    #ipc-settings-close {
      width: 100%; padding: 10px; margin-top: 14px;
      background: linear-gradient(135deg, #833ab4, #fd1d1d);
      color: #fff; border: none; border-radius: 10px; font-size: 13px; font-weight: 700; cursor: pointer;
    }
  `;

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'ipc-root';
  document.body.appendChild(root);

  // ══════════════════════════════════════════════
  // RENDERING UI
  // ══════════════════════════════════════════════
  function filterChipsHTML() {
    const s = state.settings;
    if (state.activeTab === 'followers') return `
      <div class="ipc-chips">
        <label class="ipc-chip ${s.f_noPosts?'on':''}" data-key="f_noPosts">👻 0 post</label>
        <label class="ipc-chip ${s.f_inactive?'on':''}" data-key="f_inactive">💤 Inattivi</label>
        <label class="ipc-chip ${s.f_suspectedBot?'on':''}" data-key="f_suspectedBot">🤖 Bot</label>
        <label class="ipc-chip ${s.f_noProfilePic?'on':''}" data-key="f_noProfilePic">📷 No foto</label>
        <label class="ipc-chip ${s.f_duplicates?'on':''}" data-key="f_duplicates">👥 Duplicati</label>
      </div>
      <div class="ipc-sub">
        <span>Inattivi da</span>
        <select id="ipc-months">
          <option value="3"  ${s.inactivityMonths===3?'selected':''}>3 mesi</option>
          <option value="6"  ${s.inactivityMonths===6?'selected':''}>6 mesi</option>
          <option value="12" ${s.inactivityMonths===12?'selected':''}>1 anno</option>
          <option value="24" ${s.inactivityMonths===24?'selected':''}>2 anni</option>
        </select>
      </div>`;

    if (state.activeTab === 'following') return `
      <div class="ipc-chips">
        <label class="ipc-chip ${s.g_nonFollowers?'on':''}" data-key="g_nonFollowers">🔄 Non ti seguono</label>
        <label class="ipc-chip ${s.g_inactive?'on':''}" data-key="g_inactive">💤 Inattivi</label>
        <label class="ipc-chip ${s.g_private?'on':''}" data-key="g_private">🔒 Privati</label>
      </div>
      <div class="ipc-sub">
        <span>Inattivi da</span>
        <select id="ipc-months">
          <option value="3"  ${s.inactivityMonths===3?'selected':''}>3 mesi</option>
          <option value="6"  ${s.inactivityMonths===6?'selected':''}>6 mesi</option>
          <option value="12" ${s.inactivityMonths===12?'selected':''}>1 anno</option>
          <option value="24" ${s.inactivityMonths===24?'selected':''}>2 anni</option>
        </select>
      </div>`;

    return `
      <div class="ipc-sub" style="flex-wrap:wrap;gap:8px;">
        <span>Analizza gli ultimi</span>
        <input type="number" id="ipc-posts-count" min="1" max="24" value="${s.i_postsToCheck}">
        <span>post per trovare follower che non hanno mai messo like o commento.</span>
      </div>`;
  }

  function buildUI() {
    const isFollowers = state.activeTab !== 'following';
    const actionLabel = isFollowers ? '🗑️ Rimuovi follower' : '➖ Smetti di seguire';
    const safe = safeModeRemaining();

    root.innerHTML = `
      <div id="ipc-header">
        <div>
          <h2>📱 Instagram Profile Cleaner</h2>
          <small>v2.0 · Pulisci follower e following</small>
        </div>
        <div id="ipc-hright">
          <button class="ipc-icon-btn" id="ipc-wl-export" title="Esporta whitelist">🤍</button>
          <button class="ipc-icon-btn" id="ipc-wl-import" title="Importa whitelist">📂</button>
          <button class="ipc-icon-btn" id="ipc-settings-btn" title="Impostazioni">⚙️</button>
          <button class="ipc-icon-btn" id="ipc-close">✕</button>
        </div>
      </div>

      <div id="ipc-tabs">
        <button class="ipc-tab ${state.activeTab==='followers'?'active':''}" data-tab="followers">👥 Follower</button>
        <button class="ipc-tab ${state.activeTab==='following'?'active':''}" data-tab="following">➡️ Following</button>
        <button class="ipc-tab ${state.activeTab==='interactions'?'active':''}" data-tab="interactions">💬 Interazioni</button>
      </div>

      <div id="ipc-filters">${filterChipsHTML()}</div>
      <button id="ipc-scan">🔍 SCAN</button>
      <div id="ipc-status"></div>
      <div id="ipc-bar"><div id="ipc-fill"></div></div>

      <div id="ipc-toolbar">
        <input id="ipc-search" type="text" placeholder="🔍 Cerca username..." value="${state.searchQuery}">
        <select id="ipc-sort">
          <option value="default">Ordine scan</option>
          <option value="username">A–Z username</option>
          <option value="followers_desc">Più follower</option>
          <option value="followers_asc">Meno follower</option>
          <option value="following_desc">Più following</option>
          <option value="fan_score">Fan score ↑</option>
          <option value="last_post">Ultimo post</option>
        </select>
        <button id="ipc-export-btn" title="Esporta CSV">📊 CSV</button>
        <div id="ipc-toolbar-row2">
          <button id="ipc-select-all">☐ Tutti</button>
          <button id="ipc-action-btn" disabled>${actionLabel} (0)</button>
          ${state.settings.safeMode ? `<span id="ipc-safe-badge" class="${safe < 10 ? 'warn' : ''}">🛡️ ${safe} oggi</span>` : ''}
        </div>
      </div>

      <div id="ipc-count"></div>
      <div id="ipc-list"><div class="ipc-empty">Scegli i filtri e clicca <strong>SCAN</strong><br><small>⚡ Scansione parallela per massima velocità</small></div></div>

      <div id="ipc-settings-panel">
        <h3>⚙️ Impostazioni avanzate</h3>
        <div class="ipc-set-row">
          <div><div>Safe Mode</div><div class="ipc-set-desc">Limita rimozioni giornaliere</div></div>
          <input type="checkbox" id="cfg-safeMode" ${state.settings.safeMode?'checked':''}>
        </div>
        <div class="ipc-set-row">
          <div><div>Limite giornaliero</div><div class="ipc-set-desc">Max rimozioni al giorno</div></div>
          <input type="number" id="cfg-dailyLimit" min="5" max="200" value="${state.settings.dailyLimit}">
        </div>
        <div class="ipc-set-row">
          <div><div>Batch size</div><div class="ipc-set-desc">Richieste parallele (2–5)</div></div>
          <input type="number" id="cfg-batchSize" min="2" max="5" value="${state.settings.batchSize}">
        </div>
        <div class="ipc-set-row">
          <div><div>Pausa tra batch (ms)</div><div class="ipc-set-desc">Più basso = più veloce ma più rischioso</div></div>
          <input type="number" id="cfg-batchDelay" min="800" max="5000" step="100" value="${state.settings.batchDelay}">
        </div>
        <div class="ipc-set-row">
          <div><div>Auto-whitelist verificati</div><div class="ipc-set-desc">Esclude account con ✓ blu</div></div>
          <input type="checkbox" id="cfg-autoVerified" ${state.settings.autoWhitelistVerified?'checked':''}>
        </div>
        <div class="ipc-set-row">
          <div><div>Post da analizzare</div><div class="ipc-set-desc">Per scansione Interazioni</div></div>
          <select id="cfg-postsToCheck">
            <option value="3"  ${state.settings.i_postsToCheck===3?'selected':''}>3 post</option>
            <option value="6"  ${state.settings.i_postsToCheck===6?'selected':''}>6 post</option>
            <option value="12" ${state.settings.i_postsToCheck===12?'selected':''}>12 post</option>
            <option value="24" ${state.settings.i_postsToCheck===24?'selected':''}>24 post</option>
          </select>
        </div>
        <button id="ipc-settings-close">✓ Salva e chiudi</button>
      </div>
    `;
    bindEvents();
    applyFilter();
  }

  function bindEvents() {
    root.querySelector('#ipc-close').onclick = () => root.remove();

    root.querySelectorAll('.ipc-tab').forEach(btn => {
      btn.onclick = () => {
        state.activeTab = btn.dataset.tab;
        state.results = [];
        state.filteredResults = [];
        state.selected.clear();
        state.searchQuery = '';
        buildUI();
      };
    });

    root.querySelectorAll('.ipc-chip').forEach(chip => {
      chip.onclick = () => {
        const key = chip.dataset.key;
        state.settings[key] = !state.settings[key];
        chip.classList.toggle('on', state.settings[key]);
      };
    });

    const monthsSel = root.querySelector('#ipc-months');
    if (monthsSel) monthsSel.onchange = e => { state.settings.inactivityMonths = parseInt(e.target.value); };

    const postsCnt = root.querySelector('#ipc-posts-count');
    if (postsCnt) postsCnt.onchange = e => { state.settings.i_postsToCheck = parseInt(e.target.value); };

    root.querySelector('#ipc-scan').onclick = async () => {
      if (state.scanning) return;
      state.scanning = true;
      state.results = [];
      state.filteredResults = [];
      state.selected.clear();
      state.searchQuery = '';
      root.querySelector('#ipc-scan').disabled = true;
      root.querySelector('#ipc-toolbar').style.display = 'none';
      root.querySelector('#ipc-fill').style.width = '0%';
      root.querySelector('#ipc-list').innerHTML = `<div class="ipc-empty">🔍 Scansione in corso...<br><small>Potrebbe richiedere qualche minuto.</small></div>`;
      root.querySelector('#ipc-count').textContent = '';
      // clear stats
      const oldStats = root.querySelector('#ipc-stats');
      if (oldStats) oldStats.remove();

      try {
        state.currentUser = { pk: getCookie('ds_user_id') };
        if (!state.currentUser.pk) throw new Error('Non sei loggato su Instagram.');
        if (state.activeTab === 'followers') await scanFollowers();
        else if (state.activeTab === 'following') await scanFollowing();
        else await scanInteractions();
        state.scanning = false;
        setStatus(`✅ Scansione completata — ${state.results.length} account trovati.`);
        updateStatsBar();
        applyFilter();
      } catch (e) {
        state.scanning = false;
        setStatus(`❌ ${e.message}`);
        console.error('[IPC]', e);
      }
      root.querySelector('#ipc-scan').disabled = false;
    };

    // Search
    const search = root.querySelector('#ipc-search');
    if (search) {
      search.oninput = e => { state.searchQuery = e.target.value; applyFilter(); };
    }

    // Sort
    const sort = root.querySelector('#ipc-sort');
    if (sort) {
      sort.value = state.sortKey;
      sort.onchange = e => { state.sortKey = e.target.value; applyFilter(); };
    }

    // Export
    root.querySelector('#ipc-export-btn')?.addEventListener('click', exportCSV);

    // Whitelist
    root.querySelector('#ipc-wl-export')?.addEventListener('click', exportWhitelist);
    root.querySelector('#ipc-wl-import')?.addEventListener('click', importWhitelist);

    // Select all
    root.querySelector('#ipc-select-all').onclick = () => {
      if (state.selected.size === state.filteredResults.length)
        state.selected.clear();
      else
        state.filteredResults.forEach(u => state.selected.add(u.pk));
      renderResults();
    };

    root.querySelector('#ipc-action-btn').onclick = executeAction;

    // Settings panel
    root.querySelector('#ipc-settings-btn').onclick = () => {
      root.querySelector('#ipc-settings-panel').style.display = 'block';
    };
    root.querySelector('#ipc-settings-close').onclick = () => {
      // Save settings
      const get = id => root.querySelector('#' + id);
      state.settings.safeMode = get('cfg-safeMode').checked;
      state.settings.dailyLimit = parseInt(get('cfg-dailyLimit').value);
      state.settings.batchSize = Math.min(5, Math.max(2, parseInt(get('cfg-batchSize').value)));
      state.settings.batchDelay = parseInt(get('cfg-batchDelay').value);
      state.settings.autoWhitelistVerified = get('cfg-autoVerified').checked;
      state.settings.i_postsToCheck = parseInt(get('cfg-postsToCheck').value);
      root.querySelector('#ipc-settings-panel').style.display = 'none';
      buildUI(); // re-render to update safe mode badge
    };
  }

  function updateStatsBar() {
    const toolbar = root.querySelector('#ipc-toolbar');
    const existing = root.querySelector('#ipc-stats');
    if (existing) existing.remove();
    if (!state.results.length) return;
    const statsEl = document.createElement('div');
    statsEl.innerHTML = statsHTML();
    root.querySelector('#ipc-bar').after(statsEl.firstElementChild);
    if (toolbar) toolbar.style.display = 'flex';
  }

  function setStatus(msg) {
    const el = root.querySelector('#ipc-status');
    if (el) el.textContent = msg;
  }

  function setProgress(cur, tot, label) {
    const fill = root.querySelector('#ipc-fill');
    if (fill && tot > 0) fill.style.width = `${Math.round((cur / tot) * 100)}%`;
    if (label) setStatus(label);
  }

  const formatDate = d =>
    d?.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' }) || '';

  const DEFAULT_PIC = 'https://www.instagram.com/static/images/anonymousUser.jpg/23e7b3b2a737.jpg';

  function renderResults() {
    const list = root.querySelector('#ipc-list');
    const actionBtn = root.querySelector('#ipc-action-btn');
    const selAllBtn = root.querySelector('#ipc-select-all');
    const countEl = root.querySelector('#ipc-count');
    if (!list) return;

    const users = state.filteredResults;
    const selCount = state.selected.size;
    const isFollowers = state.activeTab !== 'following';
    const actionLabel = isFollowers ? '🗑️ Rimuovi follower' : '➖ Smetti di seguire';

    if (!users.length) {
      if (!state.scanning) list.innerHTML = `<div class="ipc-empty">🎉 Nessun account con questi filtri.</div>`;
      if (countEl) countEl.textContent = '';
      if (actionBtn) { actionBtn.disabled = true; actionBtn.textContent = `${actionLabel} (0)`; }
      return;
    }

    if (countEl) {
      const shown = users.length;
      const total = state.results.length;
      countEl.textContent = shown === total
        ? `${total} account trovati`
        : `${shown} di ${total} (filtrati)`;
    }
    if (actionBtn) {
      actionBtn.disabled = selCount === 0;
      actionBtn.textContent = `${actionLabel} (${selCount})`;
    }
    if (selAllBtn) {
      selAllBtn.textContent = selCount === users.length ? '☑ Tutti' : '☐ Tutti';
    }

    list.innerHTML = users.map(u => {
      const sel = state.selected.has(u.pk);
      const wl = state.whitelist.has(u.pk);
      const fs = fanScore(u);
      const fsClass = fs > 10 ? 'high' : '';
      const sub = [
        u.follower_count != null ? `${u.follower_count.toLocaleString()} follower` : '',
        u.following_count != null ? `segue ${u.following_count.toLocaleString()}` : '',
        u.last_post_date ? formatDate(u.last_post_date) : '',
      ].filter(Boolean).join(' · ');
      return `
        <div class="ipc-user ${sel?'sel':''}" data-id="${u.pk}">
          <input class="ipc-cb" type="checkbox" ${sel?'checked':''} data-id="${u.pk}">
          <img src="${u.profile_pic_url || DEFAULT_PIC}" onerror="this.src='${DEFAULT_PIC}'" alt="">
          <div class="ipc-info">
            <strong>@${u.username}${u.is_verified?' ✓':''}</strong>
            <span>${sub}</span>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0;">
            <span class="ipc-badge ${u.type}">${u.reason}</span>
            ${u.following_count > 0 ? `<span class="ipc-fs ${fsClass}" title="Fan score (following/follower)">fs ${fs}</span>` : ''}
          </div>
          <button class="ipc-wl" data-wl="${u.pk}">${wl?'🤍':'♡'}</button>
        </div>`;
    }).join('');

    list.querySelectorAll('.ipc-cb').forEach(cb => {
      cb.onclick = e => {
        e.stopPropagation();
        const id = cb.dataset.id;
        state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
        renderResults();
      };
    });
    list.querySelectorAll('.ipc-user').forEach(row => {
      row.onclick = e => {
        if (e.target.classList.contains('ipc-cb') || e.target.classList.contains('ipc-wl')) return;
        const id = row.dataset.id;
        state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
        renderResults();
      };
    });
    list.querySelectorAll('.ipc-wl').forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        const id = btn.dataset.wl;
        if (state.whitelist.has(id)) state.whitelist.delete(id);
        else { state.whitelist.add(id); state.selected.delete(id); }
        saveWhitelist();
        applyFilter();
      };
    });
  }

  buildUI();
  console.log('%c📱 Instagram Profile Cleaner v2.0 caricato!', 'color:#833ab4;font-size:14px;font-weight:bold;');
  console.log('%cFunzionalità: Follower cleanup · Following cleanup · Interaction check · Export CSV · Whitelist · Safe Mode · Fan Score · Duplicati', 'color:#888;font-size:11px;');
})();
