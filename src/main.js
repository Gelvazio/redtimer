let STORAGE_KEY = 'redtimer-web-settings';

function normalizeBaseUrl(url) {
  if (!url) return '';
  return url.trim().replace(/\/$/, '');
}

function loadSettings() {
  const defaults = {
    baseUrl: normalizeBaseUrl(import.meta.env.VITE_REDMINE_URL || ''),
    apiKey: String(import.meta.env.VITE_REDMINE_API_KEY || '').trim(),
    maxRecent: 10,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const saved = JSON.parse(raw);
    const maxR = parseInt(saved.maxRecent, 10);
    return {
      baseUrl: normalizeBaseUrl(saved.baseUrl ?? defaults.baseUrl),
      apiKey: String(saved.apiKey ?? defaults.apiKey).trim(),
      maxRecent: Number.isFinite(maxR) && maxR > 0 ? maxR : defaults.maxRecent,
    };
  } catch {
    return defaults;
  }
}

const els = {
  quickPick: document.getElementById('quick-pick'),
  issueId: document.getElementById('issue-id'),
  issueSubject: document.getElementById('issue-subject'),
  issueDescription: document.getElementById('issue-description'),
  btnStartStop: document.getElementById('btn-start-stop'),
  counter: document.getElementById('counter'),
  activity: document.getElementById('activity'),
  issueStatus: document.getElementById('issue-status'),
  entryComment: document.getElementById('entry-comment'),
  statusLine: document.getElementById('status-line'),
  btnSettings: document.getElementById('btn-settings'),
  btnReload: document.getElementById('btn-reload'),
  btnConnection: document.getElementById('btn-connection'),
  btnSelectIssue: document.getElementById('btn-select-issue'),
  settingsDialog: document.getElementById('settings-dialog'),
  settingsForm: document.getElementById('settings-form'),
  settingsCancel: document.getElementById('settings-cancel'),
  settingsBackdrop: document.getElementById('settings-backdrop'),
  redmineUrl: document.getElementById('redmine-url'),
  apiKey: document.getElementById('api-key'),
  maxRecent: document.getElementById('max-recent'),
  recentIssues: document.getElementById('recent-issues'),
  issuesDialog: document.getElementById('issues-dialog'),
  issuesBackdrop: document.getElementById('issues-backdrop'),
  issueList: document.getElementById('issue-list'),
  issuesClose: document.getElementById('issues-close'),
};

/** @type {{ baseUrl: string, apiKey: string, maxRecent: number }} */
let settings = loadSettings();

let timerRunning = false;
let timerStartedAt = null;
let elapsedBeforeStart = 0;
let tickId = null;

let currentIssue = null;
let activities = [];
let issueStatuses = [];

function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function setStatus(msg, type = '') {
  els.statusLine.textContent = msg;
  els.statusLine.className = 'status-line' + (type ? ` status-line--${type}` : '');
}

