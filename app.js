// ============================================================
// STATE
// ============================================================
let apiKey       = localStorage.getItem('openai_api_key') || '';
let currentGroup = 'A';
let analysisCache = JSON.parse(localStorage.getItem('analysis_cache') || '{}');
let currentView  = 'groups'; // 'groups' | 'all' | 'knockout'

// groupResults[matchId] = { homeGoals, awayGoals }
let groupResults = JSON.parse(localStorage.getItem('group_results') || '{}');

function saveGroupResults() { localStorage.setItem('group_results', JSON.stringify(groupResults)); pushToFirebase(); }
function saveAnalysisCache() { localStorage.setItem('analysis_cache', JSON.stringify(analysisCache)); pushToFirebase(); }

// ============================================================
// DOM
// ============================================================
const tabsEl      = document.getElementById('tabs');
const mainEl      = document.getElementById('main');
const apiInput    = document.getElementById('api-key-input');
const modalOverlay = document.getElementById('modal-overlay');
const installBtn  = document.getElementById('install-btn');

// ============================================================
// DATE HELPERS
// ============================================================
const HE_DAYS  = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
const HE_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט'];

function formatMatchDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const day   = HE_DAYS[d.getDay()];
  const date  = d.getDate();
  const month = HE_MONTHS[d.getMonth()];
  const hh    = String(d.getHours()).padStart(2,'0');
  const mm    = String(d.getMinutes()).padStart(2,'0');
  return { day, date, month, time: `${hh}:${mm}`, full: `${day} ${date} ${month} • ${hh}:${mm}` };
}

function matchStatus(iso) {
  if (!iso) return 'upcoming';
  const now  = Date.now();
  const start = new Date(iso).getTime();
  const end   = start + 105 * 60 * 1000; // ~105 min
  if (now < start) return 'upcoming';
  if (now < end)   return 'live';
  return 'finished';
}

// ============================================================
// FIREBASE AUTO-SYNC
// ============================================================
const FB_DB_URL = 'https://world-cup2026-e3eb9-default-rtdb.europe-west1.firebasedatabase.app';
let fbDb = null;
let fbRoomRef = null;
let fbListening = false;
let fbPushPending = false;

function initFirebase() {
  if (fbDb) return;
  try {
    firebase.initializeApp({ databaseURL: FB_DB_URL });
    fbDb = firebase.database();
  } catch(e) {
    if (e.code !== 'app/duplicate-app') console.warn('Firebase init:', e);
    fbDb = firebase.database();
  }
}

function fbRoomId(key) {
  let h = 5381;
  for (let i = 0; i < key.length; i++) { h = ((h << 5) + h) + key.charCodeAt(i); h |= 0; }
  return 'room_' + Math.abs(h).toString(36).padStart(8, '0');
}

function connectFirebase(key) {
  if (!key || key.length < 10) return;
  initFirebase();
  const roomId = fbRoomId(key);
  if (fbRoomRef) fbRoomRef.off();
  fbRoomRef = fbDb.ref(roomId);
  fbListening = true;

  fbRoomRef.on('value', snap => {
    if (!fbListening) return;
    const data = snap.val();
    if (!data) return;
    let changed = false;
    if (data.r && JSON.stringify(data.r) !== JSON.stringify(groupResults)) {
      groupResults = data.r;
      localStorage.setItem('group_results', JSON.stringify(groupResults));
      changed = true;
    }
    if (data.ac && JSON.stringify(data.ac) !== JSON.stringify(analysisCache)) {
      analysisCache = data.ac;
      localStorage.setItem('analysis_cache', JSON.stringify(analysisCache));
      changed = true;
    }
    if (data.ko) localStorage.setItem('ko_results', JSON.stringify(data.ko));
    if (changed) { renderGroup(currentGroup); showSyncToast('🔄 סונכרן אוטומטית'); }
  });
}

function pushToFirebase() {
  if (!fbRoomRef) return;
  if (fbPushPending) return;
  fbPushPending = true;
  setTimeout(() => {
    fbPushPending = false;
    fbRoomRef.update({
      r:  groupResults,
      ac: analysisCache,
      ko: JSON.parse(localStorage.getItem('ko_results') || '{}'),
      ts: Date.now()
    });
  }, 500);
}

// ============================================================
// SYNC BETWEEN DEVICES — modal with copy/paste code
// ============================================================
function buildSyncCode() {
  const payload = {
    k: apiKey,
    r: groupResults,
    ko: JSON.parse(localStorage.getItem('ko_results') || '{}'),
    ac: analysisCache  // ← ניתוחי AI
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let bin = '';
  bytes.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin);
}

function applySyncCode(code) {
  const clean = code.replace(/\s/g, '');
  const bin = atob(clean);
  const bytes = new Uint8Array([...bin].map(c => c.charCodeAt(0)));
  const payload = JSON.parse(new TextDecoder().decode(bytes));
  if (payload.k)  { apiKey = payload.k; localStorage.setItem('openai_api_key', apiKey); }
  if (payload.r)  { groupResults = payload.r; saveGroupResults(); }
  if (payload.ko) { localStorage.setItem('ko_results', JSON.stringify(payload.ko)); }
  if (payload.ac) { analysisCache = payload.ac; saveAnalysisCache(); }
  apiInput.value = apiKey;
  updateApiStatus();
  renderGroup(currentGroup);
}

function showSyncModal() {
  document.getElementById('sync-export-code').value = buildSyncCode();
  document.getElementById('sync-import-code').value = '';
  document.getElementById('sync-status').textContent = '';
  document.getElementById('sync-modal-overlay').style.display = 'flex';
}

function closeSyncModal() {
  document.getElementById('sync-modal-overlay').style.display = 'none';
}

function showSyncToast(msg) {
  let t = document.getElementById('sync-toast');
  if (!t) { t = document.createElement('div'); t.id = 'sync-toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('visible');
  setTimeout(() => t.classList.remove('visible'), 4000);
}

// ============================================================
// LIVE SCORES FROM ESPN
// ============================================================
const ESPN_TO_HE = {
  'Mexico': 'מקסיקו', 'South Africa': 'דרום אפריקה',
  'South Korea': 'קוריאה הדרומית', 'Czech Republic': "צ'כיה", 'Czechia': "צ'כיה",
  'Canada': 'קנדה', 'Bosnia-Herzegovina': 'בוסניה', 'Bosnia and Herzegovina': 'בוסניה', 'Bosnia & Herzegovina': 'בוסניה',
  'Qatar': 'קטאר', 'Switzerland': 'שוויץ',
  'Brazil': 'ברזיל', 'Morocco': 'מרוקו', 'Haiti': 'האיטי', 'Scotland': 'סקוטלנד',
  'United States': 'ארצות הברית', 'USA': 'ארצות הברית',
  'Paraguay': 'פרגוואי', 'Australia': 'אוסטרליה', 'Turkey': 'טורקיה',
  'Germany': 'גרמניה', "Côte d'Ivoire": 'חוף השנהב', 'Ivory Coast': 'חוף השנהב',
  'Curacao': 'קוראסאו', 'Ecuador': 'אקוודור',
  'Netherlands': 'הולנד', 'Japan': 'יפן', 'Tunisia': 'טוניסיה', 'Sweden': 'שוודיה',
  'Belgium': 'בלגיה', 'Egypt': 'מצרים', 'Iran': 'איראן', 'New Zealand': 'ניו זילנד',
  'Spain': 'ספרד', 'Cape Verde': 'כף ורדה', 'Saudi Arabia': 'ערב הסעודית', 'Uruguay': 'אורוגוואי',
  'France': 'צרפת', 'Senegal': 'סנגל', 'Norway': 'נורבגיה', 'Iraq': 'עיראק',
  'Argentina': 'ארגנטינה', 'Algeria': "אלג'יריה", 'Austria': 'אוסטריה', 'Jordan': 'ירדן',
  'Portugal': 'פורטוגל', 'Uzbekistan': 'אוזבקיסטן', 'Colombia': 'קולומביה',
  'Congo': 'קונגו', 'DR Congo': 'קונגו', 'Congo DR': 'קונגו',
  'England': 'אנגליה', 'Croatia': 'קרואטיה', 'Ghana': 'גאנה', 'Panama': 'פנמה'
};

function buildTeamIndex() {
  const idx = {};
  Object.entries(GROUPS).forEach(([grp, val]) => {
    val.teams.forEach((name, i) => { idx[name] = [grp, i]; });
  });
  return idx;
}

function getWCDates() {
  const start = new Date('2026-06-11');
  const today = new Date();
  today.setHours(23, 59, 59);
  const dates = [];
  const cur = new Date(start);
  while (cur <= today) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    dates.push(`${y}${m}${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

async function fetchLiveScores() {
  const btn = document.getElementById('live-scores-btn');
  if (btn) { btn.textContent = '⏳ מעדכן...'; btn.disabled = true; }
  try {
    const dates = getWCDates();
    const teamIdx = buildTeamIndex();
    let updated = 0;
    let totalEvents = 0;

    for (const date of dates) {
      const res = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${date}`,
        { cache: 'no-store' }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const events = data.events || [];
      totalEvents += events.length;

      events.forEach(ev => {
        const comp = ev.competitions?.[0];
        if (!comp) return;
        const finished = comp.status?.type?.completed;
        const live = comp.status?.type?.name === 'STATUS_IN_PROGRESS';
        if (!finished && !live) return;

        const homeC = comp.competitors?.find(c => c.homeAway === 'home');
        const awayC = comp.competitors?.find(c => c.homeAway === 'away');
        if (!homeC || !awayC) return;

        const homeHe = ESPN_TO_HE[homeC.team?.displayName] || ESPN_TO_HE[homeC.team?.name];
        const awayHe = ESPN_TO_HE[awayC.team?.displayName] || ESPN_TO_HE[awayC.team?.name];
        if (!homeHe || !awayHe) return;

        const homeGoals = parseInt(homeC.score ?? '0');
        const awayGoals = parseInt(awayC.score ?? '0');

        const hInfo = teamIdx[homeHe];
        const aInfo = teamIdx[awayHe];
        if (!hInfo || !aInfo || hInfo[0] !== aInfo[0]) return;

        const hi = hInfo[1], ai = aInfo[1];
        const grp = hInfo[0];
        const matchId = hi < ai ? `${grp}-${hi}-${ai}` : `${grp}-${ai}-${hi}`;
        const flipped = hi > ai;

        groupResults[matchId] = {
          homeGoals: flipped ? awayGoals : homeGoals,
          awayGoals: flipped ? homeGoals : awayGoals
        };
        updated++;
      });
    }

    if (updated > 0) {
      saveGroupResults();
      renderGroup(currentGroup);
      showSyncToast('✅ עודכנו ' + updated + ' משחקים מ-ESPN');
    } else if (totalEvents > 0) {
      showSyncToast('ℹ️ נמצאו ' + totalEvents + ' משחקים אך עדיין לא הסתיימו');
    } else {
      showSyncToast('ℹ️ ESPN: לא נמצאו משחקים');
    }
  } catch(e) {
    showSyncToast('❌ ESPN: ' + e.message);
  } finally {
    if (btn) { btn.textContent = '📡 עדכן תוצאות חי'; btn.disabled = false; }
  }
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  apiInput.value = apiKey;
  updateApiStatus();
  renderTabs();
  renderGroup('A');
  registerSW();

  document.getElementById('sync-btn').addEventListener('click', showSyncModal);
  document.getElementById('live-scores-btn').addEventListener('click', fetchLiveScores);
  document.getElementById('sync-modal-close').addEventListener('click', closeSyncModal);
  document.getElementById('sync-modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('sync-modal-overlay')) closeSyncModal();
  });
  document.getElementById('sync-copy-btn').addEventListener('click', () => {
    const code = document.getElementById('sync-export-code').value;
    navigator.clipboard.writeText(code).then(() => {
      document.getElementById('sync-status').textContent = '✅ הקוד הועתק! שלח אותו לעצמך בוואטסאפ';
    }).catch(() => {
      document.getElementById('sync-export-code').select();
      document.execCommand('copy');
      document.getElementById('sync-status').textContent = '✅ הקוד הועתק!';
    });
  });
  document.getElementById('sync-import-btn').addEventListener('click', () => {
    const code = document.getElementById('sync-import-code').value.trim();
    if (!code) { document.getElementById('sync-status').textContent = '⚠️ הדבק קוד סינכרון'; return; }
    try {
      applySyncCode(code);
      document.getElementById('sync-status').textContent = '✅ סונכרן! טוען מחדש...';
      setTimeout(() => location.reload(), 1200);
    } catch(e) {
      console.error('sync import error', e);
      document.getElementById('sync-status').textContent = '❌ ' + e.message;
    }
  });
});