async function redmineFetch(path, options = {}) {
  const base = normalizeBaseUrl(settings.baseUrl);
  const key = settings.apiKey.trim();
  if (!base || !key) {
    throw new Error('Configure URL e chave de API nas configurações.');
  }
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = {
    'X-Redmine-API-Key': key,
    Accept: 'application/json',
    ...(options.headers || {}),
  };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

function formatElapsed(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

function updateCounterDisplay() {
  let ms = elapsedBeforeStart;
  if (timerRunning && timerStartedAt) {
    ms += Date.now() - timerStartedAt;
  }
  els.counter.value = formatElapsed(ms);
}

function startTimer() {
  if (timerRunning) return;
  timerRunning = true;
  timerStartedAt = Date.now();
  els.btnStartStop.textContent = '■';
  els.btnStartStop.title = 'Parar e registrar tempo';
  tickId = setInterval(updateCounterDisplay, 250);
  updateCounterDisplay();
}

async function stopTimerAndSubmit() {
  if (!timerRunning) return;
  const endMs = Date.now();
  const sessionMs = endMs - timerStartedAt;
  timerRunning = false;
  clearInterval(tickId);
  tickId = null;
  elapsedBeforeStart += sessionMs;
  timerStartedAt = null;
  els.btnStartStop.textContent = '▶';
  els.btnStartStop.title = 'Iniciar';
  updateCounterDisplay();

  const hours = sessionMs / 3600000;
  if (hours < 0.001 || !currentIssue) {
    setStatus('Tempo muito curto ou nenhuma issue carregada — nada enviado.', 'error');
    return;
  }

  const activityId = els.activity.value;
  if (!activityId) {
    setStatus('Selecione uma atividade antes de parar.', 'error');
    return;
  }

  try {
    const body = {
      time_entry: {
        issue_id: currentIssue.id,
        hours: Math.round((hours + Number.EPSILON) * 1000) / 1000,
        activity_id: Number(activityId),
        comments: els.entryComment.value.trim() || undefined,
      },
    };
    await redmineFetch('/time_entries.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setStatus('Tempo registrado no Redmine.', 'ok');
    elapsedBeforeStart = 0;
    updateCounterDisplay();
    pushRecentIssue(currentIssue);
  } catch (e) {
    setStatus(e.message || String(e), 'error');
  }
}

function parseIssueIdFromQuickPick(text) {
  const t = text.trim();
  const num = parseInt(t, 10);
  if (!Number.isNaN(num) && String(num) === t) return num;
  const m = t.match(/#?(\d+)/);
  return m ? parseInt(m[1], 10) : NaN;
}

async function loadIssue(issueId) {
  if (!issueId || Number.isNaN(issueId)) {
    setStatus('Informe um ID de issue válido.', 'error');
    return;
  }
  setStatus('Carregando issue…');
  try {
    const data = await redmineFetch(`/issues/${issueId}.json?include=attachments`);
    const issue = data.issue;
    currentIssue = issue;
    els.issueId.value = String(issue.id);
    els.issueSubject.value = issue.subject || '';
    els.issueDescription.value = stripHtml(issue.description || '');
    els.issueStatus.innerHTML = '';
    if (issue.status && issueStatuses.length) {
      issueStatuses.forEach((st) => {
        const opt = document.createElement('option');
        opt.value = String(st.id);
        opt.textContent = st.name;
        if (st.id === issue.status.id) opt.selected = true;
        els.issueStatus.appendChild(opt);
      });
    } else if (issue.status) {
      const opt = document.createElement('option');
      opt.value = String(issue.status.id);
      opt.textContent = issue.status.name;
      els.issueStatus.appendChild(opt);
    }
    setStatus(`Issue #${issue.id} carregada.`, 'ok');
    pushRecentIssue(issue);
  } catch (e) {
    currentIssue = null;
    setStatus(e.message || String(e), 'error');
  }
}

function stripHtml(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d.textContent || d.innerText || '';
}

function pushRecentIssue(issue) {
  const key = 'redtimer-recent-issues';
  let list = [];
  try {
    list = JSON.parse(localStorage.getItem(key) || '[]');
  } catch {
    list = [];
  }
  const id = issue.id;
  list = list.filter((x) => x.id !== id);
  list.unshift({ id: issue.id, text: `#${issue.id} — ${issue.subject || ''}` });
  const max = settings.maxRecent < 0 ? 100 : settings.maxRecent;
  list = list.slice(0, max);
  localStorage.setItem(key, JSON.stringify(list));
  refreshRecentDatalist();
}

function refreshRecentDatalist() {
  const key = 'redtimer-recent-issues';
  let list = [];
  try {
    list = JSON.parse(localStorage.getItem(key) || '[]');
  } catch {
    list = [];
  }
  els.recentIssues.innerHTML = '';
  list.forEach((item) => {
    const opt = document.createElement('option');
    opt.value = item.text;
    els.recentIssues.appendChild(opt);
  });
}

async function loadEnumerations() {
  try {
    const [actData, statusData] = await Promise.all([
      redmineFetch('/enumerations/time_entry_activities.json'),
      redmineFetch('/issue_statuses.json'),
    ]);
    activities = actData.time_entry_activities || [];
    issueStatuses = statusData.issue_statuses || [];

    els.activity.innerHTML = '';
    activities.forEach((a) => {
      const opt = document.createElement('option');
      opt.value = String(a.id);
      opt.textContent = a.name;
      els.activity.appendChild(opt);
    });
    if (activities[0]) els.activity.value = String(activities[0].id);

    els.issueStatus.innerHTML = '';
    issueStatuses.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = String(s.id);
      opt.textContent = s.name;
      els.issueStatus.appendChild(opt);
    });
  } catch (e) {
    setStatus(`Não foi possível carregar atividades/status: ${e.message}`, 'error');
  }
}

async function testConnection() {
  setStatus('Testando conexão…');
  try {
    await redmineFetch('/users/current.json');
    await loadEnumerations();
    setStatus('Conectado ao Redmine.', 'ok');
    els.btnConnection.style.color = 'var(--ok)';
  } catch (e) {
    els.btnConnection.style.color = 'var(--warn)';
    setStatus(e.message || String(e), 'error');
  }
}

function openSettings() {
  els.redmineUrl.value = settings.baseUrl;
  els.apiKey.value = settings.apiKey;
  els.maxRecent.value = String(settings.maxRecent);
  els.settingsBackdrop.hidden = false;
  if (typeof els.settingsDialog.showModal === 'function') {
    els.settingsDialog.showModal();
  }
}

function closeSettings() {
  els.settingsBackdrop.hidden = true;
  els.settingsDialog.close();
}

async function openIssuesDialog() {
  setStatus('Buscando issues…');
  try {
    const data = await redmineFetch('/issues.json?limit=25&sort=updated_on:desc');
    const issues = data.issues || [];
    els.issueList.innerHTML = '';
    issues.forEach((issue) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="issue-num">#${issue.id}</span><span class="issue-subj">${escapeHtml(issue.subject || '')}</span>`;
      li.addEventListener('click', () => {
        els.quickPick.value = String(issue.id);
        loadIssue(issue.id);
        closeIssuesDialog();
      });
      els.issueList.appendChild(li);
    });
    els.issuesBackdrop.hidden = false;
    if (typeof els.issuesDialog.showModal === 'function') {
      els.issuesDialog.showModal();
    }
    setStatus('');
  } catch (e) {
    setStatus(e.message || String(e), 'error');
  }
}

function closeIssuesDialog() {
  els.issuesBackdrop.hidden = true;
  els.issuesDialog.close();
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

els.btnStartStop.addEventListener('click', () => {
  if (timerRunning) {
    stopTimerAndSubmit();
  } else {
    if (!currentIssue) {
      setStatus('Carregue uma issue antes de iniciar o cronômetro.', 'error');
      return;
    }
    startTimer();
  }
});

els.quickPick.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const id = parseIssueIdFromQuickPick(els.quickPick.value);
    loadIssue(id);
  }
});