// ============================================================
// API KEY
// ============================================================
apiInput.addEventListener('input', (e) => {
  apiKey = e.target.value.trim();
  localStorage.setItem('openai_api_key', apiKey);
  updateApiStatus();
});
apiInput.addEventListener('change', (e) => {
  apiKey = e.target.value.trim();
  localStorage.setItem('openai_api_key', apiKey);
  updateApiStatus();
});
apiInput.addEventListener('blur', (e) => {
  apiKey = e.target.value.trim();
  localStorage.setItem('openai_api_key', apiKey);
  updateApiStatus();
});

function updateApiStatus() {
  connectFirebase(apiKey);
  const el = document.getElementById('api-status');
  if (apiKey.length > 10) {
    el.textContent = 'מחובר ✓';
    el.className = 'api-status connected';
  } else {
    el.textContent = 'לא מחובר';
    el.className = 'api-status disconnected';
  }
}

// ============================================================
// TABS
// ============================================================
function renderTabs() {
  tabsEl.innerHTML = '';

  tabsEl.appendChild(makeTab('שלב הבתים', currentView === 'groups', () => {
    currentView = 'groups'; renderTabs(); renderGroup(currentGroup);
  }));
  tabsEl.appendChild(makeTab('📅 כל המשחקים', currentView === 'all', () => {
    currentView = 'all'; renderTabs(); renderAllMatches();
  }));
  tabsEl.appendChild(makeTab('🏆 נוקאוט', currentView === 'knockout', () => {
    currentView = 'knockout'; renderTabs(); renderKnockout();
  }));

  if (currentView === 'groups') {
    const sep = document.createElement('div');
    sep.style.cssText = 'width:1px;background:var(--border);margin:0.4rem 0;flex-shrink:0';
    tabsEl.appendChild(sep);

    tabsEl.appendChild(makeTab('כל הבתים', currentGroup === 'ALL', () => {
      currentGroup = 'ALL'; renderTabs(); renderGroup('ALL');
    }));
    Object.keys(GROUPS).forEach(key => {
      tabsEl.appendChild(makeTab(`בית ${key}`, currentGroup === key, () => {
        currentGroup = key; renderTabs(); renderGroup(key);
      }));
    });
  }
}

function makeTab(text, active, onclick) {
  const t = document.createElement('div');
  t.className = 'tab' + (active ? ' active' : '');
  t.textContent = text;
  t.onclick = onclick;
  return t;
}

// ============================================================
// STANDINGS CALCULATION
// ============================================================
function calcStandings(groupKey) {
  groupResults = JSON.parse(localStorage.getItem('group_results') || '{}');
  const teams = GROUPS[groupKey].teams;
  const stats = {};
  teams.forEach(t => { stats[t] = { p:0, w:0, d:0, l:0, gf:0, ga:0, pts:0 }; });

  generateGroupMatches(groupKey).forEach(m => {
    const r = groupResults[m.id];
    if (!r) return;
    const hg = Number(r.homeGoals), ag = Number(r.awayGoals);
    if (isNaN(hg) || isNaN(ag)) return;
    const h = stats[m.home], a = stats[m.away];
    h.p++; h.gf += hg; h.ga += ag;
    a.p++; a.gf += ag; a.ga += hg;
    if (hg > ag)      { h.w++; h.pts += 3; a.l++; }
    else if (hg < ag) { a.w++; a.pts += 3; h.l++; }
    else              { h.d++; h.pts++; a.d++; a.pts++; }
  });

  return teams
    .map(t => ({ name: t, ...stats[t], gd: stats[t].gf - stats[t].ga }))
    .sort((a, b) =>
      b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.name.localeCompare(b.name)
    );
}

function updateAllGroupStandings() {
  Object.keys(GROUPS).forEach(key => {
    const sorted = calcStandings(key);
    groupStandings[key] = sorted.map(t => t.name);
  });
  saveGroupStandings();
}

// ============================================================
// RENDER GROUP
// ============================================================
function renderGroup(groupKey) {
  updateAllGroupStandings();
  if (groupKey === 'ALL') {
    mainEl.innerHTML = Object.keys(GROUPS).map(k => groupHTML(k)).join('');
  } else {
    mainEl.innerHTML = groupHTML(groupKey);
  }
  attachGroupListeners();
}

function groupHTML(key) {
  const standings = calcStandings(key);
  const matches   = generateGroupMatches(key);
  const totalMatches = 6;
  const playedMatches = matches.filter(m => groupResults[m.id] !== undefined).length;
  const groupDone = playedMatches === totalMatches;

  const standingsRows = standings.map((s, i) => {
    const qualify = i < 2;
    const is3rd   = i === 2;
    const gdStr   = s.gd > 0 ? '+' + s.gd : String(s.gd);
    return `
      <tr>
        <td><span class="pos ${qualify ? 'qualify' : is3rd ? 'third-pos' : ''}">${i + 1}</span></td>
        <td><div class="team-cell">${flagImg(s.name)} ${s.name}</div></td>
        <td>${s.p}</td>
        <td class="w-cell">${s.w}</td>
        <td>${s.d}</td>
        <td>${s.l}</td>
        <td class="gf-ga">${s.gf}:${s.ga}</td>
        <td class="gd ${s.gd > 0 ? 'gd-pos' : s.gd < 0 ? 'gd-neg' : ''}">${gdStr}</td>
        <td class="pts-cell"><strong>${s.pts}</strong></td>
      </tr>`;
  }).join('');

  const matchCards = matches.map(m => {
    const r        = groupResults[m.id];
    const analyzed = analysisCache[m.id];
    const status   = r ? 'finished' : matchStatus(m.date);
    const dateFmt  = formatMatchDate(m.date);
    const classes  = ['match-card',
      r        ? 'has-score'  : '',
      status === 'live'     ? 'is-live'    : '',
      status === 'finished' ? 'is-finished': '',
      analyzed ? 'analyzed'  : ''
    ].filter(Boolean).join(' ');

    const scoreDisplay = r
      ? `<span class="score-badge">${r.homeGoals}:${r.awayGoals}</span>`
      : status === 'live'
        ? `<span class="vs-badge live-pulse">🔴 חי</span>`
        : `<span class="vs-badge">VS</span>`;

    const dateChip = dateFmt ? `
      <div class="match-date-row">
        <span class="match-date-chip ${status === 'live' ? 'live' : status === 'finished' ? 'done' : ''}">
          ${status === 'live' ? '🔴 עכשיו' : status === 'finished' ? '✓ ' + dateFmt.full : dateFmt.full}
        </span>
        ${m.venue ? `<span class="match-venue">📍 ${m.venue}</span>` : ''}
      </div>` : '';

    return `
      <div class="${classes}" data-match-id="${m.id}" data-home="${m.home}" data-away="${m.away}">
        ${dateChip}
        <div class="match-card-inner">
          <div class="team-side home">
            <div class="team-flag">${flagImg(m.home)}</div>
            <span class="team-name">${m.home}</span>
          </div>
          <div class="match-center">
            ${scoreDisplay}
            ${analyzed ? '<span class="ai-tag">✨ נותח</span>' : ''}
          </div>
          <div class="team-side away">
            <div class="team-flag">${flagImg(m.away)}</div>
            <span class="team-name">${m.away}</span>
          </div>
        </div>
        <div class="match-score-form" data-match-id="${m.id}" data-home="${m.home}" data-away="${m.away}">
          <input type="number" min="0" max="20" class="sg-home" placeholder="0" value="${r ? r.homeGoals : ''}" />
          <span class="sg-sep">:</span>
          <input type="number" min="0" max="20" class="sg-away" placeholder="0" value="${r ? r.awayGoals : ''}" />
          <button class="sg-save">${r ? '✎' : '💾'}</button>
          ${r ? `<button class="sg-analyze" onclick="event.stopPropagation();openMatchModal('${m.id}','${m.home}','${m.away}')">✨</button>` : ''}
        </div>
      </div>`;
  }).join('');

  const progressPct = Math.round((playedMatches / totalMatches) * 100);

  return `
    <div class="group-section" style="margin-bottom:2.5rem">
      <div class="group-header">
        <div class="group-badge">${key}</div>
        <h2>בית ${key}</h2>
        <span class="group-progress">${playedMatches}/${totalMatches} משחקים${groupDone ? ' ✓' : ''}</span>
      </div>
      <div class="group-progress-bar"><div class="group-progress-fill" style="width:${progressPct}%"></div></div>
      <div class="standings">
        <table>
          <thead><tr><th>#</th><th>נבחרת</th><th>מ</th><th class="w-cell">נ</th><th>ת</th><th>ה</th><th>ז:ח</th><th>±</th><th class="pts-header">נק׳</th></tr></thead>
          <thead class="pts-legend"><tr><td colspan="9">ניצחון = 3 נק׳ &nbsp;|&nbsp; תיקו = 1 נק׳ &nbsp;|&nbsp; הפסד = 0 נק׳</td></tr></thead>
          <tbody>${standingsRows}</tbody>
        </table>
      </div>
      <div class="matches-title">משחקים — לחץ על 💾 להזין תוצאה, על ✨ לניתוח AI</div>
      <div class="matches-grid">${matchCards}</div>
    </div>`;
}

// ============================================================
// GROUP LISTENERS
// ============================================================
function attachGroupListeners() {
  // Save score
  document.querySelectorAll('.match-score-form').forEach(form => {
    const btn = form.querySelector('.sg-save');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const hg = parseInt(form.querySelector('.sg-home').value, 10);
      const ag = parseInt(form.querySelector('.sg-away').value, 10);
      if (isNaN(hg) || isNaN(ag) || hg < 0 || ag < 0) return;
      const matchId = form.dataset.matchId;
      groupResults[matchId] = { homeGoals: hg, awayGoals: ag };
      saveGroupResults();
      updateAllGroupStandings();
      // re-render current view
      if (currentView === 'groups') renderGroup(currentGroup);
      else renderKnockout();
    });
  });

  // Click on match card body → open analysis modal
  document.querySelectorAll('.match-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.match-score-form')) return;
      openMatchModal(card.dataset.matchId, card.dataset.home, card.dataset.away);
    });
  });
}