els.btnReload.addEventListener('click', () => {
  const id = parseInt(els.issueId.value, 10);
  if (!Number.isNaN(id)) loadIssue(id);
  else {
    const id2 = parseIssueIdFromQuickPick(els.quickPick.value);
    loadIssue(id2);
  }
});

els.btnSettings.addEventListener('click', openSettings);
els.settingsCancel.addEventListener('click', closeSettings);
els.settingsForm.addEventListener('submit', (e) => {
  e.preventDefault();
  settings.baseUrl = normalizeBaseUrl(els.redmineUrl.value);
  settings.apiKey = els.apiKey.value.trim();
  settings.maxRecent = parseInt(els.maxRecent.value, 10) || 10;
  saveSettings();
  refreshRecentDatalist();
  closeSettings();
  testConnection();
});

els.settingsDialog.addEventListener('close', () => {
  els.settingsBackdrop.hidden = true;
});

els.btnConnection.addEventListener('click', testConnection);
els.btnSelectIssue.addEventListener('click', openIssuesDialog);
els.issuesClose.addEventListener('click', closeIssuesDialog);
els.issuesDialog.addEventListener('close', () => {
  els.issuesBackdrop.hidden = true;
});

els.settingsBackdrop.addEventListener('click', closeSettings);
els.issuesBackdrop.addEventListener('click', closeIssuesDialog);

refreshRecentDatalist();
updateCounterDisplay();

if (settings.baseUrl && settings.apiKey) {
  testConnection();
} else {
  setStatus('Abra as configurações (⚙) e informe URL e chave de API do Redmine.');
  openSettings();
}