// ============================================================
// MODAL
// ============================================================
function openMatchModal(matchId, home, away) {
  document.getElementById('modal-home-flag').innerHTML = flagImg(home);
  document.getElementById('modal-home-name').textContent = home;
  document.getElementById('modal-away-flag').innerHTML = flagImg(away);
  document.getElementById('modal-away-name').textContent = away;
  document.getElementById('modal-title').textContent = `${home} נגד ${away}`;

  const area = document.getElementById('analysis-area');
  const result = groupResults[matchId];

  const cached = analysisCache[matchId];
  // Only use cache if it belongs to the same two teams (guards against stale data after group changes)
  if (cached && cached.home === home && cached.away === away) {
    area.innerHTML = renderAnalysis(cached) +
      `<button class="reanalyze-btn" style="margin-top:1rem"
        onclick="delete analysisCache['${matchId}'];saveAnalysisCache();openMatchModal('${matchId}','${escHtml(home)}','${escHtml(away)}')">
        🔄 נתח מחדש
      </button>`;
  } else {
    area.innerHTML = `
      ${result ? `<div class="final-score-display">תוצאה סופית: <strong>${home} ${result.homeGoals}:${result.awayGoals} ${away}</strong></div>` : ''}
      <div class="winner-odds-section">
        <div class="winner-odds-label">📊 אודס ווינר (אופציונלי)</div>
        <div class="winner-odds-row">
          <div class="odds-input-group">
            <label>${home}</label>
            <input type="number" step="0.01" min="1.01" id="odds-home" placeholder="2.50">
          </div>
          <div class="odds-input-group">
            <label>תיקו</label>
            <input type="number" step="0.01" min="1.01" id="odds-draw" placeholder="3.20">
          </div>
          <div class="odds-input-group">
            <label>${away}</label>
            <input type="number" step="0.01" min="1.01" id="odds-away" placeholder="2.80">
          </div>
        </div>
      </div>
      <div class="current-context-section">
        <div class="current-context-header">
          <span class="current-context-label">📰 מידע עדכני (אופציונלי — AI לא יודע אחרי ינואר 2025)</span>
          <a class="search-link" href="https://www.google.com/search?q=${encodeURIComponent(home + ' ' + away + ' 2026 form injury squad')}" target="_blank">🔍 חפש ב-Google</a>
        </div>
        <textarea id="current-context" class="current-context-input"
          placeholder="הדבק כאן מידע עדכני: פציעות, סגל, צורה אחרונה, ניצחונות/הפסדים...&#10;למשל: מסי לא בכושר מלא • הגנת מקסיקו ספגה 3 שערים ב-3 משחקים אחרונים"></textarea>
      </div>
      <button class="analyze-btn" id="analyze-btn"
        onclick="runAnalysis('${matchId}','${escHtml(home)}','${escHtml(away)}')">
        ✨ נתח משחק עם AI
      </button>`;
  }

  modalOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function escHtml(s) { return s.replace(/'/g, "\\'"); }

modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeModal();
});
document.getElementById('modal-close').addEventListener('click', closeModal);

function closeModal() {
  modalOverlay.classList.remove('open');
  document.body.style.overflow = '';
}

// ============================================================
// AI ANALYSIS
// ============================================================
async function runAnalysis(matchId, home, away) {
  if (!apiKey || apiKey.length < 10) {
    document.getElementById('analysis-area').innerHTML = `
      <div class="error-msg">
        יש להזין מפתח Gemini API כדי להשתמש בניתוח AI.<br/>
        <small>השג מפתח ב- aistudio.google.com ← Get API Key</small>
      </div>`;
    return;
  }

  const btn = document.getElementById('analyze-btn');
  if (btn) btn.disabled = true;

  document.getElementById('analysis-area').innerHTML = `
    <div class="analysis-loading">
      <div class="spinner"></div>
      <span>מנתח את המשחק עם AI...</span>
    </div>`;

  // Build context from past analyses of the same teams
  const pastAnalyses = buildPastContext(home, away);
  const result = groupResults[matchId];
  const finalScore = result ? `\nתוצאה סופית ידועה: ${home} ${result.homeGoals}:${result.awayGoals} ${away}` : '';

  // Read Winner odds if user entered them
  const oddsHome = parseFloat(document.getElementById('odds-home')?.value) || null;
  const oddsDraw = parseFloat(document.getElementById('odds-draw')?.value) || null;
  const oddsAway = parseFloat(document.getElementById('odds-away')?.value) || null;
  const hasOdds = oddsHome || oddsDraw || oddsAway;
  const oddsContext = hasOdds
    ? `\n📊 **אודס שוק (ווינר):** ${home} = ${oddsHome || '?'} | תיקו = ${oddsDraw || '?'} | ${away} = ${oddsAway || '?'}\nהשתמש באודס האלה כהקשר לניתוח — הם מייצגים את ההערכה של השוק.\n`
    : '';

  // Read current context the user pasted
  const userContext = (document.getElementById('current-context')?.value || '').trim();
  const userContextBlock = userContext
    ? `\n🗞️ **מידע עדכני שסופק על ידי המשתמש (עדיפות גבוהה — השתמש בזה!):**\n${userContext}\n`
    : '';

  // Prompt will be built after web search (so live context can be included)
  function buildPrompt(liveCtx) {
    const parts = [];
    parts.push('אתה מנתח כדורגל. החזר JSON בלבד, עברית, ללא טקסט נוסף.');
    if (finalScore) parts.push('תוצאה ידועה: ' + home + ' ' + result.homeGoals + ':' + result.awayGoals + ' ' + away + '.');
    if (liveCtx) parts.push(liveCtx);
    if (userContextBlock) parts.push(userContextBlock);
    if (oddsContext) parts.push(oddsContext);
    if (pastAnalyses) parts.push(pastAnalyses);
    parts.push('משחק מונדיאל 2026: ' + home + ' נגד ' + away + '.');
    parts.push('החזר בדיוק בפורמט הזה:');
    parts.push(JSON.stringify({
      homeWin: 55,
      draw: 25,
      awayWin: 20,
      predictedScore: 'x-y',
      homeAnalysis: 'כוחות וחולשות ' + home + ' — 2 משפטים',
      awayAnalysis: 'כוחות וחולשות ' + away + ' — 2 משפטים',
      keyPlayers: home + ': שם,שם | ' + away + ': שם,שם',
      keyFactors: '3 גורמים מכריעים',
      prediction: 'תחזית קצרה + תוצאה',
      oddsNote: hasOdds ? 'האם יש value bet?' : ''
    }, null, 0));
    return parts.join('\n');
  }

  // Helper: one Claude API call
  async function callGemini(prompt, maxTokens = 1000) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.7
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${res.status}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }

  try {
    // ---- Phase 1: web search (with cooldown to avoid rate limits) ----
    const now = Date.now();
    const lastSearch = parseInt(localStorage.getItem('last_search_ts') || '0');
    const canSearch = (now - lastSearch) > 45000; // 45s cooldown between searches

    document.getElementById('analysis-area').innerHTML = `
      <div class="analysis-loading">
        <div class="spinner"></div>
        <span>${canSearch ? '🔍 מחפש מידע עדכני...' : '🤖 מנתח את המשחק...'}</span>
      </div>`;

    let liveContext = '';

    // ---- Phase 1: fetch Winner.co.il odds via OpenAI web search ----
    if (canSearch) {
      try {
        localStorage.setItem('last_search_ts', String(Date.now()));
        document.getElementById('analysis-area').innerHTML = `
          <div class="analysis-loading"><div class="spinner"></div>
          <span>🔍 מחפש אודס בווינר...</span></div>`;

        const searchRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: 'gpt-4o-search-preview',
            web_search_options: { search_context_size: 'low' },
            messages: [{ role: 'user', content:
              `חפש ב-winner.co.il את האודס העדכניים למשחק ${home} נגד ${away} מונדיאל 2026. ` +
              `החזר רק שלושה מספרים בפורמט: HOME_ODDS|DRAW_ODDS|AWAY_ODDS (לדוגמה: 2.50|3.20|2.80). ` +
              `אם לא מצאת, החזר: NOT_FOUND`
            }],
            max_tokens: 50
          })
        });
        if (searchRes.ok) {
          const sd = await searchRes.json();
          const txt = sd.choices?.[0]?.message?.content || '';
          const m = txt.match(/([\d.]+)\|([\d.]+)\|([\d.]+)/);
          if (m) {
            const oh = parseFloat(m[1]), od = parseFloat(m[2]), oa = parseFloat(m[3]);
            if (oh > 1 && od > 1 && oa > 1) {
              const hEl = document.getElementById('odds-home');
              const dEl = document.getElementById('odds-draw');
              const aEl = document.getElementById('odds-away');
              if (hEl) hEl.value = oh;
              if (dEl) dEl.value = od;
              if (aEl) aEl.value = oa;
              liveContext = `📊 אודס ווינר עדכניים: ${home}=${oh} | תיקו=${od} | ${away}=${oa}`;
            }
          }
        }
      } catch(e) { /* fail silently */ }

      // ---- Phase 2: search current news (injuries, form, squad) ----
      try {
        document.getElementById('analysis-area').innerHTML = `
          <div class="analysis-loading"><div class="spinner"></div>
          <span>📰 מחפש מידע עדכני על הנבחרות...</span></div>`;

        const newsRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: 'gpt-4o-search-preview',
            web_search_options: { search_context_size: 'medium' },
            messages: [{ role: 'user', content:
              `חפש מידע עדכני על המשחק ${home} נגד ${away} במונדיאל 2026. ` +
              `כלול: פציעות ושחקנים שנעדרים, צורה אחרונה (5 משחקים אחרונים), שינויי סגל חשובים, מידע על המאמנים. ` +
              `ענה בעברית, תמציתי, עד 150 מילים.`
            }],
            max_tokens: 300
          })
        });
        if (newsRes.ok) {
          const nd = await newsRes.json();
          const newsText = nd.choices?.[0]?.message?.content || '';
          if (newsText && !newsText.includes('NOT_FOUND')) {
            liveContext = (liveContext ? liveContext + '\n' : '') + `📰 מידע עדכני:\n${newsText}`;
          }
        }
      } catch(e) { /* fail silently */ }
    }

    document.getElementById('analysis-area').innerHTML = `
      <div class="analysis-loading">
        <div class="spinner"></div>
        <span>🤖 מנתח את המשחק...</span>
      </div>`;

    const fullPrompt = buildPrompt(liveContext);
    const text = await callGemini(fullPrompt, 1000);

    let parsed;
    try {
      const m = text.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : null;
    } catch { parsed = null; }

    const r = parsed || { homeWin:40, draw:25, awayWin:35, predictedScore:'1-1', analysis: text };
    r.home = home;
    r.away = away;
    if (result) r.actualScore = `${result.homeGoals}:${result.awayGoals}`;
    if (hasOdds) r.winnerOdds = { home: oddsHome, draw: oddsDraw, away: oddsAway };

    analysisCache[matchId] = r;
    saveAnalysisCache();

    // Mark card as analyzed
    const card = document.querySelector(`[data-match-id="${matchId}"]`);
    if (card) {
      card.classList.add('analyzed');
      const center = card.querySelector('.match-center');
      if (center && !center.querySelector('.ai-tag')) {
        center.insertAdjacentHTML('beforeend', '<span class="ai-tag">✨ נותח</span>');
      }
    }

    document.getElementById('analysis-area').innerHTML = renderAnalysis(r);
  } catch (err) {
    const isRateLimit = err.message && (err.message.includes('rate limit') || err.message.includes('529') || err.message.includes('30,000'));
    const errMsg = isRateLimit
      ? '⏳ יותר מדי ניתוחים בדקה אחת — המתן 30 שניות ונסה שוב'
      : `שגיאה: ${err.message}`;
    document.getElementById('analysis-area').innerHTML = `
      <div class="error-msg">${errMsg}</div>
      <button class="analyze-btn" style="margin-top:1rem"
        onclick="runAnalysis('${matchId}','${escHtml(home)}','${escHtml(away)}')">🔄 נסה שוב</button>`;
  }
}

// Build context string from previous analyses involving these teams
function buildPastContext(home, away) {
  const relevant = Object.entries(analysisCache)
    .filter(([, r]) => r && (r.home === home || r.away === home || r.home === away || r.away === away))
    .slice(0, 2)
    .map(([, r]) => {
      const score = r.actualScore ? ` (${r.actualScore})` : '';
      return `• ${r.home} vs ${r.away}${score}`;
    });

  if (!relevant.length) return '';
  return `\nהקשר: ${relevant.join(', ')}\n`;
}

function toOdds(pct) {
  if (!pct || pct <= 0) return '—';
  return (100 / pct).toFixed(2);
}

function parseProb(v) {
  if (typeof v === 'number' && !isNaN(v)) return Math.round(v);
  const m = String(v).match(/\d+/);
  const n = m ? parseInt(m[0]) : NaN;
  return isNaN(n) ? 0 : Math.min(100, Math.max(0, n));
}

function renderAnalysis(r) {
  const actualScoreHtml = r.actualScore
    ? `<div class="actual-score">⚽ תוצאה סופית: <strong>${r.home} ${r.actualScore} ${r.away}</strong></div>`
    : '';

  const hw = parseProb(r.homeWin);
  const dr = parseProb(r.draw);
  const aw = parseProb(r.awayWin);

  // Estimated decimal odds from AI probabilities
  const estHome = toOdds(hw);
  const estDraw = toOdds(dr);
  const estAway = toOdds(aw);

  // Winner odds (if user provided them)
  const wo = r.winnerOdds;
  const winnerOddsHtml = wo ? `
    <div class="odds-comparison">
      <div class="odds-row-header">
        <span></span><span class="odds-col-head">${r.home}</span><span class="odds-col-head">תיקו</span><span class="odds-col-head">${r.away}</span>
      </div>
      <div class="odds-row">
        <span class="odds-source">📊 ווינר</span>
        <span class="odds-val winner-val">${(wo.home && !isNaN(wo.home)) ? wo.home : '—'}</span>
        <span class="odds-val winner-val">${(wo.draw && !isNaN(wo.draw)) ? wo.draw : '—'}</span>
        <span class="odds-val winner-val">${(wo.away && !isNaN(wo.away)) ? wo.away : '—'}</span>
      </div>
      <div class="odds-row">
        <span class="odds-source">🤖 AI</span>
        <span class="odds-val">${estHome}</span>
        <span class="odds-val">${estDraw}</span>
        <span class="odds-val">${estAway}</span>
      </div>
    </div>` : `
    <div class="odds-simple">
      <span class="odds-source">🤖 אודס משוערים:</span>
      <span class="odds-chip">${r.home} <strong>${estHome}</strong></span>
      <span class="odds-chip">תיקו <strong>${estDraw}</strong></span>
      <span class="odds-chip">${r.away} <strong>${estAway}</strong></span>
    </div>`;

  return `
    ${actualScoreHtml}
    <div class="prob-bars">
      <div class="prob-row">
        <span class="prob-label">${r.home}</span>
        <div class="prob-bar-wrap"><div class="prob-bar home" style="width:${hw}%"></div></div>
        <span class="prob-pct">${hw}%</span>
      </div>
      <div class="prob-row">
        <span class="prob-label">תיקו</span>
        <div class="prob-bar-wrap"><div class="prob-bar draw" style="width:${dr}%"></div></div>
        <span class="prob-pct">${dr}%</span>
      </div>
      <div class="prob-row">
        <span class="prob-label">${r.away}</span>
        <div class="prob-bar-wrap"><div class="prob-bar away" style="width:${aw}%"></div></div>
        <span class="prob-pct">${aw}%</span>
      </div>
    </div>
    ${winnerOddsHtml}
    ${r.predictedScore ? `<div style="text-align:center;margin:0.75rem 0;font-size:1rem">
      🎯 תחזית: <strong>${r.home} ${r.predictedScore} ${r.away}</strong>
    </div>` : ''}
    ${r.homeAnalysis || r.awayAnalysis ? `
    <div class="analysis-sections">
      <div class="analysis-section">
        <div class="section-title">💪 ${r.away}</div>
        <div class="section-body">${r.awayAnalysis || ''}</div>
      </div>
      <div class="analysis-section">
        <div class="section-title">💪 ${r.home}</div>
        <div class="section-body">${r.homeAnalysis || ''}</div>
      </div>
      ${r.keyPlayers ? `<div class="analysis-section">
        <div class="section-title">⭐ שחקני מפתח</div>
        <div class="section-body">${r.keyPlayers}</div>
      </div>` : ''}
      ${r.keyFactors ? `<div class="analysis-section">
        <div class="section-title">🔑 גורמים מכריעים</div>
        <div class="section-body">${r.keyFactors}</div>
      </div>` : ''}
      ${r.prediction ? `<div class="analysis-section prediction-section">
        <div class="section-title">🎯 תחזית</div>
        <div class="section-body">${r.prediction}</div>
      </div>` : ''}
      ${r.oddsNote ? `<div class="analysis-section">
        <div class="section-title">📊 ניתוח אודס</div>
        <div class="section-body">${r.oddsNote}</div>
      </div>` : ''}
    </div>` : `<div class="analysis-content">${(r.analysis||'').replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>')}</div>`}`;
}

// ============================================================
// ALL MATCHES VIEW — כל המשחקים לפי סדר כרונולוגי
// ============================================================
function renderAllMatches() {
  // Collect all group matches, sorted by date
  const all = ALL_MATCHES.slice().sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(a.date) - new Date(b.date);
  });

  // Group by date-day for display headers
  let lastDay = null;
  let html = '<div class="all-matches-wrap">';

  all.forEach(m => {
    const dateFmt = formatMatchDate(m.date);
    const dayKey  = m.date ? m.date.substring(0, 10) : 'לא ידוע';

    if (dayKey !== lastDay) {
      if (lastDay !== null) html += '</div>'; // close prev day
      const dayLabel = dateFmt ? `${dateFmt.day} ${dateFmt.date} ${dateFmt.month}` : 'תאריך לא ידוע';
      html += `
        <div class="day-section">
          <div class="day-header">
            <span class="day-label">${dayLabel}</span>
          </div>
          <div class="day-matches">`;
      lastDay = dayKey;
    }

    html += allMatchCard(m);
  });

  if (lastDay !== null) html += '</div></div>'; // close last day
  html += '</div>';

  mainEl.innerHTML = html;
  attachAllMatchListeners();
}

function allMatchCard(m) {
  const r        = groupResults[m.id];
  const analyzed = analysisCache[m.id];
  const status   = r ? 'finished' : matchStatus(m.date);
  const dateFmt  = formatMatchDate(m.date);

  const scoreDisplay = r
    ? `<span class="score-badge">${r.homeGoals}:${r.awayGoals}</span>`
    : status === 'live'
      ? `<span class="vs-badge live-pulse">🔴 חי</span>`
      : `<span class="vs-badge">${dateFmt ? dateFmt.time : 'VS'}</span>`;

  const statusClass = r ? 'is-finished' : status === 'live' ? 'is-live' : '';

  return `
    <div class="all-match-card ${statusClass} ${analyzed ? 'analyzed' : ''}"
         data-match-id="${m.id}" data-home="${m.home}" data-away="${m.away}">
      <div class="all-match-group-tag">בית ${m.group}</div>
      <div class="all-match-inner">
        <div class="all-team home">
          ${flagImg(m.home)}
          <span class="all-team-name">${m.home}</span>
        </div>
        <div class="all-center">
          ${scoreDisplay}
          ${analyzed ? '<span class="ai-tag-sm">✨</span>' : ''}
        </div>
        <div class="all-team away">
          <span class="all-team-name">${m.away}</span>
          ${flagImg(m.away)}
        </div>
      </div>
      ${m.venue ? `<div class="all-match-venue">📍 ${m.venue}</div>` : ''}
      <div class="all-match-score-form" data-match-id="${m.id}" data-home="${m.home}" data-away="${m.away}">
        <input type="number" min="0" max="20" class="sg-home" placeholder="0" value="${r ? r.homeGoals : ''}" />
        <span class="sg-sep">:</span>
        <input type="number" min="0" max="20" class="sg-away" placeholder="0" value="${r ? r.awayGoals : ''}" />
        <button class="sg-save">${r ? '✎' : '💾'}</button>
        <button class="sg-analyze-btn" onclick="event.stopPropagation();openMatchModal('${m.id}','${escHtml(m.home)}','${escHtml(m.away)}')">✨ ניתוח</button>
      </div>
    </div>`;
}

function attachAllMatchListeners() {
  document.querySelectorAll('.all-match-score-form').forEach(form => {
    const btn = form.querySelector('.sg-save');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const hg = parseInt(form.querySelector('.sg-home').value, 10);
      const ag = parseInt(form.querySelector('.sg-away').value, 10);
      if (isNaN(hg) || isNaN(ag) || hg < 0 || ag < 0) return;
      groupResults[form.dataset.matchId] = { homeGoals: hg, awayGoals: ag };
      saveGroupResults();
      updateAllGroupStandings();
      renderAllMatches();
    });
  });

  document.querySelectorAll('.all-match-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.all-match-score-form')) return;
      openMatchModal(card.dataset.matchId, card.dataset.home, card.dataset.away);
    });
  });
}

// ============================================================
// KNOCKOUT VIEW
// ============================================================
function renderKnockout() {
  updateAllGroupStandings();
  const stages = [
    { key: 'r32',   label: 'שלב 32 — הטוב מ-32', cols: 2 },
    { key: 'r16',   label: 'שלב 16 — הטוב מ-16',  cols: 2 },
    { key: 'qf',    label: 'רבע גמר — 8 נבחרות',  cols: 2 },
    { key: 'sf',    label: 'חצי גמר — 4 נבחרות',  cols: 2 },
    { key: 'third', label: 'משחק המקום השלישי',    cols: 1 },
    { key: 'final', label: 'גמר 🏆',               cols: 1 },
  ];
  mainEl.innerHTML = stages.map(s => koStageHTML(s)).join('');
  attachKoListeners();
}

function koStageHTML({ key, label, cols }) {
  const matches = KNOCKOUT_BRACKET[key];
  const cards = matches.map(m => koMatchCard(m, key)).join('');
  const gridStyle = cols > 1
    ? `display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:0.6rem;`
    : '';
  return `
    <div class="ko-stage" data-stage="${key}">
      <div class="ko-stage-header">
        <span class="ko-stage-badge">${key === 'final' ? '🏆' : matches.length * 2 + ' ⚽'}</span>
        <h2>${label}</h2>
      </div>
      <div class="ko-grid" style="${gridStyle}">${cards}</div>
    </div>`;
}

function koMatchCard(match, stage) {
  const homeSlot = resolveSlot(match.home);
  const awaySlot = resolveSlot(match.away);
  const result   = knockoutResults[match.id];
  const analyzed = analysisCache[match.id];

  const classes = ['ko-match',
    stage === 'final' ? 'is-final' : '',
    result ? 'has-result' : '',
    analyzed ? 'analyzed' : ''
  ].filter(Boolean).join(' ');

  const homeName = homeSlot.name;
  const awayName = awaySlot.name;
  const homeFlag = homeSlot.isKnown ? flagImg(homeName) : '';
  const awayFlag = awaySlot.isKnown ? flagImg(awayName) : '';

  const centerContent = result
    ? `<span class="ko-score">${result.homeGoals} : ${result.awayGoals}</span>`
    : `<span class="ko-vs">VS</span>`;

  const bothKnown = homeSlot.isKnown && awaySlot.isKnown;
  const scoreForm = `
    <div class="score-form" data-match-id="${match.id}"
         data-home="${homeName}" data-away="${awayName}">
      <input type="number" min="0" max="20" placeholder="0" class="score-home"
             value="${result ? result.homeGoals : ''}" ${!bothKnown ? 'disabled' : ''} />
      <span class="score-sep">:</span>
      <input type="number" min="0" max="20" placeholder="0" class="score-away"
             value="${result ? result.awayGoals : ''}" ${!bothKnown ? 'disabled' : ''} />
      <button class="score-save-btn" ${!bothKnown ? 'disabled style="opacity:0.4"' : ''}>
        ${result ? '✎ עדכן' : '💾 שמור'}
      </button>
      ${bothKnown ? `<button class="score-analyze-btn" onclick="event.stopPropagation();openMatchModal('${match.id}','${homeName}','${awayName}')">✨</button>` : ''}
    </div>`;

  return `
    <div class="${classes}" data-match-id="${match.id}"
         data-home="${homeName}" data-away="${awayName}"
         data-home-known="${homeSlot.isKnown}" data-away-known="${awaySlot.isKnown}">
      <div class="ko-match-inner">
        <div class="ko-team home">
          ${homeFlag}
          <span class="ko-team-name ${homeSlot.isKnown ? '' : 'unknown'}">${homeName}</span>
          ${result && result.winner === homeName ? '<span class="ko-winner-badge">✓</span>' : ''}
        </div>
        <div class="ko-center">
          ${centerContent}
          <span class="ko-match-num">${matchIdToLabel(match.id)}</span>
        </div>
        <div class="ko-team away">
          ${result && result.winner === awayName ? '<span class="ko-winner-badge">✓</span>' : ''}
          <span class="ko-team-name ${awaySlot.isKnown ? '' : 'unknown'}">${awayName}</span>
          ${awayFlag}
        </div>
      </div>
      ${scoreForm}
    </div>`;
}

function attachKoListeners() {
  document.querySelectorAll('.score-form').forEach(form => {
    const btn = form.querySelector('.score-save-btn');
    if (!btn || btn.disabled) return;
    btn.addEventListener('click', () => {
      const hg = parseInt(form.querySelector('.score-home').value, 10);
      const ag = parseInt(form.querySelector('.score-away').value, 10);
      if (isNaN(hg) || isNaN(ag)) { alert('הכנס תוצאה תקינה'); return; }
      if (hg === ag) { alert('בנוקאוט אין תיקו — הזן תוצאה עם מנצח'); return; }
      setKnockoutResult(form.dataset.matchId, hg, ag, form.dataset.home, form.dataset.away);
      renderKnockout();
    });
  });

  document.querySelectorAll('.ko-match .ko-match-inner').forEach(inner => {
    inner.addEventListener('click', () => {
      const card = inner.closest('.ko-match');
      if (card.dataset.homeKnown !== 'true' || card.dataset.awayKnown !== 'true') return;
      openMatchModal(card.dataset.matchId, card.dataset.home, card.dataset.away);
    });
  });
}

// ============================================================
// PWA INSTALL
// ============================================================
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); deferredPrompt = e;
  installBtn.classList.add('visible');
});
installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  if (outcome === 'accepted') installBtn.classList.remove('visible');
  deferredPrompt = null;
});

// ============================================================
// SERVICE WORKER
// ============================================================
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(console.error);
  }
}
