(function initTheme() {
  const btn = document.getElementById('themeToggleBtn');
  const apply = (t) => {
    document.documentElement.setAttribute('data-theme', t);
    if (btn) btn.innerHTML = `<img src="/img/icons/${t === 'dark' ? 'moon' : 'sun'}.svg" class="pixel-icon" alt="">`;
    localStorage.setItem('theme', t);
  };
  apply(localStorage.getItem('theme') || 'light');
  if (btn) btn.addEventListener('click', () => {
    apply(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });
})();

let sessions = [];
let selectedSessionId = null;
let currentDetailData = null;
let ws = null;
let incidentsCount = 0;
let selectedAdminTestId = 'demo-test-1';
let allAdminTests = [];
let cachedLeaderboardData = [];
let sessionSortMode = 'time_desc';
let adminLeadSortMode = 'rank_asc';
const onlineStudentsMap = new Map();

const adminWsStatusDot = document.getElementById('adminWsStatusDot');
const adminWsStatusText = document.getElementById('adminWsStatusText');
const refreshSessionsBtn = document.getElementById('refreshSessionsBtn');
const sessionsTableBody = document.getElementById('sessionsTableBody');
const liveIncidentsFeed = document.getElementById('liveIncidentsFeed');
const liveEventsCount = document.getElementById('liveEventsCount');

const adminTestSelector = document.getElementById('adminTestSelector');
const activeTestStatsBadge = document.getElementById('activeTestStatsBadge');
const openCreateTestModalBtn = document.getElementById('openCreateTestModalBtn');
const deleteActiveTestBtn = document.getElementById('deleteActiveTestBtn');
const createTestModal = document.getElementById('createTestModal');
const closeCreateTestModalBtn = document.getElementById('closeCreateTestModalBtn');
const cancelCreateTestBtn = document.getElementById('cancelCreateTestBtn');
const submitCreateTestBtn = document.getElementById('submitCreateTestBtn');
const newTestTitleInput = document.getElementById('newTestTitleInput');
const newTestDurationInput = document.getElementById('newTestDurationInput');
const createTestErrorMsg = document.getElementById('createTestErrorMsg');

const sessionDetailPlaceholder = document.getElementById('sessionDetailPlaceholder');
const sessionDetailContent = document.getElementById('sessionDetailContent');
const detailStudentName = document.getElementById('detailStudentName');
const detailStudentMeta = document.getElementById('detailStudentMeta');
const detailVerdictBox = document.getElementById('detailVerdictBox');
const detailPingCanvas = document.getElementById('detailPingCanvas');
const exportSessionBtn = document.getElementById('exportSessionBtn');
const tunnelStatusText = document.getElementById('tunnelStatusText');
const tunnelUrlInput = document.getElementById('tunnelUrlInput');
const copyTunnelUrlBtn = document.getElementById('copyTunnelUrlBtn');

let adminToken = localStorage.getItem('admin_token') || '';

const passwordGate = document.getElementById('passwordGate');
const adminContent = document.getElementById('adminContent');
const adminPasswordInput = document.getElementById('adminPasswordInput');
const unlockAdminBtn = document.getElementById('unlockAdminBtn');
const pwErrorMsg = document.getElementById('pwErrorMsg');
const togglePwBtn = document.getElementById('togglePwBtn');

async function tryUnlock() {
  const val = (adminPasswordInput.value || '').trim();
  if (!val) return;
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: val })
    });
    if (res.ok) {
      const data = await res.json();
      adminToken = data.token;
      localStorage.setItem('admin_token', adminToken);
      passwordGate.style.display = 'none';
      adminContent.style.display = '';
      init();
    } else {
      pwErrorMsg.textContent = 'Невірний пароль';
      adminPasswordInput.classList.add('error');
      adminPasswordInput.value = '';
      setTimeout(() => adminPasswordInput.classList.remove('error'), 350);
    }
  } catch (err) {
    pwErrorMsg.textContent = 'Помилка підключення до сервера';
  }
}

if (unlockAdminBtn) unlockAdminBtn.addEventListener('click', tryUnlock);
if (adminPasswordInput) {
  adminPasswordInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') tryUnlock();
    if (pwErrorMsg) pwErrorMsg.textContent = '';
  });
}
if (togglePwBtn && adminPasswordInput) {
  togglePwBtn.addEventListener('click', () => {
    const hidden = adminPasswordInput.type === 'password';
    adminPasswordInput.type = hidden ? 'text' : 'password';
    togglePwBtn.innerHTML = `<img src="/img/icons/${hidden ? 'eye-closed' : 'eye'}.svg" class="pixel-icon" alt="">`;
  });
}

if (adminToken) {
  fetch('/api/admin/verify-token', {
    headers: { 'x-admin-token': adminToken }
  }).then(res => {
    if (res.ok) {
      if (passwordGate) passwordGate.style.display = 'none';
      if (adminContent) adminContent.style.display = '';
      init();
    } else {
      localStorage.removeItem('admin_token');
      adminToken = '';
      if (passwordGate) passwordGate.style.display = 'flex';
      if (adminContent) adminContent.style.display = 'none';
    }
  }).catch(() => {
    if (passwordGate) passwordGate.style.display = 'none';
    if (adminContent) adminContent.style.display = '';
    init();
  });
}

async function adminFetch(url, options = {}) {
  const headers = {
    'x-admin-token': adminToken,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    localStorage.removeItem('admin_token');
    adminToken = '';
    if (passwordGate) passwordGate.style.display = 'flex';
    if (adminContent) adminContent.style.display = 'none';
  }
  return res;
}

function init() {
  initWebSocket();
  loadSessions();
  checkTunnelStatus();
  setInterval(checkTunnelStatus, 8000);
  refreshSessionsBtn.addEventListener('click', () => {
    loadSessions();
    checkTunnelStatus();
  });
  exportSessionBtn.addEventListener('click', exportSelectedSession);

  const clearAllBtn = document.getElementById('clearAllSessionsBtn');
  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', async () => {
      if (!confirm('Ви дійсно бажаєте ВИДАЛИТИ ВСІ РЕЗУЛЬТАТИ ТЕСТУВАННЯ? Цю дію неможливо скасувати!')) return;
      try {
        const res = await adminFetch('/api/admin/sessions', { method: 'DELETE' });
        if (res.ok) {
          showAdminToast('Усі результати видалено');
          selectedSessionId = null;
          sessionDetailContent.classList.add('hidden');
          sessionDetailPlaceholder.classList.remove('hidden');
          await loadSessions();
        } else {
          const err = await res.json();
          alert(err.error || 'Помилка видалення');
        }
      } catch (e) {
        alert('Помилка: ' + e.message);
      }
    });
  }

  if (copyTunnelUrlBtn) {
    copyTunnelUrlBtn.addEventListener('click', () => {
      if (tunnelUrlInput.value) {
        navigator.clipboard.writeText(tunnelUrlInput.value);
        copyTunnelUrlBtn.innerHTML = '<img src="/img/icons/check.svg" class="pixel-icon inline" alt=""> Скопійовано!';
        setTimeout(() => { copyTunnelUrlBtn.innerHTML = '<img src="/img/icons/report.svg" class="pixel-icon inline" alt=""> Копіювати'; }, 2000);
      }
    });
  }

  const showQrBtn = document.getElementById('showQrBtn');
  const qrModal = document.getElementById('qrModal');
  const closeQrModalBtn = document.getElementById('closeQrModalBtn');
  const qrUrlLabel = document.getElementById('qrUrlLabel');
  const copyQrUrlBtn = document.getElementById('copyQrUrlBtn');
  const downloadQrBtn = document.getElementById('downloadQrBtn');

  function openQrModal(url) {
    const rawUrl = url || (tunnelUrlInput ? tunnelUrlInput.value : '') || window.location.origin;
    const finalUrl = (rawUrl || '').trim();
    if (qrUrlLabel) {
      qrUrlLabel.textContent = finalUrl;
    }
    const container = document.getElementById('qrCodeContainer');
    let canvas = document.getElementById('qrCanvas');
    if (!canvas && container) {
      container.innerHTML = '<canvas id="qrCanvas"></canvas>';
      canvas = document.getElementById('qrCanvas');
    }

    const drawQr = () => {
      if (!canvas) canvas = document.getElementById('qrCanvas');
      if (typeof QRCode !== 'undefined' && canvas) {
        QRCode.toCanvas(canvas, finalUrl, {
          width: 240,
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' }
        }, err => {
          if (err && console && console.error) console.error(err);
        });
      }
    };

    if (typeof QRCode !== 'undefined') {
      drawQr();
    } else {
      const s = document.createElement('script');
      s.src = '/js/qrcode.min.js';
      s.onload = () => drawQr();
      s.onerror = () => {
        const fallback = document.createElement('script');
        fallback.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.1/build/qrcode.min.js';
        fallback.onload = () => drawQr();
        fallback.onerror = () => {
          if (container) {
            container.innerHTML = '<div style="padding:20px;font-size:12px;color:#888;">Помилка завантаження бібліотеки QR-коду.</div>';
          }
        };
        document.head.appendChild(fallback);
      };
      document.head.appendChild(s);
    }

    if (qrModal) {
      qrModal.classList.remove('hidden');
    }
  }

  if (showQrBtn) {
    showQrBtn.addEventListener('click', () => {
      const currentUrl = (tunnelUrlInput && tunnelUrlInput.value) || window.location.origin;
      openQrModal(currentUrl);
    });
  }
  if (closeQrModalBtn) {
    closeQrModalBtn.addEventListener('click', () => {
      if (qrModal) qrModal.classList.add('hidden');
    });
  }
  if (qrModal) {
    qrModal.addEventListener('click', e => {
      if (e.target === qrModal) qrModal.classList.add('hidden');
    });
  }
  if (copyQrUrlBtn) {
    copyQrUrlBtn.addEventListener('click', () => {
      const url = qrUrlLabel ? qrUrlLabel.textContent : '';
      if (url) {
        navigator.clipboard.writeText(url);
        copyQrUrlBtn.textContent = '✓ Скопійовано!';
        setTimeout(() => { copyQrUrlBtn.textContent = 'Копіювати посилання'; }, 2000);
      }
    });
  }
  if (downloadQrBtn) {
    downloadQrBtn.addEventListener('click', () => {
      const canvas = document.getElementById('qrCanvas');
      if (!canvas || !canvas.width || !canvas.height) return;
      const url = qrUrlLabel ? qrUrlLabel.textContent : '';
      const exportCanvas = document.createElement('canvas');
      const padding = 24;
      const textHeight = url ? 44 : 0;
      exportCanvas.width = canvas.width + padding * 2;
      exportCanvas.height = canvas.height + padding * 2 + textHeight;
      const ctx = exportCanvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
      ctx.drawImage(canvas, padding, padding);
      if (url) {
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 13px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('SecureExam', exportCanvas.width / 2, canvas.height + padding + 18);
        ctx.fillStyle = '#64748b';
        ctx.font = '10px monospace';
        const displayUrl = url.length > 38 ? url.slice(0, 35) + '...' : url;
        ctx.fillText(displayUrl, exportCanvas.width / 2, canvas.height + padding + 34);
      }

      const saveBlob = blob => {
        const link = document.createElement('a');
        link.download = 'secureexam-qr.png';
        if (blob) {
          const blobUrl = URL.createObjectURL(blob);
          link.href = blobUrl;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
        } else {
          link.href = exportCanvas.toDataURL('image/png');
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
        const prevText = downloadQrBtn.textContent;
        downloadQrBtn.textContent = '✓ Завантажено!';
        setTimeout(() => { downloadQrBtn.textContent = prevText; }, 2000);
      };

      if (exportCanvas.toBlob) {
        exportCanvas.toBlob(saveBlob, 'image/png');
      } else {
        saveBlob(null);
      }
    });
  }

  initTabNavigation();
  initMultiTestControls();
  initTestEditor();
  initAnalyticsControls();
  initLeaderboardControls();
  initLiveRadarControls();
  initClassesControls();
  initSystemUpdateControls();
  initSessionsExport();
  initImportQuestionsControls();
  loadAdminTestsList();
}

async function checkTunnelStatus() {
  try {
    const res = await fetch('/api/tunnel');
    if (res.ok) {
      const data = await res.json();
      if (data.active && data.publicUrl) {
        tunnelStatusText.innerHTML = '<span style="color: var(--accent-emerald);">● Активний ngrok тунель (доступний з будь-якого телефону)</span>';
        tunnelUrlInput.value = data.publicUrl;
        return;
      }
      if (data.localUrl) {
        tunnelStatusText.innerHTML = `<span style="color: var(--accent-amber);">● Локальний Wi-Fi: <strong>${data.localUrl}</strong> (ngrok не активний)</span>`;
        tunnelUrlInput.value = data.localUrl;
        return;
      }
    }
  } catch {}
  const fallbackUrl = window.location.origin;
  tunnelStatusText.innerHTML = `<span style="color: var(--accent-amber);">Локальна адреса: <strong>${fallbackUrl}</strong></span>`;
  tunnelUrlInput.value = fallbackUrl;
}

function initWebSocket() {
  try {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      adminWsStatusDot.className = 'status-dot';
      adminWsStatusText.textContent = 'Зв\'язок онлайн';
      ws.send(JSON.stringify({
        type: 'register',
        sessionId: 'admin_' + Date.now(),
        role: 'admin'
      }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleWsMessage(data);
      } catch (err) {
        console.error(err);
      }
    };

    ws.onclose = () => {
      adminWsStatusDot.className = 'status-dot danger';
      adminWsStatusText.textContent = 'Перепідключення...';
      setTimeout(initWebSocket, 3000);
    };
  } catch (err) {
    console.error(err);
  }
}

function showAdminToast(msg, isSuccess = true) {
  const existing = document.querySelector('.admin-toast-banner');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'admin-toast-banner';
  toast.innerHTML = `<img src="/img/icons/${isSuccess ? 'check' : 'warning'}.svg" class="pixel-icon inline" alt=""> <span>${msg}</span>`;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    setTimeout(() => toast.remove(), 350);
  }, 4000);
}

function handleWsMessage(data) {
  if (data.type === 'online_students_snapshot') {
    onlineStudentsMap.clear();
    (data.students || []).forEach(s => onlineStudentsMap.set(s.sessionId, s));
    renderLiveRadarGrid();
  } else if (data.type === 'new_incident') {
    incidentsCount++;
    liveEventsCount.textContent = `${incidentsCount} подій`;
    appendLiveIncident(data.incident);
    loadSessions();
    renderLiveRadarGrid();
    if (selectedSessionId === data.sessionId) {
      inspectSession(selectedSessionId);
    }
  } else if (data.type === 'session_completed') {
    onlineStudentsMap.delete(data.sessionId);
    renderLiveRadarGrid();
    if (data.result) {
      const score12 = data.result.score12 !== undefined ? data.result.score12 : (data.result.totalQuestions > 0 ? Math.min(12, Math.max(1, Math.round((data.result.rawScore / data.result.totalQuestions) * 12))) : 1);
      appendLiveIncident({
        id: 'completed_' + Date.now(),
        category: 'info',
        studentName: data.result.studentName || 'Студент',
        timestamp: Date.now(),
        message: `Завершив тестування! Оцінка: ${score12} / 12 балів (${data.result.scorePercentage}%), Довіра: ${data.result.trustScore}%`
      });
      showAdminToast(`Студент ${data.result.studentName || ''} склав тест на ${score12}/12 балів (${data.result.scorePercentage}%)`);
    }
    loadSessions();
    if (selectedSessionId === data.sessionId) {
      inspectSession(selectedSessionId);
    }
    loadAdminLeaderboard(selectedAdminTestId);
    loadTestAnalytics(selectedAdminTestId);
  } else if (data.type === 'student_status_change') {
    if (data.status === 'online') {
      if (!onlineStudentsMap.has(data.sessionId)) {
        onlineStudentsMap.set(data.sessionId, {
          sessionId: data.sessionId,
          lastSeen: data.timestamp || Date.now(),
          latency: 0,
          questionIndex: 1,
          totalQuestions: 1
        });
      }
    } else {
      onlineStudentsMap.delete(data.sessionId);
    }
    renderLiveRadarGrid();
    loadSessions();
  } else if (data.type === 'student_ping') {
    const sess = sessions.find(s => s.id === data.sessionId);
    if (sess) {
      sess.lastLatency = data.latency;
    }
    const student = onlineStudentsMap.get(data.sessionId);
    if (student) {
      student.latency = data.latency;
      student.lastSeen = data.timestamp || Date.now();
    }
    const valEl = document.getElementById(`ping-val-${data.sessionId}`);
    if (valEl) {
      valEl.textContent = `${data.latency} ms`;
      valEl.style.color = data.latency > 250 ? 'var(--accent-amber)' : 'var(--accent-green)';
    }
    renderLiveRadarGrid();
  } else if (data.type === 'student_progress') {
    const student = onlineStudentsMap.get(data.sessionId);
    if (student) {
      student.questionIndex = data.questionIndex;
      student.totalQuestions = data.totalQuestions;
      student.lastSeen = data.timestamp || Date.now();
      renderLiveRadarGrid();
    }
  } else if (data.type === 'session_deleted' || data.type === 'all_sessions_cleared') {
    loadSessions();
    renderLiveRadarGrid();
  }
}

function appendLiveIncident(incident) {
  if (incidentsCount === 1) {
    liveIncidentsFeed.innerHTML = '';
  }

  const item = document.createElement('div');
  item.className = 'timeline-item';
  const isCheat = incident.category === 'cheating_attempt' || incident.category === 'devtools_opened';
  const icon = isCheat
    ? '<img src="/img/icons/warning.svg" class="pixel-icon" alt="">'
    : (incident.category === 'network_issue'
      ? '<img src="/img/icons/signal.svg" class="pixel-icon" alt="">'
      : '<img src="/img/icons/info.svg" class="pixel-icon" alt="">');

  item.innerHTML = `
    <div class="timeline-icon">${icon}</div>
    <div class="timeline-details">
      <div class="timeline-header">
        <span class="timeline-name">${incident.studentName || 'Студент'}</span>
        <span class="timeline-time">${new Date(incident.timestamp).toLocaleTimeString()}</span>
      </div>
      <div class="timeline-text">
        <strong>${incident.message}</strong>
        ${incident.penalty ? ` (Штраф: -${incident.penalty}%)` : ''}
      </div>
    </div>
  `;

  liveIncidentsFeed.insertBefore(item, liveIncidentsFeed.firstChild);
}

async function loadSessions() {
  try {
    const res = await adminFetch('/api/admin/sessions');
    if (!res.ok) throw new Error('Помилка завантаження');
    sessions = await res.json();
    renderSessionsTable();
  } catch (err) {
    console.error(err);
  }
}

function populateSessionClassFilter() {
  const sel = document.getElementById('sessionClassFilter');
  if (!sel) return;
  const currentVal = sel.value;
  const classes = [...new Set(sessions.map(s => s.studentId).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">Усі класи</option>';
  classes.forEach(cls => {
    const opt = document.createElement('option');
    opt.value = cls;
    opt.textContent = cls;
    if (cls === currentVal) opt.selected = true;
    sel.appendChild(opt);
  });
}

function renderSessionsTable() {
  populateSessionClassFilter();

  const classFilterEl = document.getElementById('sessionClassFilter');
  const sortEl = document.getElementById('sessionSortSelect');
  const classVal = classFilterEl ? classFilterEl.value : '';
  const sortVal = sortEl ? sortEl.value : sessionSortMode;

  let list = sessions.slice();
  if (classVal) {
    list = list.filter(s => s.studentId === classVal);
  }

  if (sortVal === 'class_asc') {
    list.sort((a, b) => (a.studentId || '').localeCompare(b.studentId || ''));
  } else if (sortVal === 'class_desc') {
    list.sort((a, b) => (b.studentId || '').localeCompare(a.studentId || ''));
  } else if (sortVal === 'score_desc') {
    list.sort((a, b) => {
      const sa = a.score12 !== undefined ? a.score12 : (a.totalQuestions > 0 ? Math.min(12, Math.max(1, Math.round((a.rawScore / a.totalQuestions) * 12))) : 0);
      const sb = b.score12 !== undefined ? b.score12 : (b.totalQuestions > 0 ? Math.min(12, Math.max(1, Math.round((b.rawScore / b.totalQuestions) * 12))) : 0);
      return sb - sa;
    });
  } else if (sortVal === 'name_asc') {
    list.sort((a, b) => (a.studentName || '').localeCompare(b.studentName || ''));
  } else {
    list.sort((a, b) => new Date(b.startedAt || 0) - new Date(a.startedAt || 0));
  }

  if (list.length === 0) {
    sessionsTableBody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; color: var(--text-dim); padding: 30px;">
          Жодної тестової сесії ще не запущено.
        </td>
      </tr>
    `;
    return;
  }

  sessionsTableBody.innerHTML = '';
  list.forEach((s) => {
    const tr = document.createElement('tr');

    let trustBadgeClass = 'approved';
    if (s.trustScore < 50) trustBadgeClass = 'danger';
    else if (s.trustScore < 80) trustBadgeClass = 'warning';

    let verdictBadge = '<span class="tag-badge warning">У процесі</span>';
    if ((s.status === 'completed' || s.status === 'disqualified') && s.finalVerdict) {
      if (s.finalVerdict.decision === 'PERFECT_INTEGRITY' || s.finalVerdict.decision === 'APPROVED_WITH_NETWORK_NOTICES') {
        verdictBadge = '<span class="tag-badge approved">Схвалено</span>';
      } else if (s.finalVerdict.decision === 'REVIEW_REQUIRED') {
        verdictBadge = '<span class="tag-badge warning">Підозра</span>';
      } else if (s.finalVerdict.decision === 'ANNULLED_SPLIT_SCREEN') {
        verdictBadge = '<span class="tag-badge danger">Анульовано (Split Screen)</span>';
      } else {
        verdictBadge = '<span class="tag-badge danger">Анульовано</span>';
      }
    } else if (s.status === 'disqualified') {
      verdictBadge = '<span class="tag-badge danger">Дискваліфіковано</span>';
    }

    let scoreDisplay = '<span style="color: var(--text-dim); font-size: 11px;">В процесі...</span>';
    if (s.status === 'completed' || s.status === 'disqualified') {
      const score12 = s.score12 !== undefined ? s.score12 : (s.totalQuestions > 0 ? Math.min(12, Math.max(1, Math.round((s.rawScore / s.totalQuestions) * 12))) : 1);
      const scoreColor = score12 >= 10 ? 'var(--accent-green)' : (score12 >= 7 ? 'var(--accent-blue)' : (score12 >= 4 ? 'var(--accent-amber)' : 'var(--accent-red)'));
      scoreDisplay = `
        <div style="font-size: 15px; font-weight: 800; color: ${scoreColor};">${score12} / 12 б.</div>
        <div style="font-size: 10px; color: var(--text-muted);">${s.rawScore || 0} з ${s.totalQuestions || 0} (${s.scorePercentage || 0}%)</div>
      `;
    }

    const netStats = s.networkStats || { averageLatency: 0, packetLossCount: 0 };
    const livePing = s.lastLatency !== undefined ? s.lastLatency : netStats.averageLatency;

    const isMob = s.clientInfo && (s.clientInfo.isMobile || s.clientInfo.deviceType === 'mobile');
    const deviceBadge = isMob
      ? '<span style="font-size: 11px; color: var(--accent-cyan); display: inline-flex; align-items: center; gap: 4px;"><img src="/img/icons/mobile.svg" class="pixel-icon inline" alt=""> Мобільний</span>'
      : '<span style="font-size: 11px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 4px;"><img src="/img/icons/desktop.svg" class="pixel-icon inline" alt=""> ПК</span>';

    let finishInfo = '';
    if (s.submittedAt) {
      const submitDate = new Date(s.submittedAt);
      const timeStr = submitDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      finishInfo = `<div style="font-size: 11px; color: var(--accent-green); font-weight: 600; margin-top: 4px; display: inline-flex; align-items: center; gap: 4px;"><img src="/img/icons/check.svg" class="pixel-icon inline" alt=""> Завершив о ${timeStr}</div>`;
    } else if (s.status === 'completed') {
      finishInfo = `<div style="font-size: 11px; color: var(--accent-green); font-weight: 600; margin-top: 4px;">✓ Завершив тест</div>`;
    }

    tr.innerHTML = `
      <td>
        <strong>${s.studentName}</strong>
        <div style="font-size: 11px; color: var(--text-dim);">${s.id} • ${deviceBadge}</div>
        ${finishInfo}
      </td>
      <td>${s.studentId}</td>
      <td>${scoreDisplay}</td>
      <td>
        <span class="tag-badge ${trustBadgeClass}">${s.trustScore}%</span>
      </td>
      <td>
        <div style="font-size: 13px; font-weight: 700;" id="ping-val-${s.id}">${livePing} ms</div>
        <div style="font-size: 10px; color: var(--text-dim);">Втрат: ${netStats.packetLossCount}</div>
      </td>
      <td>${verdictBadge}</td>
      <td style="white-space: nowrap;">
        <button class="btn-secondary" style="font-size: 11px; padding: 5px 10px;" onclick="window.inspectSession('${s.id}')">
          Аналіз
        </button>
        <button class="btn-secondary" style="font-size: 11px; padding: 5px 8px; border-color: var(--accent-red); color: var(--accent-red); margin-left: 4px;" onclick="window.deleteSession('${s.id}')" title="Видалити результат">
          <img src="/img/icons/trash.svg" class="pixel-icon inline" alt="">
        </button>
      </td>
    `;
    sessionsTableBody.appendChild(tr);
  });
}

window.inspectSession = async function(sessionId) {
  selectedSessionId = sessionId;
  try {
    const res = await adminFetch(`/api/admin/sessions/${sessionId}`);
    if (!res.ok) throw new Error('Помилка завантаження деталей сесії');
    const data = await res.json();
    currentDetailData = data;

    sessionDetailPlaceholder.classList.add('hidden');
    sessionDetailContent.classList.remove('hidden');

    detailStudentName.textContent = data.session.studentName;
    detailStudentMeta.textContent = `ID: ${data.session.studentId} | IP: ${data.session.clientIp || '127.0.0.1'} | Сесія: ${data.session.id}`;

    const sess = data.session;
    const score12Box = document.getElementById('detailScore12Display');
    const score12Sub = document.getElementById('detailScore12Sub');
    if (sess.status === 'completed' || sess.status === 'disqualified') {
      const s12 = sess.score12 !== undefined ? sess.score12 : (sess.totalQuestions > 0 ? Math.min(12, Math.max(1, Math.round((sess.rawScore / sess.totalQuestions) * 12))) : 1);
      if (score12Box) score12Box.textContent = `${s12} / 12 балів`;
      if (score12Sub) score12Sub.textContent = `Правильних відповідей: ${sess.rawScore || 0} з ${sess.totalQuestions || 0} (${sess.scorePercentage || 0}%)`;
    } else {
      if (score12Box) score12Box.textContent = 'Тест триває';
      if (score12Sub) score12Sub.textContent = 'Оцінку буде сформовано після здачі';
    }

    if (data.session.finalVerdict) {
      detailVerdictBox.innerHTML = `
        <strong>${data.session.finalVerdict.decision}</strong><br>
        ${data.session.finalVerdict.reason}<br>
        <small style="color: var(--text-dim);">Порушень списування: ${data.session.finalVerdict.cheatingCount} | Мережевих збоїв: ${data.session.finalVerdict.networkCount}</small>
      `;
    } else {
      detailVerdictBox.textContent = 'Тестування триває. Остаточний вердикт формується.';
    }

    drawPingGraph(data.pings || []);

    const unlockBtn = document.getElementById('overrideUnlockBtn');
    const bypassBtn = document.getElementById('overrideBypassBtn');
    const overrideMsg = document.getElementById('overrideStatusMsg');
    const deleteBtn = document.getElementById('deleteSessionBtn');

    if (deleteBtn) {
      deleteBtn.onclick = () => window.deleteSession(sessionId);
    }

    if (unlockBtn) {
      unlockBtn.disabled = false;
      unlockBtn.onclick = async () => {
        unlockBtn.disabled = true;
        overrideMsg.textContent = 'Відправка...';
        try {
          const r = await adminFetch(`/api/admin/sessions/${sessionId}/override-unlock`, { method: 'POST' });
          if (r.ok) {
            overrideMsg.style.color = '#10b981';
            overrideMsg.textContent = 'Сесію розблоковано з довірою 70%. Студент отримав повідомлення.';
            await loadSessions();
            inspectSession(sessionId);
          } else {
            const err = await r.json();
            overrideMsg.style.color = 'var(--accent-red)';
            overrideMsg.textContent = err.error || 'Помилка';
          }
        } catch {
          overrideMsg.style.color = 'var(--accent-red)';
          overrideMsg.textContent = 'Мережева помилка';
        } finally {
          unlockBtn.disabled = false;
        }
      };
    }

    if (bypassBtn) {
      bypassBtn.disabled = false;
      if (data.session && data.session.proctorBypassed) {
        bypassBtn.innerHTML = '<img src="/img/icons/check.svg" class="pixel-icon inline" alt=""> Безпеку вже знято (моніторинг вимкнено)';
      } else {
        bypassBtn.innerHTML = '<img src="/img/icons/key.svg" class="pixel-icon inline" alt=""> Забрати безпеку (повний аварійний доступ)';
      }

      bypassBtn.onclick = async () => {
        if (!confirm('Вимкнути ВЕСЬ прокторинг (забрати безпеку) для цього студента?')) return;
        bypassBtn.disabled = true;
        overrideMsg.textContent = 'Відправка...';
        try {
          const r = await adminFetch(`/api/admin/sessions/${sessionId}/override-bypass`, { method: 'POST' });
          if (r.ok) {
            overrideMsg.style.color = '#6366f1';
            overrideMsg.textContent = 'Режим перевірки відключено (безпеку знято). Студент може складати без обмежень.';
            await loadSessions();
            inspectSession(sessionId);
          } else {
            const err = await r.json();
            overrideMsg.style.color = 'var(--accent-red)';
            overrideMsg.textContent = err.error || 'Помилка';
          }
        } catch {
          overrideMsg.style.color = 'var(--accent-red)';
          overrideMsg.textContent = 'Мережева помилка';
        } finally {
          bypassBtn.disabled = false;
        }
      };
    }
  } catch (err) {
    console.error(err);
  }
};

window.deleteSession = async function(sessionId) {
  if (!confirm(`Ви дійсно бажаєте видалити результат цієї сесії (${sessionId})?`)) return;
  try {
    const res = await adminFetch(`/api/admin/sessions/${sessionId}`, { method: 'DELETE' });
    if (res.ok) {
      showAdminToast('Сесію успішно видалено');
      if (selectedSessionId === sessionId) {
        selectedSessionId = null;
        sessionDetailContent.classList.add('hidden');
        sessionDetailPlaceholder.classList.remove('hidden');
      }
      await loadSessions();
    } else {
      const err = await res.json();
      alert(err.error || 'Помилка видалення');
    }
  } catch (e) {
    alert('Помилка: ' + e.message);
  }
};

function drawPingGraph(pings) {
  const canvas = detailPingCanvas;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;

  canvas.width = canvas.parentElement.clientWidth * dpr;
  canvas.height = canvas.parentElement.clientHeight * dpr;
  ctx.scale(dpr, dpr);

  const w = canvas.parentElement.clientWidth;
  const h = canvas.parentElement.clientHeight;

  ctx.clearRect(0, 0, w, h);

  if (pings.length < 2) {
    ctx.fillStyle = '#64748b';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Накопичення даних пінг-телеметрії...', w / 2, h / 2);
    return;
  }

  const maxLatency = Math.max(300, ...pings.map(p => p.latency));

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();

  ctx.beginPath();
  pings.forEach((p, idx) => {
    const x = (idx / (pings.length - 1)) * w;
    const y = h - (Math.min(p.latency, maxLatency) / maxLatency) * (h - 15) - 5;
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.strokeStyle = '#06b6d4';
  ctx.lineWidth = 2;
  ctx.stroke();

  pings.forEach((p, idx) => {
    const x = (idx / (pings.length - 1)) * w;
    const y = h - (Math.min(p.latency, maxLatency) / maxLatency) * (h - 15) - 5;

    ctx.fillStyle = p.latency > 250 ? '#f59e0b' : '#10b981';
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });
}

function exportSelectedSession() {
  if (!currentDetailData) return;
  const blob = new Blob([JSON.stringify(currentDetailData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit_${currentDetailData.session.studentName}_${currentDetailData.session.id}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function switchTabTo(tabName) {
  const tabs = {
    sessions: { btn: document.getElementById('tabBtnSessions'), view: document.getElementById('viewSessionsTab') },
    liveRadar: { btn: document.getElementById('tabBtnLiveRadar'), view: document.getElementById('viewLiveRadarTab') },
    analytics: { btn: document.getElementById('tabBtnAnalytics'), view: document.getElementById('viewAnalyticsTab') },
    leaderboard: { btn: document.getElementById('tabBtnLeaderboard'), view: document.getElementById('viewLeaderboardTab') },
    classes: { btn: document.getElementById('tabBtnClasses'), view: document.getElementById('viewClassesTab') },
    testEditor: { btn: document.getElementById('tabBtnTestEditor'), view: document.getElementById('viewTestEditorTab') }
  };

  Object.keys(tabs).forEach(k => {
    const t = tabs[k];
    if (t.btn) t.btn.classList.toggle('active', k === tabName);
    if (t.view) t.view.classList.toggle('hidden', k !== tabName);
  });

  if (tabName === 'sessions') {
    loadSessions();
  } else if (tabName === 'liveRadar') {
    renderLiveRadarGrid();
  } else if (tabName === 'analytics') {
    loadTestAnalytics(selectedAdminTestId);
  } else if (tabName === 'leaderboard') {
    loadAdminLeaderboard(selectedAdminTestId);
  } else if (tabName === 'classes') {
    loadAdminClasses();
  } else if (tabName === 'testEditor') {
    loadAdminTest();
  }
}

function initTabNavigation() {
  const tabBtnSessions = document.getElementById('tabBtnSessions');
  const tabBtnLiveRadar = document.getElementById('tabBtnLiveRadar');
  const tabBtnAnalytics = document.getElementById('tabBtnAnalytics');
  const tabBtnLeaderboard = document.getElementById('tabBtnLeaderboard');
  const tabBtnClasses = document.getElementById('tabBtnClasses');
  const tabBtnTestEditor = document.getElementById('tabBtnTestEditor');

  if (tabBtnSessions) tabBtnSessions.addEventListener('click', () => switchTabTo('sessions'));
  if (tabBtnLiveRadar) tabBtnLiveRadar.addEventListener('click', () => switchTabTo('liveRadar'));
  if (tabBtnAnalytics) tabBtnAnalytics.addEventListener('click', () => switchTabTo('analytics'));
  if (tabBtnLeaderboard) tabBtnLeaderboard.addEventListener('click', () => switchTabTo('leaderboard'));
  if (tabBtnClasses) tabBtnClasses.addEventListener('click', () => switchTabTo('classes'));
  if (tabBtnTestEditor) tabBtnTestEditor.addEventListener('click', () => switchTabTo('testEditor'));
}

const adminTestSearchInput = document.getElementById('adminTestSearchInput');
const adminTestSearchClearBtn = document.getElementById('adminTestSearchClearBtn');
const adminSubjectFilter = document.getElementById('adminSubjectFilter');
const adminTopicFilter = document.getElementById('adminTopicFilter');
const adminTestSortSelect = document.getElementById('adminTestSortSelect');

function populateAdminSubjectFilter() {
  if (!adminSubjectFilter) return;
  const currentVal = adminSubjectFilter.value;
  const subjects = [...new Set(allAdminTests.map(t => (t.subject || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'uk'));
  adminSubjectFilter.innerHTML = '<option value="">Усі предмети</option>';
  subjects.forEach(sb => {
    const opt = document.createElement('option');
    opt.value = sb;
    opt.textContent = sb;
    if (sb === currentVal) opt.selected = true;
    adminSubjectFilter.appendChild(opt);
  });
}

function populateAdminTopicFilter() {
  if (!adminTopicFilter) return;
  const currentVal = adminTopicFilter.value;
  const selectedSubject = adminSubjectFilter ? adminSubjectFilter.value.trim().toLowerCase() : '';
  let pool = allAdminTests;
  if (selectedSubject) {
    pool = pool.filter(t => (t.subject || '').trim().toLowerCase() === selectedSubject);
  }
  const topics = [...new Set(pool.map(t => (t.topic || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'uk'));
  adminTopicFilter.innerHTML = '<option value="">Усі теми</option>';
  topics.forEach(tp => {
    const opt = document.createElement('option');
    opt.value = tp;
    opt.textContent = tp;
    if (tp === currentVal) opt.selected = true;
    adminTopicFilter.appendChild(opt);
  });
  if (currentVal && !topics.includes(currentVal)) {
    adminTopicFilter.value = '';
  }
}

function renderAdminTestSelectorOptions() {
  if (!adminTestSelector) return;
  const q = adminTestSearchInput ? adminTestSearchInput.value.trim().toLowerCase() : '';
  const selectedSubject = adminSubjectFilter ? adminSubjectFilter.value.trim().toLowerCase() : '';
  const selectedTopic = adminTopicFilter ? adminTopicFilter.value.trim().toLowerCase() : '';
  const classFilterEl = document.getElementById('adminClassTestFilter');
  const selectedClassId = classFilterEl ? classFilterEl.value : '';
  const sortMode = adminTestSortSelect ? adminTestSortSelect.value : 'subject';

  let filtered = allAdminTests.slice();
  if (selectedClassId) {
    const cls = allClasses.find(c => c.id === selectedClassId);
    const assignedIds = cls ? (cls.assignedTests || []).map(t => typeof t === 'string' ? t : t.id) : [];
    filtered = filtered.filter(t => assignedIds.includes(t.id));
  }
  if (selectedSubject) {
    filtered = filtered.filter(t => (t.subject || '').trim().toLowerCase() === selectedSubject);
  }
  if (selectedTopic) {
    filtered = filtered.filter(t => (t.topic || '').trim().toLowerCase() === selectedTopic);
  }
  if (q) {
    filtered = filtered.filter(t =>
      (t.title || '').toLowerCase().includes(q) ||
      (t.topic || '').toLowerCase().includes(q) ||
      (t.subject || '').toLowerCase().includes(q) ||
      (t.tags || []).some(tag => tag.toLowerCase().includes(q))
    );
  }

  if (sortMode === 'title_asc') {
    filtered.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'uk'));
  } else if (sortMode === 'title_desc') {
    filtered.sort((a, b) => (b.title || '').localeCompare(a.title || '', 'uk'));
  } else if (sortMode === 'topic') {
    filtered.sort((a, b) => (a.topic || '').localeCompare(b.topic || '', 'uk') || (a.title || '').localeCompare(b.title || '', 'uk'));
  } else if (sortMode === 'questions_desc') {
    filtered.sort((a, b) => ((b.questions || []).length) - ((a.questions || []).length));
  } else if (sortMode === 'duration_desc') {
    filtered.sort((a, b) => (b.durationMinutes || 0) - (a.durationMinutes || 0));
  } else {
    filtered.sort((a, b) => (a.subject || '').localeCompare(b.subject || '', 'uk') || (a.topic || '').localeCompare(b.topic || '', 'uk') || (a.title || '').localeCompare(b.title || '', 'uk'));
  }

  adminTestSelector.innerHTML = '';
  if (filtered.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Тестів за фільтром не знайдено';
    adminTestSelector.appendChild(opt);
    return;
  }

  const distinctSubjects = [...new Set(filtered.map(t => (t.subject || '').trim() || 'Без предмета'))];
  if (sortMode === 'subject' && distinctSubjects.length > 1) {
    const grouped = {};
    filtered.forEach(t => {
      const s = (t.subject || '').trim() || 'Інші предмети';
      if (!grouped[s]) grouped[s] = [];
      grouped[s].push(t);
    });
    Object.keys(grouped).sort((a, b) => a.localeCompare(b, 'uk')).forEach(subjName => {
      const grp = document.createElement('optgroup');
      grp.label = `📚 ${subjName}`;
      grouped[subjName].forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        const topicLabel = t.topic ? `[${t.topic}] ` : '';
        opt.textContent = `${topicLabel}${t.title} (${(t.questions || []).length} пит., ${t.durationMinutes || 15} хв)`;
        grp.appendChild(opt);
      });
      adminTestSelector.appendChild(grp);
    });
  } else {
    filtered.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      const subjLabel = (distinctSubjects.length > 1 && t.subject) ? `[${t.subject}] ` : '';
      const topicLabel = t.topic ? `[${t.topic}] ` : '';
      opt.textContent = `${subjLabel}${topicLabel}${t.title} (${(t.questions || []).length} пит., ${t.durationMinutes || 15} хв)`;
      adminTestSelector.appendChild(opt);
    });
  }

  if (filtered.some(t => t.id === selectedAdminTestId)) {
    adminTestSelector.value = selectedAdminTestId;
  } else if (filtered[0]) {
    selectedAdminTestId = filtered[0].id;
    adminTestSelector.value = selectedAdminTestId;
    loadAdminTest();
    loadTestAnalytics(selectedAdminTestId);
    loadAdminLeaderboard(selectedAdminTestId);
  }
  updateActiveTestBadge();
}

async function loadAdminTestsList() {
  try {
    const res = await adminFetch('/api/admin/tests');
    if (!res.ok) return;
    allAdminTests = await res.json();
    if (!allAdminTests || allAdminTests.length === 0) return;

    try {
      const activeRes = await fetch('/api/active-test');
      if (activeRes.ok) {
        const activeData = await activeRes.json();
        if (activeData && activeData.id && allAdminTests.some(t => t.id === activeData.id)) {
          selectedAdminTestId = activeData.id;
        }
      }
    } catch {}

    populateAdminSubjectFilter();
    populateAdminTopicFilter();
    renderAdminTestSelectorOptions();
    if (typeof populateClassSubjectFilter === 'function') {
      populateClassSubjectFilter();
    }
  } catch (err) {
    console.error(err);
  }
}

function updateActiveTestBadge() {
  const current = allAdminTests.find(t => t.id === selectedAdminTestId);
  if (activeTestStatsBadge && current) {
    activeTestStatsBadge.textContent = `${(current.questions || []).length} питань • ${current.durationMinutes || 15} хв`;
  }
}

function initMultiTestControls() {
  if (adminTestSelector) {
    adminTestSelector.addEventListener('change', async () => {
      if (!adminTestSelector.value) return;
      selectedAdminTestId = adminTestSelector.value;
      updateActiveTestBadge();
      try {
        await adminFetch('/api/admin/active-test', {
          method: 'POST',
          body: JSON.stringify({ testId: selectedAdminTestId })
        });
        showAdminToast('Активний тест змінено для всіх учнів', true);
      } catch {}
      await loadAdminTest();
      await loadTestAnalytics(selectedAdminTestId);
      await loadAdminLeaderboard(selectedAdminTestId);
    });
  }

  if (adminTestSearchInput) {
    adminTestSearchInput.addEventListener('input', () => {
      if (adminTestSearchClearBtn) {
        adminTestSearchClearBtn.style.display = adminTestSearchInput.value ? 'block' : 'none';
      }
      renderAdminTestSelectorOptions();
    });
  }

  if (adminTestSearchClearBtn) {
    adminTestSearchClearBtn.addEventListener('click', () => {
      adminTestSearchInput.value = '';
      adminTestSearchClearBtn.style.display = 'none';
      adminTestSearchInput.focus();
      renderAdminTestSelectorOptions();
    });
  }

  if (adminSubjectFilter) {
    adminSubjectFilter.addEventListener('change', () => {
      populateAdminTopicFilter();
      renderAdminTestSelectorOptions();
    });
  }

  if (adminTopicFilter) {
    adminTopicFilter.addEventListener('change', () => {
      renderAdminTestSelectorOptions();
    });
  }

  if (adminTestSortSelect) {
    adminTestSortSelect.addEventListener('change', () => {
      renderAdminTestSelectorOptions();
    });
  }

  if (openCreateTestModalBtn) {
    openCreateTestModalBtn.addEventListener('click', () => {
      if (createTestErrorMsg) createTestErrorMsg.textContent = '';
      if (newTestTitleInput) newTestTitleInput.value = '';
      const newTestTopicInput = document.getElementById('newTestTopicInput');
      const newTestSubjectInput = document.getElementById('newTestSubjectInput');
      if (newTestTopicInput) newTestTopicInput.value = (adminTopicFilter && adminTopicFilter.value) ? adminTopicFilter.value : '';
      if (newTestSubjectInput) newTestSubjectInput.value = (adminSubjectFilter && adminSubjectFilter.value) ? adminSubjectFilter.value : 'Географія';
      if (newTestDurationInput) newTestDurationInput.value = '15';
      if (createTestModal) createTestModal.classList.remove('hidden');
      if (newTestTitleInput) setTimeout(() => newTestTitleInput.focus(), 50);
    });
  }

  if (closeCreateTestModalBtn) {
    closeCreateTestModalBtn.addEventListener('click', () => {
      if (createTestModal) createTestModal.classList.add('hidden');
    });
  }
  if (cancelCreateTestBtn) {
    cancelCreateTestBtn.addEventListener('click', () => {
      if (createTestModal) createTestModal.classList.add('hidden');
    });
  }

  if (submitCreateTestBtn) {
    submitCreateTestBtn.addEventListener('click', async () => {
      const title = newTestTitleInput.value.trim();
      const durationMinutes = parseInt(newTestDurationInput.value, 10) || 15;
      const newTestTopicInput = document.getElementById('newTestTopicInput');
      const newTestSubjectInput = document.getElementById('newTestSubjectInput');
      const topic = newTestTopicInput ? newTestTopicInput.value.trim() : '';
      const subject = newTestSubjectInput ? newTestSubjectInput.value.trim() : 'Географія';

      if (!title) {
        if (createTestErrorMsg) createTestErrorMsg.textContent = 'Вкажіть назву тесту!';
        return;
      }
      try {
        submitCreateTestBtn.disabled = true;
        const res = await adminFetch('/api/admin/tests', {
          method: 'POST',
          body: JSON.stringify({ title, durationMinutes, topic, subject, questions: [] })
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Помилка створення тесту');
        }
        const created = await res.json();
        if (createTestModal) createTestModal.classList.add('hidden');
        showAdminToast(`Створено тест: "${created.title}"`);
        selectedAdminTestId = created.id;
        await loadAdminTestsList();
        adminTestSelector.value = selectedAdminTestId;
        await loadAdminTest();
        switchTabTo('testEditor');
      } catch (err) {
        if (createTestErrorMsg) createTestErrorMsg.textContent = err.message;
      } finally {
        submitCreateTestBtn.disabled = false;
      }
    });
  }

  if (deleteActiveTestBtn) {
    deleteActiveTestBtn.addEventListener('click', async () => {
      const current = allAdminTests.find(t => t.id === selectedAdminTestId);
      const name = current ? current.title : selectedAdminTestId;
      if (!confirm(`Ви дійсно бажаєте видалити тест "${name}"?\nЦю дію неможливо скасувати!`)) return;

      try {
        const res = await adminFetch(`/api/admin/tests/${selectedAdminTestId}`, { method: 'DELETE' });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Помилка видалення');
        }
        showAdminToast('Тест видалено');
        await loadAdminTestsList();
        if (allAdminTests.length > 0) {
          selectedAdminTestId = allAdminTests[0].id;
          adminTestSelector.value = selectedAdminTestId;
        }
        await loadAdminTest();
        await loadTestAnalytics(selectedAdminTestId);
        await loadAdminLeaderboard(selectedAdminTestId);
      } catch (err) {
        alert('Помилка: ' + err.message);
      }
    });
  }
}

function renderLiveRadarGrid() {
  const grid = document.getElementById('liveRadarGrid');
  const countBadge = document.getElementById('liveRadarOnlineCount');
  const statOnline = document.getElementById('radarStatOnline');
  const statCompleted = document.getElementById('radarStatCompleted');
  const statIncidents = document.getElementById('radarStatIncidents');
  const statAvgPing = document.getElementById('radarStatAvgPing');

  const onlineList = Array.from(onlineStudentsMap.values());
  const onlineCount = onlineList.length;

  if (countBadge) countBadge.textContent = onlineCount;
  if (statOnline) statOnline.textContent = onlineCount;

  const completedCount = sessions.filter(s => s.status === 'completed').length;
  if (statCompleted) statCompleted.textContent = completedCount;

  const totalInc = sessions.reduce((acc, s) => acc + (s.incidentsCount || 0), 0) + incidentsCount;
  if (statIncidents) statIncidents.textContent = totalInc;

  if (onlineCount > 0) {
    const latencies = onlineList.map(s => s.latency || 0).filter(l => l > 0);
    const avgPing = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
    if (statAvgPing) statAvgPing.textContent = avgPing > 0 ? `${avgPing} ms` : 'Ок';
  } else {
    if (statAvgPing) statAvgPing.textContent = '-- ms';
  }

  if (!grid) return;

  if (onlineCount === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-dim); font-size: 13px;">
        Зараз немає активних онлайн-студентів. Студенти з'являться тут у реальному часі, коли відкриють сторінку тесту.
      </div>
    `;
    return;
  }

  grid.innerHTML = '';
  onlineList.forEach(student => {
    const sess = sessions.find(s => s.id === student.sessionId);
    const name = (sess && sess.studentName) ? sess.studentName : (student.studentName || 'Студент');
    const studentClass = (sess && sess.studentId) ? sess.studentId : '';
    const trust = (sess && sess.trustScore !== undefined) ? sess.trustScore : 100;
    const latency = student.latency || (sess && sess.lastLatency) || 0;
    const qIdx = student.questionIndex || 1;
    const qTotal = student.totalQuestions || (sess && sess.questions ? sess.questions.length : 1);
    const pct = Math.min(100, Math.round((qIdx / Math.max(1, qTotal)) * 100));

    const isHighPing = latency > 250;
    const isOffline = (Date.now() - (student.lastSeen || 0)) > 15000;

    const card = document.createElement('div');
    card.style.cssText = 'background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 14px; display: flex; flex-direction: column; gap: 10px; transition: transform 0.15s ease; cursor: pointer;';
    card.onmouseover = () => card.style.transform = 'translateY(-2px)';
    card.onmouseout = () => card.style.transform = 'none';

    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span class="status-dot ${isOffline ? 'danger' : (isHighPing ? 'warning' : '')}"></span>
            <strong style="font-size: 14px; color: var(--text);">${escapeHtml(name)}</strong>
          </div>
          ${studentClass ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">Клас: ${escapeHtml(studentClass)}</div>` : ''}
        </div>
        <span class="tag-badge ${trust >= 70 ? 'approved' : 'warning'}" style="font-size: 10px;">${trust}% довіри</span>
      </div>

      <div style="background: var(--bg-elevated); padding: 8px 10px; border-radius: var(--radius-sm); border: 1px solid var(--border);">
        <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 4px;">
          <span style="color: var(--text-muted);">Прогрес:</span>
          <span style="font-weight: 700; color: var(--accent-blue);">Питання ${qIdx} з ${qTotal}</span>
        </div>
        <div style="width: 100%; height: 6px; background: rgba(0,0,0,0.1); border-radius: 3px; overflow: hidden;">
          <div style="width: ${pct}%; height: 100%; background: var(--accent-blue); transition: width 0.3s ease;"></div>
        </div>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--text-muted);">
        <span style="display: inline-flex; align-items: center; gap: 4px;">
          <img src="/img/icons/signal.svg" class="pixel-icon inline" alt=""> ${latency > 0 ? `${latency} ms` : 'Онлайн'}
        </span>
        <button type="button" class="btn-secondary" style="font-size: 10px; padding: 3px 8px;">Сесія →</button>
      </div>
    `;

    card.onclick = () => {
      switchTabTo('sessions');
      inspectSession(student.sessionId);
    };

    grid.appendChild(card);
  });
}

function initLiveRadarControls() {
  const refreshBtn = document.getElementById('refreshLiveRadarBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', () => {
    loadSessions();
    renderLiveRadarGrid();
  });
}

async function loadTestAnalytics(testId = selectedAdminTestId) {
  const container = document.getElementById('analyticsQuestionsContainer');
  if (!container) return;

  try {
    const res = await adminFetch(`/api/admin/tests/${encodeURIComponent(testId)}/analytics`);
    if (!res.ok) {
      container.innerHTML = '<div style="text-align: center; padding: 24px; color: var(--text-muted);">Аналітика недоступна для цього тесту.</div>';
      return;
    }
    const data = await res.json();

    const elTotal = document.getElementById('analyticsTotalParticipants');
    const elSub = document.getElementById('analyticsCompletionSub');
    const elScore12 = document.getElementById('analyticsAvgScore12');
    const elPct = document.getElementById('analyticsAvgPercent');
    const elTrust = document.getElementById('analyticsAvgTrust');

    if (elTotal) elTotal.textContent = data.totalParticipants || 0;
    if (elSub) elSub.textContent = `${data.completedCount || 0} завершено`;
    if (elScore12) elScore12.textContent = `${data.avgScore12 || 0} / 12`;
    if (elPct) elPct.textContent = `${data.avgScorePercent || 0}%`;
    if (elTrust) elTrust.textContent = `${data.avgTrustScore || 100}%`;

    const qList = data.questionsAnalytics || [];
    if (qList.length === 0) {
      container.innerHTML = '<div style="text-align: center; padding: 24px; color: var(--text-muted);">У тесті немає питань для відображення аналітики.</div>';
      return;
    }

    container.innerHTML = '';
    qList.forEach(q => {
      const card = document.createElement('div');
      card.style.cssText = 'background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 14px 16px; display: flex; flex-direction: column; gap: 10px;';

      let diffBadge = `<span class="tag-badge approved" style="font-size: 10px;">🟢 Легке (${q.successRate}% успішності)</span>`;
      if (q.successRate < 50) {
        diffBadge = `<span class="tag-badge danger" style="font-size: 10px;">🔴 Складне (${q.successRate}% успішності)</span>`;
      } else if (q.successRate < 75) {
        diffBadge = `<span class="tag-badge warning" style="font-size: 10px;">🟡 Помірне (${q.successRate}% успішності)</span>`;
      }

      let optionsBarsHtml = '';
      (q.optionBreakdown || []).forEach(opt => {
        const isCorrect = opt.isCorrect;
        const barColor = isCorrect ? 'var(--accent-green)' : (opt.count > 0 && opt.percent >= 25 ? 'var(--accent-red)' : 'var(--text-muted)');
        const bgBar = isCorrect ? 'rgba(16, 185, 129, 0.16)' : 'rgba(0,0,0,0.06)';

        optionsBarsHtml += `
          <div style="display: flex; flex-direction: column; gap: 3px; font-size: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
              <span style="font-weight: ${isCorrect ? '700' : '400'}; color: ${isCorrect ? 'var(--accent-green)' : 'var(--text)'};">
                ${isCorrect ? '✓ ' : '• '}${escapeHtml(opt.text)}
              </span>
              <span style="font-weight: 600; color: ${barColor}; flex-shrink: 0;">
                ${opt.count} учнів (${opt.percent}%)
              </span>
            </div>
            <div style="width: 100%; height: 7px; background: ${bgBar}; border-radius: 4px; overflow: hidden;">
              <div style="width: ${opt.percent}%; height: 100%; background: ${barColor}; border-radius: 4px; transition: width 0.4s ease;"></div>
            </div>
          </div>
        `;
      });

      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 240px;">
            <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--accent); font-weight: 700; margin-bottom: 2px;">Питання #${q.index}</div>
            <div style="font-size: 14px; font-weight: 700; color: var(--text);">${escapeHtml(q.text)}</div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            ${diffBadge}
            <span style="font-size: 11px; color: var(--text-muted); background: var(--bg-elevated); padding: 4px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border); display: inline-flex; align-items: center; gap: 4px;">
              <img src="/img/icons/timer.svg" class="pixel-icon inline" alt=""> ${q.avgTimeSeconds} с / сер.
            </span>
          </div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 4px; background: var(--bg-elevated); padding: 10px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border);">
          <div style="font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px;">Розподіл відповідей (Heatmap):</div>
          ${optionsBarsHtml}
        </div>
      `;

      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = `<div style="color: var(--accent-red); padding: 24px;">Помилка: ${err.message}</div>`;
  }
}

function initAnalyticsControls() {
  const refreshBtn = document.getElementById('refreshAnalyticsBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', () => loadTestAnalytics(selectedAdminTestId));
}

async function loadAdminLeaderboard(testId = selectedAdminTestId) {
  const tbody = document.getElementById('adminLeaderboardTbody');
  if (!tbody) return;

  try {
    const url = testId ? `/api/leaderboard?testId=${encodeURIComponent(testId)}` : '/api/leaderboard';
    const res = await adminFetch(url);
    if (!res.ok) throw new Error('Помилка завантаження рейтингу');
    cachedLeaderboardData = await res.json();
    populateAdminLeaderboardClassFilter();
    renderAdminLeaderboardTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--accent-red); padding: 24px;">Помилка: ${err.message}</td></tr>`;
  }
}

function populateAdminLeaderboardClassFilter() {
  const sel = document.getElementById('adminLeaderboardClassFilter');
  if (!sel) return;
  const currentVal = sel.value;
  const classes = [...new Set(cachedLeaderboardData.map(i => i.studentId).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">Усі класи</option>';
  classes.forEach(cls => {
    const opt = document.createElement('option');
    opt.value = cls;
    opt.textContent = cls;
    if (cls === currentVal) opt.selected = true;
    sel.appendChild(opt);
  });
}

function renderAdminLeaderboardTable() {
  const tbody = document.getElementById('adminLeaderboardTbody');
  if (!tbody) return;

  const classFilterEl = document.getElementById('adminLeaderboardClassFilter');
  const sortEl = document.getElementById('adminLeaderboardSortSelect');
  const classVal = classFilterEl ? classFilterEl.value : '';
  const sortVal = sortEl ? sortEl.value : adminLeadSortMode;

  let list = cachedLeaderboardData.slice();
  if (classVal) {
    list = list.filter(i => i.studentId === classVal);
  }

  if (sortVal === 'class_asc') {
    list.sort((a, b) => (a.studentId || '').localeCompare(b.studentId || ''));
  } else if (sortVal === 'class_desc') {
    list.sort((a, b) => (b.studentId || '').localeCompare(a.studentId || ''));
  } else if (sortVal === 'name_asc') {
    list.sort((a, b) => (a.studentName || '').localeCompare(b.studentName || ''));
  } else {
    list.sort((a, b) => b.score12 - a.score12 || a.rank - b.rank);
  }

  if (!list || list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--text-dim); padding: 24px;">Сесій у рейтингу ще немає.</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  list.forEach((item, idx) => {
    let medal = `#${idx + 1}`;
    if (idx === 0) medal = '🥇 1';
    else if (idx === 1) medal = '🥈 2';
    else if (idx === 2) medal = '🥉 3';

    const mins = Math.floor(item.durationSeconds / 60);
    const secs = item.durationSeconds % 60;
    const durStr = `${mins > 0 ? `${mins} хв ` : ''}${secs} с`;
    const dateStr = item.submittedAt ? new Date(item.submittedAt).toLocaleString() : '—';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="text-align: center; font-weight: 700;">${medal}</td>
      <td><strong>${escapeHtml(item.studentName)}</strong></td>
      <td>${escapeHtml(item.studentId || '—')}</td>
      <td style="font-size: 11px; color: var(--text-muted);">${escapeHtml(item.testTitle || 'Тест')}</td>
      <td style="color: var(--accent-blue); font-weight: 800; font-size: 14px;">${item.score12} / 12</td>
      <td>${item.rawScore}/${item.totalQuestions} (${item.scorePercentage}%)</td>
      <td><span class="tag-badge ${item.trustScore >= 70 ? 'approved' : 'warning'}" style="font-size: 10px;">${item.trustScore}%</span></td>
      <td style="color: var(--text-muted); font-size: 11px;">${durStr}</td>
      <td style="color: var(--text-muted); font-size: 11px;">${dateStr}</td>
    `;
    tbody.appendChild(tr);
  });
}

function exportLeaderboardCsv() {
  const table = document.querySelector('#viewLeaderboardTab table');
  if (!table) return;
  const rows = Array.from(table.querySelectorAll('tr'));
  let csv = '\uFEFF';
  rows.forEach(r => {
    const cols = Array.from(r.querySelectorAll('th, td')).map(c => `"${c.textContent.replace(/"/g, '""').trim()}"`);
    csv += cols.join(';') + '\r\n';
  });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `leaderboard_${selectedAdminTestId}_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function initLeaderboardControls() {
  const refreshBtn = document.getElementById('refreshAdminLeaderboardBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', () => loadAdminLeaderboard(selectedAdminTestId));

  const exportBtn = document.getElementById('exportLeaderboardCsvBtn');
  if (exportBtn) exportBtn.addEventListener('click', exportLeaderboardCsv);

  const classFilter = document.getElementById('adminLeaderboardClassFilter');
  if (classFilter) classFilter.addEventListener('change', renderAdminLeaderboardTable);

  const sortSel = document.getElementById('adminLeaderboardSortSelect');
  if (sortSel) sortSel.addEventListener('change', renderAdminLeaderboardTable);

  const thName = document.getElementById('thLeadSortName');
  const thClass = document.getElementById('thLeadSortClass');
  const thScore = document.getElementById('thLeadSortScore');

  if (thName) thName.addEventListener('click', () => {
    const s = document.getElementById('adminLeaderboardSortSelect');
    if (s) { s.value = 'name_asc'; renderAdminLeaderboardTable(); }
  });
  if (thClass) thClass.addEventListener('click', () => {
    const s = document.getElementById('adminLeaderboardSortSelect');
    if (s) {
      s.value = s.value === 'class_asc' ? 'class_desc' : 'class_asc';
      renderAdminLeaderboardTable();
    }
  });
  if (thScore) thScore.addEventListener('click', () => {
    const s = document.getElementById('adminLeaderboardSortSelect');
    if (s) { s.value = 'rank_asc'; renderAdminLeaderboardTable(); }
  });
}

let currentAdminTest = null;
let editingQuestionId = null;

const editTestTitleInput = document.getElementById('editTestTitleInput');
const editTestDurationInput = document.getElementById('editTestDurationInput');
const saveTestMetaBtn = document.getElementById('saveTestMetaBtn');
const openAddQuestionBtn = document.getElementById('openAddQuestionBtn');
const openAiGenerateBtn = document.getElementById('openAiGenerateBtn');
const aiGenerateModal = document.getElementById('aiGenerateModal');
const closeAiModalBtn = document.getElementById('closeAiModalBtn');
const cancelAiModalBtn = document.getElementById('cancelAiModalBtn');
const startAiGenerateBtn = document.getElementById('startAiGenerateBtn');
const aiTopicInput = document.getElementById('aiTopicInput');
const aiCountInput = document.getElementById('aiCountInput') || document.getElementById('aiCountSelect');
const aiDifficultySelect = document.getElementById('aiDifficultySelect');
const aiTimeLimitInput = document.getElementById('aiTimeLimitInput');
const aiCustomPrompt = document.getElementById('aiCustomPrompt');
const aiModalError = document.getElementById('aiModalError');
const aiGeneratingIndicator = document.getElementById('aiGeneratingIndicator');
const aiSuccessIndicator = document.getElementById('aiSuccessIndicator');
const aiSuccessDetails = document.getElementById('aiSuccessDetails');
const aiStatusBanner = document.getElementById('aiStatusBanner');
const aiStatusBannerText = document.getElementById('aiStatusBannerText');
const closeAiStatusBannerBtn = document.getElementById('closeAiStatusBannerBtn');
const adminQuestionsList = document.getElementById('adminQuestionsList');
const questionsCountLabel = document.getElementById('questionsCountLabel');

const questionEditModal = document.getElementById('questionEditModal');
const qModalTitle = document.getElementById('qModalTitle');
const closeQModalBtn = document.getElementById('closeQModalBtn');
const cancelQModalBtn = document.getElementById('cancelQModalBtn');
const saveQuestionBtn = document.getElementById('saveQuestionBtn');
const qTextInput = document.getElementById('qTextInput');
const qTimeLimitInput = document.getElementById('qTimeLimitInput');
const optionsFormContainer = document.getElementById('optionsFormContainer');
const addOptionFieldBtn = document.getElementById('addOptionFieldBtn');
const qModalError = document.getElementById('qModalError');

async function loadAdminTest() {
  try {
    const res = await adminFetch(`/api/admin/tests/${encodeURIComponent(selectedAdminTestId)}`);
    if (!res.ok) throw new Error('Помилка завантаження тесту');
    currentAdminTest = await res.json();

    if (editTestTitleInput) editTestTitleInput.value = currentAdminTest.title || '';
    if (editTestDurationInput) editTestDurationInput.value = currentAdminTest.durationMinutes || 15;
    const editTestTopicInput = document.getElementById('editTestTopicInput');
    const editTestSubjectInput = document.getElementById('editTestSubjectInput');
    if (editTestTopicInput) editTestTopicInput.value = currentAdminTest.topic || '';
    if (editTestSubjectInput) editTestSubjectInput.value = currentAdminTest.subject || 'Географія';
    if (questionsCountLabel) {
      const qCount = (currentAdminTest.questions || []).length;
      questionsCountLabel.textContent = `Всього питань: ${qCount}`;
    }

    renderQuestionsList();
  } catch (err) {
    console.error(err);
    if (adminQuestionsList) {
      adminQuestionsList.innerHTML = `<div style="color: var(--accent-red); padding: 16px;">Помилка: ${err.message}</div>`;
    }
  }
}

function renderQuestionsList() {
  if (!adminQuestionsList || !currentAdminTest) return;
  const questions = currentAdminTest.questions || [];

  if (questions.length === 0) {
    adminQuestionsList.innerHTML = `
      <div class="card-panel" style="text-align: center; padding: 32px; color: var(--text-muted);">
        У тесті ще немає жодного питання. Натисніть кнопку «Додати нове питання», щоб створити перше питання.
      </div>
    `;
    return;
  }

  adminQuestionsList.innerHTML = '';
  questions.forEach((q, idx) => {
    const card = document.createElement('div');
    card.className = 'q-card';

    const header = document.createElement('div');
    header.className = 'q-card-header';

    const typeBadgeMap = {
      single: '<span class="tag-badge" style="font-size:10px;">🔘 Один варіант</span>',
      multiple: '<span class="tag-badge warning" style="font-size:10px;">☑️ Чекбокси</span>',
      matching: '<span class="tag-badge approved" style="font-size:10px;">🔗 Відповідність</span>',
      ordering: '<span class="tag-badge" style="font-size:10px; background:rgba(99,102,241,0.15); color:var(--accent);">🔢 Послідовність</span>'
    };
    const badgeHtml = typeBadgeMap[q.type || 'single'] || typeBadgeMap.single;

    const titleBox = document.createElement('div');
    titleBox.style.flex = '1';
    titleBox.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
        <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--accent); font-weight: 700;">Питання #${idx + 1} (ID: ${q.id})</span>
        ${badgeHtml}
      </div>
      <div class="q-card-title">${escapeHtml(q.text)}</div>
      <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px; display: inline-flex; align-items: center; gap: 4px;"><img src="/img/icons/timer.svg" class="pixel-icon inline" alt=""> Ліміт: ${q.timeLimitSeconds || 60} сек</div>
    `;

    const actionsBox = document.createElement('div');
    actionsBox.style.display = 'flex';
    actionsBox.style.gap = '8px';

    const editBtn = document.createElement('button');
    editBtn.className = 'btn-secondary btn-edit-question';
    editBtn.style.padding = '6px 14px';
    editBtn.style.fontSize = '12px';
    editBtn.style.fontWeight = '600';
    editBtn.style.color = 'var(--text)';
    editBtn.innerHTML = '<img src="/img/icons/edit.svg" class="pixel-icon inline" alt=""> Редагувати';
    editBtn.onclick = () => openEditQuestionModal(q);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn-secondary';
    delBtn.style.padding = '5px 12px';
    delBtn.style.fontSize = '12px';
    delBtn.style.color = 'var(--accent-red)';
    delBtn.innerHTML = '<img src="/img/icons/trash.svg" class="pixel-icon" alt="">';
    delBtn.title = 'Видалити питання';
    delBtn.onclick = () => deleteQuestion(q.id);

    actionsBox.appendChild(editBtn);
    actionsBox.appendChild(delBtn);
    header.appendChild(titleBox);
    header.appendChild(actionsBox);
    card.appendChild(header);

    const optGrid = document.createElement('div');
    optGrid.className = 'q-options-grid';

    if (q.type === 'matching') {
      const pairs = Array.isArray(q.matchingPairs) ? q.matchingPairs : [];
      pairs.forEach((p) => {
        const pill = document.createElement('div');
        pill.className = 'q-option-pill';
        pill.innerHTML = `<span>🔗</span> <span style="flex:1;"><strong>${escapeHtml(p.left)}</strong> ↔ ${escapeHtml(p.right)}</span>`;
        optGrid.appendChild(pill);
      });
    } else if (q.type === 'ordering') {
      const items = Array.isArray(q.orderingItems) ? q.orderingItems : (q.options || []);
      items.forEach((item, itIdx) => {
        const pill = document.createElement('div');
        pill.className = 'q-option-pill';
        pill.innerHTML = `<span style="font-weight:700; color:var(--accent);">${itIdx + 1}.</span> <span style="flex:1;">${escapeHtml(item)}</span>`;
        optGrid.appendChild(pill);
      });
    } else if (q.type === 'multiple') {
      const correctArr = Array.isArray(q.correct) ? q.correct.map(Number) : [Number(q.correct) || 0];
      (q.options || []).forEach((optText, optIdx) => {
        const isCorrect = correctArr.includes(optIdx);
        const pill = document.createElement('div');
        pill.className = 'q-option-pill' + (isCorrect ? ' correct' : '');
        pill.innerHTML = `
          <span>${isCorrect ? '☑️' : '◻️'}</span>
          <span style="flex:1;">${escapeHtml(optText)}</span>
          ${isCorrect ? '<strong style="font-size: 10px; text-transform: uppercase;">[Правильна]</strong>' : ''}
        `;
        optGrid.appendChild(pill);
      });
    } else {
      (q.options || []).forEach((optText, optIdx) => {
        const isCorrect = optIdx === q.correct;
        const pill = document.createElement('div');
        pill.className = 'q-option-pill' + (isCorrect ? ' correct' : '');
        pill.innerHTML = `
          <span>${isCorrect ? '<img src="/img/icons/check.svg" class="pixel-icon inline" alt="">' : '<img src="/img/icons/circle.svg" class="pixel-icon inline" alt="">'}</span>
          <span style="flex:1;">${escapeHtml(optText)}</span>
          ${isCorrect ? '<strong style="font-size: 10px; text-transform: uppercase;">[Правильна]</strong>' : ''}
        `;
        optGrid.appendChild(pill);
      });
    }

    card.appendChild(optGrid);
    adminQuestionsList.appendChild(card);
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

function updateQuestionFormVisibility(type) {
  const optionsSec = document.getElementById('optionsFormSection');
  const matchingSec = document.getElementById('matchingFormSection');
  const orderingSec = document.getElementById('orderingFormSection');
  const optionsTitle = document.getElementById('optionsSectionTitle');

  if (optionsSec) optionsSec.classList.add('hidden');
  if (matchingSec) matchingSec.classList.add('hidden');
  if (orderingSec) orderingSec.classList.add('hidden');

  if (type === 'matching') {
    if (matchingSec) matchingSec.classList.remove('hidden');
  } else if (type === 'ordering') {
    if (orderingSec) orderingSec.classList.remove('hidden');
  } else {
    if (optionsSec) optionsSec.classList.remove('hidden');
    if (optionsTitle) {
      optionsTitle.textContent = type === 'multiple'
        ? 'Варіанти відповідей (поставте галочки біля ВСІХ правильних) *'
        : 'Варіанти відповідей (оберіть одну правильну) *';
    }
  }
}

function openAddQuestionModal() {
  editingQuestionId = null;
  qModalTitle.innerHTML = '<img src="/img/icons/plus.svg" class="pixel-icon inline" alt=""> Додати нове питання до тесту';
  qTextInput.value = '';
  qTimeLimitInput.value = '60';
  qModalError.textContent = '';
  const qTypeSelect = document.getElementById('qTypeSelect');
  if (qTypeSelect) qTypeSelect.value = 'single';
  updateQuestionFormVisibility('single');
  renderOptionInputs(['', '', '', ''], 0, false);
  renderMatchingInputs([ { left: '', right: '' }, { left: '', right: '' } ]);
  renderOrderingInputs(['', '', '']);
  questionEditModal.classList.remove('hidden');
}

function openEditQuestionModal(q) {
  editingQuestionId = q.id;
  const type = q.type || 'single';
  qModalTitle.innerHTML = `<img src="/img/icons/edit.svg" class="pixel-icon inline" alt=""> Редагування питання ${q.id}`;
  qTextInput.value = q.text || '';
  qTimeLimitInput.value = q.timeLimitSeconds || 60;
  qModalError.textContent = '';
  const qTypeSelect = document.getElementById('qTypeSelect');
  if (qTypeSelect) qTypeSelect.value = type;
  updateQuestionFormVisibility(type);

  if (type === 'matching') {
    renderMatchingInputs(Array.isArray(q.matchingPairs) && q.matchingPairs.length > 0 ? q.matchingPairs : [ { left: '', right: '' } ]);
  } else if (type === 'ordering') {
    const items = Array.isArray(q.orderingItems) && q.orderingItems.length > 0 ? q.orderingItems : (Array.isArray(q.options) ? q.options : ['', '']);
    renderOrderingInputs(items);
  } else {
    renderOptionInputs(q.options || ['', ''], q.correct, type === 'multiple');
  }

  questionEditModal.classList.remove('hidden');
}

function closeQuestionModal() {
  questionEditModal.classList.add('hidden');
  editingQuestionId = null;
}

function renderOptionInputs(optionsArray, correctVal = 0, isMultiple = false) {
  optionsFormContainer.innerHTML = '';
  const list = optionsArray.length > 0 ? optionsArray : ['', ''];
  const correctArr = Array.isArray(correctVal) ? correctVal.map(Number) : [Number(correctVal) || 0];

  list.forEach((val, idx) => {
    const row = document.createElement('div');
    row.className = 'opt-form-row';

    const checkLabel = document.createElement('label');
    checkLabel.className = 'opt-radio-label';
    const isChecked = correctArr.includes(idx);

    if (isMultiple) {
      checkLabel.innerHTML = `
        <input type="checkbox" name="optCorrectCheck" value="${idx}" ${isChecked ? 'checked' : ''}>
        <span>Правильна</span>
      `;
    } else {
      checkLabel.innerHTML = `
        <input type="radio" name="optCorrectRadio" value="${idx}" ${isChecked ? 'checked' : ''}>
        <span>Правильна</span>
      `;
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-input opt-val-input';
    input.style.fontSize = '13px';
    input.style.padding = '7px 10px';
    input.placeholder = `Варіант ${idx + 1}`;
    input.value = val;

    row.appendChild(checkLabel);
    row.appendChild(input);

    if (list.length > 2) {
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'opt-del-btn';
      delBtn.innerHTML = '<img src="/img/icons/cross.svg" class="pixel-icon" alt="">';
      delBtn.title = 'Видалити цей варіант';
      delBtn.onclick = () => {
        const currentVals = Array.from(optionsFormContainer.querySelectorAll('.opt-val-input')).map(i => i.value);
        currentVals.splice(idx, 1);
        renderOptionInputs(currentVals, 0, isMultiple);
      };
      row.appendChild(delBtn);
    }

    optionsFormContainer.appendChild(row);
  });
}

function renderMatchingInputs(pairsArray) {
  const container = document.getElementById('matchingPairsContainer');
  if (!container) return;
  container.innerHTML = '';
  const list = Array.isArray(pairsArray) && pairsArray.length > 0 ? pairsArray : [{ left: '', right: '' }, { left: '', right: '' }];

  list.forEach((pair, idx) => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';

    row.innerHTML = `
      <span style="font-size:12px; font-weight:700; width:22px; color:var(--text-muted);">${idx + 1}.</span>
      <input type="text" class="form-input matching-left-input" placeholder="Елемент зліва (напр. Автор)" value="${escapeHtml(pair.left || '')}" style="flex:1; font-size:12px; padding:7px 10px;">
      <span style="color:var(--text-muted); font-weight:700;">↔</span>
      <input type="text" class="form-input matching-right-input" placeholder="Відповідник справа (напр. Твір)" value="${escapeHtml(pair.right || '')}" style="flex:1; font-size:12px; padding:7px 10px;">
      <button type="button" class="opt-del-btn matching-del-btn" title="Видалити пару"><img src="/img/icons/cross.svg" class="pixel-icon" alt=""></button>
    `;

    row.querySelector('.matching-del-btn').onclick = () => {
      if (container.children.length <= 2) {
        alert('Потрібно залишити щонайменше 2 пари для відповідності');
        return;
      }
      row.remove();
    };

    container.appendChild(row);
  });
}

function renderOrderingInputs(itemsArray) {
  const container = document.getElementById('orderingItemsContainer');
  if (!container) return;
  container.innerHTML = '';
  const list = Array.isArray(itemsArray) && itemsArray.length > 0 ? itemsArray : ['', '', ''];

  list.forEach((val, idx) => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';

    row.innerHTML = `
      <span class="ordering-row-idx" style="font-size:12px; font-weight:700; width:22px; color:var(--accent);">${idx + 1}.</span>
      <input type="text" class="form-input ordering-val-input" placeholder="Етап / подія #${idx + 1}" value="${escapeHtml(val || '')}" style="flex:1; font-size:12px; padding:7px 10px;">
      <button type="button" class="btn-secondary ordering-up-btn" style="width:28px; height:28px; padding:0; font-size:11px;" title="Вгору">↑</button>
      <button type="button" class="btn-secondary ordering-down-btn" style="width:28px; height:28px; padding:0; font-size:11px;" title="Вниз">↓</button>
      <button type="button" class="opt-del-btn ordering-del-btn" title="Видалити крок"><img src="/img/icons/cross.svg" class="pixel-icon" alt=""></button>
    `;

    row.querySelector('.ordering-up-btn').onclick = () => {
      const prev = row.previousElementSibling;
      if (prev) {
        container.insertBefore(row, prev);
        updateOrderingIndexes();
      }
    };

    row.querySelector('.ordering-down-btn').onclick = () => {
      const next = row.nextElementSibling;
      if (next) {
        container.insertBefore(next, row);
        updateOrderingIndexes();
      }
    };

    row.querySelector('.ordering-del-btn').onclick = () => {
      if (container.children.length <= 2) {
        alert('Потрібно залишити щонайменше 2 кроки для послідовності');
        return;
      }
      row.remove();
      updateOrderingIndexes();
    };

    container.appendChild(row);
  });
}

function updateOrderingIndexes() {
  const container = document.getElementById('orderingItemsContainer');
  if (!container) return;
  Array.from(container.children).forEach((child, idx) => {
    const idxSpan = child.querySelector('.ordering-row-idx');
    if (idxSpan) idxSpan.textContent = `${idx + 1}.`;
  });
}

function initTestEditor() {
  if (saveTestMetaBtn) {
    saveTestMetaBtn.addEventListener('click', async () => {
      const title = editTestTitleInput.value.trim();
      const durationMinutes = parseInt(editTestDurationInput.value, 10) || 15;
      const editTestTopicInput = document.getElementById('editTestTopicInput');
      const editTestSubjectInput = document.getElementById('editTestSubjectInput');
      const topic = editTestTopicInput ? editTestTopicInput.value.trim() : '';
      const subject = editTestSubjectInput ? editTestSubjectInput.value.trim() : 'Географія';
      if (!title) {
        alert('Введіть назву тесту');
        return;
      }
      try {
        saveTestMetaBtn.disabled = true;
        saveTestMetaBtn.textContent = 'Збереження...';
        const res = await adminFetch(`/api/admin/tests/${encodeURIComponent(selectedAdminTestId)}`, {
          method: 'PUT',
          body: JSON.stringify({ title, durationMinutes, topic, subject })
        });
        if (!res.ok) throw new Error('Помилка збереження');
        currentAdminTest = await res.json();
        const found = allAdminTests.find(t => t.id === selectedAdminTestId);
        if (found) {
          found.title = title;
          found.durationMinutes = durationMinutes;
          found.topic = topic;
          found.subject = subject;
          populateAdminSubjectFilter();
          populateAdminTopicFilter();
          renderAdminTestSelectorOptions();
          if (typeof populateClassSubjectFilter === 'function') {
            populateClassSubjectFilter();
          }
        }
        saveTestMetaBtn.innerHTML = '<img src="/img/icons/check.svg" class="pixel-icon inline" alt=""> Збережено!';
        setTimeout(() => {
          saveTestMetaBtn.disabled = false;
          saveTestMetaBtn.innerHTML = '<img src="/img/icons/save.svg" class="pixel-icon inline" alt=""> Зберегти налаштування';
        }, 1500);
      } catch (err) {
        alert('Помилка: ' + err.message);
        saveTestMetaBtn.disabled = false;
        saveTestMetaBtn.innerHTML = '<img src="/img/icons/save.svg" class="pixel-icon inline" alt=""> Зберегти налаштування';
      }
    });
  }

  if (openAddQuestionBtn) {
    openAddQuestionBtn.addEventListener('click', openAddQuestionModal);
  }

  const clearAllQuestionsBtn = document.getElementById('clearAllQuestionsBtn');
  if (clearAllQuestionsBtn) {
    clearAllQuestionsBtn.addEventListener('click', async () => {
      const qCount = (currentAdminTest && currentAdminTest.questions) ? currentAdminTest.questions.length : 0;
      if (qCount === 0) {
        showAdminToast('Список питань вже порожній.', false);
        return;
      }
      const confirmed = confirm(`Ви впевнені, що хочете видалити всі ${qCount} питань із тесту?\n\nЦю дію неможливо скасувати!`);
      if (!confirmed) return;
      try {
        clearAllQuestionsBtn.disabled = true;
        const res = await adminFetch(`/api/admin/tests/${encodeURIComponent(selectedAdminTestId)}/questions`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Помилка видалення');
        await loadAdminTest();
        showAdminToast(`✓ Видалено ${data.removed} питань. Тест очищено.`);
      } catch (err) {
        alert('Помилка: ' + err.message);
      } finally {
        clearAllQuestionsBtn.disabled = false;
      }
    });
  }

  const countChips = document.querySelectorAll('.ai-count-chip');
  if (countChips.length > 0 && aiCountInput) {
    countChips.forEach(chip => {
      chip.addEventListener('click', () => {
        countChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        aiCountInput.value = chip.dataset.val;
      });
    });
    aiCountInput.addEventListener('input', () => {
      const val = aiCountInput.value;
      countChips.forEach(c => {
        if (c.dataset.val === val) c.classList.add('active');
        else c.classList.remove('active');
      });
    });
  }

  if (closeAiStatusBannerBtn) {
    closeAiStatusBannerBtn.addEventListener('click', () => {
      if (aiStatusBanner) aiStatusBanner.classList.add('hidden');
    });
  }

  if (openAiGenerateBtn) {
    openAiGenerateBtn.addEventListener('click', () => {
      aiModalError.textContent = '';
      if (aiGeneratingIndicator) aiGeneratingIndicator.classList.add('hidden');
      if (aiSuccessIndicator) aiSuccessIndicator.classList.add('hidden');
      aiTopicInput.value = '';
      aiGenerateModal.classList.remove('hidden');
      setTimeout(() => aiTopicInput.focus(), 50);
    });
  }

  if (closeAiModalBtn) closeAiModalBtn.addEventListener('click', () => aiGenerateModal.classList.add('hidden'));
  if (cancelAiModalBtn) cancelAiModalBtn.addEventListener('click', () => aiGenerateModal.classList.add('hidden'));

  if (startAiGenerateBtn) {
    startAiGenerateBtn.addEventListener('click', async () => {
      aiModalError.textContent = '';
      if (aiSuccessIndicator) aiSuccessIndicator.classList.add('hidden');

      const topic = aiTopicInput.value.trim();
      if (!topic) {
        aiModalError.textContent = 'Будь ласка, вкажіть тему тесту!';
        aiTopicInput.focus();
        return;
      }

      const countVal = parseInt(aiCountInput ? aiCountInput.value : '5', 10);
      if (isNaN(countVal) || countVal < 1) {
        aiModalError.textContent = 'Вкажіть коректну кількість питань (мінімум 1)!';
        if (aiCountInput) aiCountInput.focus();
        return;
      }
      if (countVal > 50) {
        aiModalError.textContent = 'Максимальна кількість питань для однієї генерації — 50!';
        if (aiCountInput) aiCountInput.focus();
        return;
      }
      const count = countVal;

      const difficulty = aiDifficultySelect.value;
      const timeLimitSeconds = parseInt(aiTimeLimitInput.value, 10) || 60;
      const customInstructions = aiCustomPrompt.value.trim();
      const modeInput = document.querySelector('input[name="aiActionMode"]:checked');
      const replaceExisting = modeInput && modeInput.value === 'replace';

      try {
        startAiGenerateBtn.disabled = true;
        cancelAiModalBtn.disabled = true;
        if (aiGeneratingIndicator) aiGeneratingIndicator.classList.remove('hidden');

        const res = await adminFetch('/api/admin/generate-test', {
          method: 'POST',
          body: JSON.stringify({
            topic,
            count,
            difficulty,
            timeLimitSeconds,
            customInstructions,
            testId: selectedAdminTestId,
            applyToTest: true,
            replaceExisting
          })
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Помилка генерації через Gemini');
        }

        if (aiGeneratingIndicator) aiGeneratingIndicator.classList.add('hidden');
        if (aiSuccessIndicator) {
          aiSuccessIndicator.classList.remove('hidden');
          if (aiSuccessDetails) {
            aiSuccessDetails.textContent = `Успішно створено та додано ${data.questions.length} питань на тему "${topic}".`;
          }
        }

        await loadAdminTest();

        const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        if (aiStatusBanner) {
          aiStatusBanner.classList.remove('hidden');
          if (aiStatusBannerText) {
            aiStatusBannerText.innerHTML = `<strong>ШІ завершив генерацію:</strong> успішно додано <strong>${data.questions.length}</strong> питань на тему "<em>${escapeHtml(topic)}</em>" (о ${timeNow}).`;
          }
        }

        showAdminToast(`✓ ШІ завершив генерацію: створено ${data.questions.length} питань!`);

        setTimeout(() => {
          if (aiGenerateModal) aiGenerateModal.classList.add('hidden');
          if (aiSuccessIndicator) aiSuccessIndicator.classList.add('hidden');
        }, 1400);

      } catch (err) {
        aiModalError.textContent = err.message;
        if (aiGeneratingIndicator) aiGeneratingIndicator.classList.add('hidden');
      } finally {
        startAiGenerateBtn.disabled = false;
        cancelAiModalBtn.disabled = false;
      }
    });
  }

  if (closeQModalBtn) closeQModalBtn.addEventListener('click', closeQuestionModal);
  if (cancelQModalBtn) cancelQModalBtn.addEventListener('click', closeQuestionModal);

  const qTypeSelect = document.getElementById('qTypeSelect');
  if (qTypeSelect) {
    qTypeSelect.addEventListener('change', () => {
      const selectedType = qTypeSelect.value;
      updateQuestionFormVisibility(selectedType);
      if (selectedType === 'single') {
        const inputs = Array.from(optionsFormContainer.querySelectorAll('.opt-val-input')).map(i => i.value);
        renderOptionInputs(inputs.length > 0 ? inputs : ['', '', '', ''], 0, false);
      } else if (selectedType === 'multiple') {
        const inputs = Array.from(optionsFormContainer.querySelectorAll('.opt-val-input')).map(i => i.value);
        renderOptionInputs(inputs.length > 0 ? inputs : ['', '', '', ''], [0], true);
      } else if (selectedType === 'matching') {
        renderMatchingInputs([{ left: '', right: '' }, { left: '', right: '' }]);
      } else if (selectedType === 'ordering') {
        renderOrderingInputs(['', '', '']);
      }
    });
  }

  if (addOptionFieldBtn) {
    addOptionFieldBtn.addEventListener('click', () => {
      const isMulti = qTypeSelect && qTypeSelect.value === 'multiple';
      const inputs = Array.from(optionsFormContainer.querySelectorAll('.opt-val-input')).map(i => i.value);
      inputs.push('');
      if (isMulti) {
        const checked = Array.from(optionsFormContainer.querySelectorAll('input[name="optCorrectCheck"]:checked')).map(c => parseInt(c.value, 10));
        renderOptionInputs(inputs, checked, true);
      } else {
        const currentChecked = optionsFormContainer.querySelector('input[name="optCorrectRadio"]:checked');
        const checkedIdx = currentChecked ? parseInt(currentChecked.value, 10) : 0;
        renderOptionInputs(inputs, checkedIdx, false);
      }
    });
  }

  const addMatchingPairBtn = document.getElementById('addMatchingPairBtn');
  if (addMatchingPairBtn) {
    addMatchingPairBtn.addEventListener('click', () => {
      const container = document.getElementById('matchingPairsContainer');
      if (!container) return;
      const leftInputs = Array.from(container.querySelectorAll('.matching-left-input')).map(i => i.value);
      const rightInputs = Array.from(container.querySelectorAll('.matching-right-input')).map(i => i.value);
      const pairs = leftInputs.map((left, idx) => ({ left, right: rightInputs[idx] || '' }));
      pairs.push({ left: '', right: '' });
      renderMatchingInputs(pairs);
    });
  }

  const addOrderingItemBtn = document.getElementById('addOrderingItemBtn');
  if (addOrderingItemBtn) {
    addOrderingItemBtn.addEventListener('click', () => {
      const container = document.getElementById('orderingItemsContainer');
      if (!container) return;
      const items = Array.from(container.querySelectorAll('.ordering-val-input')).map(i => i.value);
      items.push('');
      renderOrderingInputs(items);
    });
  }

  if (saveQuestionBtn) {
    saveQuestionBtn.addEventListener('click', async () => {
      qModalError.textContent = '';
      const text = qTextInput.value.trim();
      const timeLimitSeconds = parseInt(qTimeLimitInput.value, 10) || 60;
      const qType = (qTypeSelect && qTypeSelect.value) || 'single';

      if (!text) {
        qModalError.textContent = 'Введіть текст питання!';
        return;
      }

      let payload = {
        text,
        type: qType,
        timeLimitSeconds
      };

      if (qType === 'matching') {
        const container = document.getElementById('matchingPairsContainer');
        const leftInputs = Array.from(container ? container.querySelectorAll('.matching-left-input') : []);
        const rightInputs = Array.from(container ? container.querySelectorAll('.matching-right-input') : []);

        const pairs = leftInputs.map((li, idx) => ({
          left: li.value.trim(),
          right: rightInputs[idx] ? rightInputs[idx].value.trim() : ''
        })).filter(p => p.left && p.right);

        if (pairs.length < 2) {
          qModalError.textContent = 'Введіть щонайменше 2 заповнені пари для відповідності!';
          return;
        }
        payload.matchingPairs = pairs;
      } else if (qType === 'ordering') {
        const container = document.getElementById('orderingItemsContainer');
        const items = Array.from(container ? container.querySelectorAll('.ordering-val-input') : [])
          .map(i => i.value.trim())
          .filter(Boolean);

        if (items.length < 2) {
          qModalError.textContent = 'Введіть щонайменше 2 етапи / події у правильній послідовності!';
          return;
        }
        payload.orderingItems = items;
        payload.correct = items;
      } else if (qType === 'multiple') {
        const optionInputs = Array.from(optionsFormContainer.querySelectorAll('.opt-val-input'));
        const options = optionInputs.map(i => i.value.trim()).filter(Boolean);

        if (options.length < 2) {
          qModalError.textContent = 'Заповніть щонайменше 2 варіанти відповіді!';
          return;
        }

        const checkedBoxes = Array.from(optionsFormContainer.querySelectorAll('input[name="optCorrectCheck"]:checked'));
        if (checkedBoxes.length === 0) {
          qModalError.textContent = 'Позначте хоча б один правильний варіант!';
          return;
        }
        const correctIndices = checkedBoxes.map(c => parseInt(c.value, 10)).filter(n => !isNaN(n));
        payload.options = options;
        payload.correct = correctIndices;
      } else {
        const optionInputs = Array.from(optionsFormContainer.querySelectorAll('.opt-val-input'));
        const options = optionInputs.map(i => i.value.trim()).filter(Boolean);

        if (options.length < 2) {
          qModalError.textContent = 'Заповніть щонайменше 2 варіанти відповіді!';
          return;
        }

        const checkedRadio = optionsFormContainer.querySelector('input[name="optCorrectRadio"]:checked');
        if (!checkedRadio) {
          qModalError.textContent = 'Оберіть правильний варіант відповіді!';
          return;
        }
        payload.options = options;
        payload.correct = parseInt(checkedRadio.value, 10);
      }

      try {
        saveQuestionBtn.disabled = true;
        saveQuestionBtn.textContent = 'Збереження...';

        let res;
        if (editingQuestionId) {
          res = await adminFetch(`/api/admin/tests/${encodeURIComponent(selectedAdminTestId)}/questions/${editingQuestionId}`, {
            method: 'PUT',
            body: JSON.stringify(payload)
          });
        } else {
          res = await adminFetch(`/api/admin/tests/${encodeURIComponent(selectedAdminTestId)}/questions`, {
            method: 'POST',
            body: JSON.stringify(payload)
          });
        }

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Помилка збереження питання');
        }

        closeQuestionModal();
        await loadAdminTest();
      } catch (err) {
        qModalError.textContent = err.message;
      } finally {
        saveQuestionBtn.disabled = false;
        saveQuestionBtn.innerHTML = '<img src="/img/icons/save.svg" class="pixel-icon inline" alt=""> Зберегти питання';
      }
    });
  }
}

function initSessionsExport() {
  const exportCsvBtn = document.getElementById('exportSessionsCsvBtn');
  const exportPdfBtn = document.getElementById('exportSessionsPdfBtn');

  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', () => {
      if (!sessions || sessions.length === 0) {
        showAdminToast('Немає результатів для експорту', false);
        return;
      }

      const classFilterEl = document.getElementById('sessionClassFilter');
      const classVal = classFilterEl ? classFilterEl.value : '';
      let list = sessions.slice();
      if (classVal) {
        list = list.filter(s => s.studentId === classVal);
      }

      const activeTest = allAdminTests.find(t => t.id === selectedAdminTestId);
      const testTitle = (activeTest && activeTest.title) ? activeTest.title : 'Тест';

      const headers = [
        '№',
        'ПІБ учня',
        'Клас',
        'Тест',
        'Оцінка (1-12)',
        'Відсоток (%)',
        'Правильних',
        'Всього питань',
        'Час початку',
        'Час завершення',
        'Доброчесність (%)',
        'Порушень',
        'Статус / Вердикт'
      ];

      const rows = list.map((s, idx) => {
        const score12 = s.score12 !== undefined ? s.score12 : (s.totalQuestions > 0 ? Math.min(12, Math.max(1, Math.round((s.rawScore / s.totalQuestions) * 12))) : 1);
        const percent = s.scorePercentage !== undefined ? `${s.scorePercentage}%` : '--';
        const start = s.startedAt ? new Date(s.startedAt).toLocaleString('uk-UA') : '--';
        const finish = s.submittedAt ? new Date(s.submittedAt).toLocaleString('uk-UA') : (s.status === 'in_progress' ? 'У процесі' : '--');
        const verdict = s.finalVerdict ? (s.finalVerdict.decision || s.status) : s.status;

        return [
          idx + 1,
          `"${(s.studentName || '').replace(/"/g, '""')}"`,
          `"${(s.studentId || '').replace(/"/g, '""')}"`,
          `"${testTitle.replace(/"/g, '""')}"`,
          score12,
          `"${percent}"`,
          s.rawScore || 0,
          s.totalQuestions || 0,
          `"${start}"`,
          `"${finish}"`,
          `${s.trustScore}%`,
          s.incidentsCount || 0,
          `"${verdict}"`
        ].join(';');
      });

      const csvContent = '\uFEFF' + headers.join(';') + '\n' + rows.join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const dateStr = new Date().toISOString().slice(0, 10);
      link.href = url;
      link.download = `vidomist_${dateStr}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showAdminToast('✓ Відомість експортовано в Excel / CSV!');
    });
  }

  if (exportPdfBtn) {
    exportPdfBtn.addEventListener('click', () => {
      if (!sessions || sessions.length === 0) {
        showAdminToast('Немає результатів для друку', false);
        return;
      }

      const classFilterEl = document.getElementById('sessionClassFilter');
      const classVal = classFilterEl ? classFilterEl.value : '';
      let list = sessions.slice();
      if (classVal) {
        list = list.filter(s => s.studentId === classVal);
      }

      const activeTest = allAdminTests.find(t => t.id === selectedAdminTestId);
      const testTitle = (activeTest && activeTest.title) ? activeTest.title : 'Тестування';
      const dateStr = new Date().toLocaleDateString('uk-UA');

      const container = document.getElementById('printableGradebookContainer');
      if (!container) return;

      let tableRows = '';
      list.forEach((s, idx) => {
        const score12 = s.score12 !== undefined ? s.score12 : (s.totalQuestions > 0 ? Math.min(12, Math.max(1, Math.round((s.rawScore / s.totalQuestions) * 12))) : 1);
        const percent = s.scorePercentage !== undefined ? `${s.scorePercentage}%` : '--';
        tableRows += `
          <tr>
            <td style="text-align:center;">${idx + 1}</td>
            <td><strong>${escapeHtml(s.studentName || '—')}</strong></td>
            <td style="text-align:center;">${escapeHtml(s.studentId || '—')}</td>
            <td style="text-align:center; font-weight: bold; font-size: 13pt;">${score12}</td>
            <td style="text-align:center;">${percent}</td>
            <td style="text-align:center;">${s.rawScore || 0} / ${s.totalQuestions || 0}</td>
            <td style="text-align:center;">${s.trustScore}%</td>
            <td style="text-align:center;">${s.incidentsCount || 0}</td>
          </tr>
        `;
      });

      container.innerHTML = `
        <div style="margin-bottom: 20px;">
          <h2 style="margin: 0 0 6px 0; text-align: center; text-transform: uppercase; font-size: 16pt;">Відомість оцінювання знань учнів</h2>
          <div style="text-align: center; font-size: 11pt; color: #444; margin-bottom: 14px;">Система контролю знань та академічної доброчесності SecureExam</div>
          <table style="width: 100%; font-size: 11pt; margin-bottom: 12px;">
            <tr>
              <td><strong>Тест:</strong> ${escapeHtml(testTitle)}</td>
              <td style="text-align: right;"><strong>Дата:</strong> ${dateStr}</td>
            </tr>
            <tr>
              <td><strong>Клас:</strong> ${classVal ? escapeHtml(classVal) : 'Усі класи'}</td>
              <td style="text-align: right;"><strong>Всього учнів:</strong> ${list.length}</td>
            </tr>
          </table>
          <table class="print-table">
            <thead>
              <tr>
                <th style="width: 35px; text-align: center;">№</th>
                <th>Прізвище та ім'я учня</th>
                <th style="width: 70px; text-align: center;">Клас</th>
                <th style="width: 90px; text-align: center;">Оцінка (12)</th>
                <th style="width: 80px; text-align: center;">Відсоток</th>
                <th style="width: 80px; text-align: center;">Бали</th>
                <th style="width: 80px; text-align: center;">Довіра</th>
                <th style="width: 80px; text-align: center;">Порушень</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows}
            </tbody>
          </table>
          <div style="margin-top: 40px; display: flex; justify-content: space-between; font-size: 11pt;">
            <div>Підпис викладача: _______________________</div>
            <div>Оцінки внесено до класного журналу: [ &nbsp; ]</div>
          </div>
        </div>
      `;

      window.print();
    });
  }
}

function initImportQuestionsControls() {
  const openImportModalBtn = document.getElementById('openImportModalBtn');
  const closeImportModalBtn = document.getElementById('closeImportModalBtn');
  const cancelImportModalBtn = document.getElementById('cancelImportModalBtn');
  const importModal = document.getElementById('importQuestionsModal');
  const importRawTextInput = document.getElementById('importRawTextInput');
  const importFileInput = document.getElementById('importFileInput');
  const parseImportWithAiBtn = document.getElementById('parseImportWithAiBtn');
  const importParsingStatus = document.getElementById('importParsingStatus');
  const importPreviewContainer = document.getElementById('importPreviewContainer');
  const importPreviewCount = document.getElementById('importPreviewCount');
  const importParsedList = document.getElementById('importParsedList');
  const selectAllImportCheckbox = document.getElementById('selectAllImportCheckbox');
  const submitImportQuestionsBtn = document.getElementById('submitImportQuestionsBtn');

  let parsedQuestions = [];

  if (openImportModalBtn && importModal) {
    openImportModalBtn.addEventListener('click', () => {
      importModal.classList.remove('hidden');
      if (importParsingStatus) importParsingStatus.textContent = '';
      if (importPreviewContainer) importPreviewContainer.classList.add('hidden');
      if (submitImportQuestionsBtn) submitImportQuestionsBtn.classList.add('hidden');
    });
  }

  const closeModal = () => {
    if (importModal) importModal.classList.add('hidden');
    parsedQuestions = [];
  };

  if (closeImportModalBtn) closeImportModalBtn.addEventListener('click', closeModal);
  if (cancelImportModalBtn) cancelImportModalBtn.addEventListener('click', closeModal);

  if (importFileInput && importRawTextInput) {
    importFileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        importRawTextInput.value = evt.target.result;
        showAdminToast(`✓ Файл "${file.name}" завантажено у вікно`);
      };
      reader.readAsText(file);
    });
  }

  if (parseImportWithAiBtn && importRawTextInput) {
    parseImportWithAiBtn.addEventListener('click', async () => {
      const text = importRawTextInput.value.trim();
      if (!text) {
        alert('Вставте текст тесту або завантажте файл');
        return;
      }
      try {
        parseImportWithAiBtn.disabled = true;
        if (importParsingStatus) importParsingStatus.textContent = 'ШІ аналізує текст та витягує питання...';

        const res = await adminFetch('/api/admin/ai-parse-import', {
          method: 'POST',
          body: JSON.stringify({ rawText: text })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Помилка розпізнавання');

        parsedQuestions = data.questions || [];
        if (parsedQuestions.length === 0) {
          throw new Error('Не знайдено жодного питання в тексті');
        }

        if (importParsingStatus) {
          importParsingStatus.textContent = `✓ Успішно розпізнано ${parsedQuestions.length} питань (${data.source === 'gemini' ? 'Gemini AI' : 'Локальний парсер'})`;
        }

        renderImportPreview(parsedQuestions);
        if (importPreviewContainer) importPreviewContainer.classList.remove('hidden');
        if (submitImportQuestionsBtn) submitImportQuestionsBtn.classList.remove('hidden');
      } catch (err) {
        if (importParsingStatus) importParsingStatus.textContent = 'Помилка: ' + err.message;
        alert('Помилка імпорту: ' + err.message);
      } finally {
        parseImportWithAiBtn.disabled = false;
      }
    });
  }

  function renderImportPreview(questions) {
    if (!importParsedList) return;
    importParsedList.innerHTML = '';
    if (importPreviewCount) importPreviewCount.textContent = questions.length;

    questions.forEach((q, idx) => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'flex-start';
      row.style.gap = '8px';
      row.style.padding = '8px';
      row.style.background = 'var(--bg-elevated)';
      row.style.borderRadius = '4px';
      row.style.fontSize = '12px';

      const typeLabel = q.type === 'multiple' ? '☑️ Чекбокси' : (q.type === 'matching' ? '🔗 Відповідність' : (q.type === 'ordering' ? '🔢 Послідовність' : '🔘 1 варіант'));

      let samplePreview = '';
      if (q.type === 'matching' && Array.isArray(q.matchingPairs)) {
        samplePreview = q.matchingPairs.slice(0, 3).map(p => `${escapeHtml(p.left)} ↔ ${escapeHtml(p.right)}`).join(' • ');
      } else if (q.type === 'ordering' && Array.isArray(q.orderingItems)) {
        samplePreview = q.orderingItems.slice(0, 3).map(i => escapeHtml(i)).join(' → ');
      } else {
        samplePreview = (q.options || []).slice(0, 4).map(o => escapeHtml(o)).join(' • ');
      }

      row.innerHTML = `
        <input type="checkbox" class="import-q-cb" data-idx="${idx}" checked style="margin-top: 2px;">
        <div style="flex:1;">
          <div style="font-weight: 600; margin-bottom: 2px;">${idx + 1}. ${escapeHtml(q.text)} <span class="tag-badge" style="font-size:9px; margin-left:4px;">${typeLabel}</span></div>
          <div style="font-size: 11px; color: var(--text-muted);">${samplePreview}</div>
        </div>
      `;
      importParsedList.appendChild(row);
    });
  }

  if (selectAllImportCheckbox) {
    selectAllImportCheckbox.addEventListener('change', (e) => {
      const checkboxes = document.querySelectorAll('.import-q-cb');
      checkboxes.forEach(cb => cb.checked = e.target.checked);
    });
  }

  if (submitImportQuestionsBtn) {
    submitImportQuestionsBtn.addEventListener('click', async () => {
      const checkboxes = document.querySelectorAll('.import-q-cb:checked');
      const selectedIndices = Array.from(checkboxes).map(cb => parseInt(cb.dataset.idx, 10));
      const questionsToAdd = selectedIndices.map(idx => parsedQuestions[idx]).filter(Boolean);

      if (questionsToAdd.length === 0) {
        alert('Оберіть хоча б одне питання для додавання');
        return;
      }

      try {
        submitImportQuestionsBtn.disabled = true;
        submitImportQuestionsBtn.textContent = 'Додавання...';

        const res = await adminFetch(`/api/admin/tests/${encodeURIComponent(selectedAdminTestId)}/questions/bulk`, {
          method: 'POST',
          body: JSON.stringify({ questions: questionsToAdd })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Помилка додавання питань');

        showAdminToast(`✓ Успішно додано ${data.count} питань до тесту!`);
        closeModal();
        await loadAdminTest();
      } catch (err) {
        alert('Помилка: ' + err.message);
      } finally {
        submitImportQuestionsBtn.disabled = false;
        submitImportQuestionsBtn.innerHTML = '<img src="/img/icons/plus.svg" class="pixel-icon inline" alt=""> Додати обрані питання до тесту';
      }
    });
  }
}

async function deleteQuestion(questionId) {
  if (!confirm('Ви впевнені, що хочете видалити це питання з тесту?')) return;
  try {
    const res = await adminFetch(`/api/admin/tests/${encodeURIComponent(selectedAdminTestId)}/questions/${questionId}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error('Помилка видалення');
    await loadAdminTest();
  } catch (err) {
    alert('Помилка: ' + err.message);
  }
}

let allClasses = [];
let currentManagingClassId = null;
let editingClassId = null;

async function loadAdminClasses() {
  try {
    const res = await adminFetch('/api/admin/classes');
    if (!res.ok) return;
    allClasses = await res.json();
    populateAdminClassTestFilter();
    populateClassSubjectFilter();
    renderClassesList();
  } catch (err) {
    console.error(err);
  }
}

function populateClassSubjectFilter() {
  const filter = document.getElementById('classSubjectFilter');
  if (!filter) return;
  const currentVal = filter.value;
  const subjects = [...new Set([
    ...allClasses.map(c => (c.subject || '').trim()).filter(Boolean),
    ...allAdminTests.map(t => (t.subject || '').trim()).filter(Boolean)
  ])].sort((a, b) => a.localeCompare(b, 'uk'));
  filter.innerHTML = '<option value="">Усі предмети</option>';
  subjects.forEach(sb => {
    const opt = document.createElement('option');
    opt.value = sb;
    opt.textContent = sb;
    if (sb === currentVal) opt.selected = true;
    filter.appendChild(opt);
  });
}

function populateAdminClassTestFilter() {
  const sel = document.getElementById('adminClassTestFilter');
  if (!sel) return;
  const currentVal = sel.value;
  sel.innerHTML = '<option value="">Усі класи</option>';
  allClasses.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    if (c.id === currentVal) opt.selected = true;
    sel.appendChild(opt);
  });
}


function renderClassesList() {
  const container = document.getElementById('classesListContainer');
  const countBadge = document.getElementById('classesCountBadge');
  const searchInput = document.getElementById('classSearchInput');
  const subjectFilter = document.getElementById('classSubjectFilter');

  if (!container) return;

  const q = searchInput ? searchInput.value.trim().toLowerCase() : '';
  const subj = subjectFilter ? subjectFilter.value.trim().toLowerCase() : '';

  const sortSelect = document.getElementById('classSortSelect');
  const sortMode = sortSelect ? sortSelect.value : 'name_asc';

  let list = allClasses.slice();
  if (subj) {
    list = list.filter(c => (c.subject || '').toLowerCase() === subj);
  }
  if (q) {
    list = list.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.subject || '').toLowerCase().includes(q) ||
      (c.description || '').toLowerCase().includes(q) ||
      (c.grade || '').toString().includes(q)
    );
  }

  if (sortMode === 'name_desc') {
    list.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
  } else if (sortMode === 'students_desc') {
    list.sort((a, b) => (b.students || []).length - (a.students || []).length);
  } else if (sortMode === 'tests_desc') {
    list.sort((a, b) => (b.assignedTests || []).length - (a.assignedTests || []).length);
  } else {
    list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  if (countBadge) {
    countBadge.textContent = `Класів: ${list.length}`;
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-muted); background: var(--bg-surface); border: 1px dashed var(--border); border-radius: var(--radius);">
        Класи не знайдено. Натисніть «+ Створити клас», щоб додати новий клас.
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  list.forEach(c => {
    const card = document.createElement('div');
    card.className = 'card-panel';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.justifyContent = 'space-between';
    card.style.gap = '14px';

    const studentsCount = (c.students || []).length;
    const testsCount = (c.assignedTests || []).length;

    card.innerHTML = `
      <div>
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
          <div>
            <div style="font-size: 18px; font-weight: 700; color: var(--text);">${escapeHtml(c.name)}</div>
            <div style="display: flex; gap: 6px; margin-top: 4px; flex-wrap: wrap;">
              <span class="tag-badge approved">${escapeHtml(c.subject || 'Географія')}</span>
              <span class="tag-badge" style="background: var(--bg-elevated); border: 1px solid var(--border);">${escapeHtml(c.grade ? `${c.grade} клас` : '10 клас')}</span>
            </div>
          </div>
          <div style="display: flex; gap: 4px;">
            <button class="btn-secondary btn-edit-class" data-id="${c.id}" style="padding: 5px 8px; font-size: 11px;" type="button" title="Редагувати клас">
              <img src="/img/icons/edit.svg" class="pixel-icon inline" alt="">
            </button>
            <button class="btn-secondary btn-delete-class" data-id="${c.id}" style="padding: 5px 8px; font-size: 11px; border-color: var(--accent-red); color: var(--accent-red);" type="button" title="Видалити клас">
              <img src="/img/icons/trash.svg" class="pixel-icon inline" alt="">
            </button>
          </div>
        </div>
        ${c.description ? `<p style="font-size: 12px; color: var(--text-muted); line-height: 1.4; margin-bottom: 12px;">${escapeHtml(c.description)}</p>` : ''}
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; background: var(--bg-elevated); padding: 10px; border-radius: var(--radius-sm); border: 1px solid var(--border);">
          <div style="text-align: center;">
            <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase;">Учнів</div>
            <div style="font-size: 18px; font-weight: 800; color: var(--text);">${studentsCount}</div>
          </div>
          <div style="text-align: center;">
            <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase;">Тестів</div>
            <div style="font-size: 18px; font-weight: 800; color: var(--accent);">${testsCount}</div>
          </div>
        </div>
      </div>
      <div>
        <button class="btn-primary btn-manage-class" data-id="${c.id}" style="width: 100%; font-size: 12px; padding: 8px 12px;" type="button">
          👥 Учні та тести класу →
        </button>
      </div>
    `;

    card.querySelector('.btn-manage-class').addEventListener('click', () => openClassDetail(c.id));
    card.querySelector('.btn-edit-class').addEventListener('click', () => openEditClass(c.id));
    card.querySelector('.btn-delete-class').addEventListener('click', () => deleteClass(c.id));

    container.appendChild(card);
  });
}

function openCreateClassModal() {
  editingClassId = null;
  const modal = document.getElementById('classModal');
  const title = document.getElementById('classModalTitle');
  const nameInput = document.getElementById('classFormName');
  const gradeInput = document.getElementById('classFormGrade');
  const subjectInput = document.getElementById('classFormSubject');
  const descInput = document.getElementById('classFormDescription');
  const err = document.getElementById('classModalErrorMsg');

  if (title) title.textContent = 'Створити клас';
  if (nameInput) nameInput.value = '';
  if (gradeInput) gradeInput.value = '10';
  if (subjectInput) subjectInput.value = 'Географія';
  if (descInput) descInput.value = '';
  if (err) err.textContent = '';
  if (modal) modal.classList.remove('hidden');
  if (nameInput) setTimeout(() => nameInput.focus(), 50);
}

function openEditClass(classId) {
  const cls = allClasses.find(c => c.id === classId);
  if (!cls) return;
  editingClassId = classId;
  const modal = document.getElementById('classModal');
  const title = document.getElementById('classModalTitle');
  const nameInput = document.getElementById('classFormName');
  const gradeInput = document.getElementById('classFormGrade');
  const subjectInput = document.getElementById('classFormSubject');
  const descInput = document.getElementById('classFormDescription');
  const err = document.getElementById('classModalErrorMsg');

  if (title) title.textContent = 'Редагувати клас';
  if (nameInput) nameInput.value = cls.name || '';
  if (gradeInput) gradeInput.value = cls.grade || '10';
  if (subjectInput) subjectInput.value = cls.subject || 'Географія';
  if (descInput) descInput.value = cls.description || '';
  if (err) err.textContent = '';
  if (modal) modal.classList.remove('hidden');
  if (nameInput) setTimeout(() => nameInput.focus(), 50);
}

async function saveClassForm() {
  const nameInput = document.getElementById('classFormName');
  const gradeInput = document.getElementById('classFormGrade');
  const subjectInput = document.getElementById('classFormSubject');
  const descInput = document.getElementById('classFormDescription');
  const err = document.getElementById('classModalErrorMsg');
  const submitBtn = document.getElementById('submitClassModalBtn');
  const modal = document.getElementById('classModal');

  const name = nameInput ? nameInput.value.trim() : '';
  const grade = gradeInput ? gradeInput.value.trim() : '10';
  const subject = subjectInput ? subjectInput.value.trim() : 'Географія';
  const description = descInput ? descInput.value.trim() : '';

  if (!name) {
    if (err) err.textContent = 'Вкажіть назву класу (наприклад: 10-А)';
    return;
  }

  try {
    if (submitBtn) submitBtn.disabled = true;
    let res;
    if (editingClassId) {
      res = await adminFetch(`/api/admin/classes/${editingClassId}`, {
        method: 'PUT',
        body: JSON.stringify({ name, grade, subject, description })
      });
    } else {
      res = await adminFetch('/api/admin/classes', {
        method: 'POST',
        body: JSON.stringify({ name, grade, subject, description })
      });
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Помилка збереження класу');
    }

    if (modal) modal.classList.add('hidden');
    showAdminToast(editingClassId ? 'Клас оновлено' : 'Клас успішно створено');
    await loadAdminClasses();
  } catch (e) {
    if (err) err.textContent = e.message;
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function deleteClass(classId) {
  const cls = allClasses.find(c => c.id === classId);
  const name = cls ? cls.name : classId;
  if (!confirm(`Ви дійсно бажаєте видалити клас "${name}"?\nЦю дію неможливо скасувати!`)) return;

  try {
    const res = await adminFetch(`/api/admin/classes/${classId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Помилка видалення');
    showAdminToast('Клас видалено');
    await loadAdminClasses();
  } catch (e) {
    alert('Помилка: ' + e.message);
  }
}

function openClassDetail(classId) {
  currentManagingClassId = classId;
  const cls = allClasses.find(c => c.id === classId);
  if (!cls) return;

  const modal = document.getElementById('classDetailModal');
  const nameTitle = document.getElementById('classDetailNameTitle');
  const subjBadge = document.getElementById('classDetailSubjectBadge');
  const descSub = document.getElementById('classDetailDescSubtitle');

  if (nameTitle) nameTitle.textContent = `Клас ${cls.name}`;
  if (subjBadge) subjBadge.textContent = cls.subject || 'Географія';
  if (descSub) descSub.textContent = cls.description || `${cls.grade || 10} клас • Підручник В.М. Бойко, Ю.С. Брайчевський`;

  renderClassStudents(cls);
  renderClassAssignedTests(cls);
  populateClassAssignTestSelector(cls);

  if (modal) modal.classList.remove('hidden');
}

function renderClassStudents(cls) {
  const list = document.getElementById('classStudentsList');
  const countSpan = document.getElementById('classDetailStudentsCount');
  if (!list) return;

  const students = cls.students || [];
  if (countSpan) countSpan.textContent = students.length;

  if (students.length === 0) {
    list.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 12px;">Учнів ще не додано</div>';
    return;
  }

  list.innerHTML = '';
  students.forEach((st, idx) => {
    const item = document.createElement('div');
    item.style.display = 'flex';
    item.style.justifyContent = 'space-between';
    item.style.alignItems = 'center';
    item.style.padding = '8px 10px';
    item.style.background = 'var(--bg-elevated)';
    item.style.border = '1px solid var(--border)';
    item.style.borderRadius = 'var(--radius-sm)';

    item.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 11px; font-weight: 700; color: var(--text-muted); width: 20px;">${idx + 1}.</span>
        <span style="font-size: 13px; font-weight: 600; color: var(--text);">${escapeHtml(st.name)}</span>
      </div>
      <button class="btn-secondary" style="padding: 4px 8px; font-size: 11px; border-color: var(--accent-red); color: var(--accent-red);" type="button" title="Видалити учня">
        <img src="/img/icons/trash.svg" class="pixel-icon inline" alt="">
      </button>
    `;

    item.querySelector('button').addEventListener('click', async () => {
      try {
        const res = await adminFetch(`/api/admin/classes/${cls.id}/students/${st.id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Помилка видалення учня');
        const updated = await res.json();
        const foundIdx = allClasses.findIndex(c => c.id === cls.id);
        if (foundIdx !== -1) allClasses[foundIdx] = updated;
        renderClassStudents(updated);
        renderClassesList();
      } catch (e) {
        alert(e.message);
      }
    });

    list.appendChild(item);
  });
}

function renderClassAssignedTests(cls) {
  const list = document.getElementById('classAssignedTestsList');
  const countSpan = document.getElementById('classDetailTestsCount');
  if (!list) return;

  const assignedIds = cls.assignedTests || [];
  if (countSpan) countSpan.textContent = assignedIds.length;

  if (assignedIds.length === 0) {
    list.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 12px;">Тести ще не призначено</div>';
    return;
  }

  list.innerHTML = '';
  assignedIds.forEach(testId => {
    const testObj = allAdminTests.find(t => t.id === testId);
    const item = document.createElement('div');
    item.style.display = 'flex';
    item.style.justifyContent = 'space-between';
    item.style.alignItems = 'center';
    item.style.padding = '8px 10px';
    item.style.background = 'var(--bg-elevated)';
    item.style.border = '1px solid var(--border)';
    item.style.borderRadius = 'var(--radius-sm)';

    const title = testObj ? testObj.title : testId;
    const topic = testObj && testObj.topic ? testObj.topic : '';

    item.innerHTML = `
      <div style="flex: 1; min-width: 0; padding-right: 8px;">
        <div style="font-size: 12px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(title)}</div>
        ${topic ? `<div style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">Тема: ${escapeHtml(topic)}</div>` : ''}
      </div>
      <button class="btn-secondary" style="padding: 4px 8px; font-size: 11px; border-color: var(--accent-red); color: var(--accent-red);" type="button" title="Вилучити тест">
        <img src="/img/icons/cross.svg" class="pixel-icon inline" alt="">
      </button>
    `;

    item.querySelector('button').addEventListener('click', async () => {
      try {
        const res = await adminFetch(`/api/admin/classes/${cls.id}/tests/${testId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Помилка вилучення тесту');
        const updated = await res.json();
        const foundIdx = allClasses.findIndex(c => c.id === cls.id);
        if (foundIdx !== -1) allClasses[foundIdx] = updated;
        renderClassAssignedTests(updated);
        populateClassAssignTestSelector(updated);
        renderClassesList();
      } catch (e) {
        alert(e.message);
      }
    });

    list.appendChild(item);
  });
}

function populateClassAssignTestSelector(cls) {
  const sel = document.getElementById('classAssignTestSelector');
  if (!sel) return;
  sel.innerHTML = '<option value="">Оберіть тест для призначення...</option>';

  const assigned = new Set(cls.assignedTests || []);
  const available = allAdminTests.filter(t => !assigned.has(t.id));
  available.sort((a, b) => (a.subject || '').localeCompare(b.subject || '', 'uk') || (a.topic || '').localeCompare(b.topic || '', 'uk') || (a.title || '').localeCompare(b.title || '', 'uk'));

  available.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    const subjLabel = t.subject ? `[${t.subject}] ` : '';
    const topicLabel = t.topic ? `[${t.topic}] ` : '';
    opt.textContent = `${subjLabel}${topicLabel}${t.title}`;
    sel.appendChild(opt);
  });
}

function initClassesControls() {
  const openCreateBtn = document.getElementById('openCreateClassModalBtn');
  const closeBtn = document.getElementById('closeClassModalBtn');
  const cancelBtn = document.getElementById('cancelClassModalBtn');
  const submitBtn = document.getElementById('submitClassModalBtn');
  const classModal = document.getElementById('classModal');

  const closeDetailBtn = document.getElementById('closeClassDetailModalBtn');
  const doneDetailBtn = document.getElementById('doneClassDetailModalBtn');
  const classDetailModal = document.getElementById('classDetailModal');

  const refreshBtn = document.getElementById('refreshClassesBtn');
  const searchInput = document.getElementById('classSearchInput');
  const subjectFilter = document.getElementById('classSubjectFilter');

  const addStudentBtn = document.getElementById('classAddStudentBtn');
  const newStudentNameInput = document.getElementById('classNewStudentNameInput');

  const assignTestBtn = document.getElementById('classAssignTestBtn');
  const assignTestSelector = document.getElementById('classAssignTestSelector');

  if (openCreateBtn) openCreateBtn.addEventListener('click', openCreateClassModal);
  if (closeBtn) closeBtn.addEventListener('click', () => { if (classModal) classModal.classList.add('hidden'); });
  if (cancelBtn) cancelBtn.addEventListener('click', () => { if (classModal) classModal.classList.add('hidden'); });
  if (submitBtn) submitBtn.addEventListener('click', saveClassForm);

  if (closeDetailBtn) closeDetailBtn.addEventListener('click', () => { if (classDetailModal) classDetailModal.classList.add('hidden'); });
  if (doneDetailBtn) doneDetailBtn.addEventListener('click', () => { if (classDetailModal) classDetailModal.classList.add('hidden'); });

  if (refreshBtn) refreshBtn.addEventListener('click', loadAdminClasses);
  if (searchInput) searchInput.addEventListener('input', renderClassesList);
  if (subjectFilter) subjectFilter.addEventListener('change', renderClassesList);

  const classSortSel = document.getElementById('classSortSelect');
  if (classSortSel) classSortSel.addEventListener('change', renderClassesList);

  const sessClassFilter = document.getElementById('sessionClassFilter');
  if (sessClassFilter) sessClassFilter.addEventListener('change', renderSessionsTable);

  const sessSortSel = document.getElementById('sessionSortSelect');
  if (sessSortSel) sessSortSel.addEventListener('change', renderSessionsTable);

  const thSortName = document.getElementById('thSortName');
  const thSortClass = document.getElementById('thSortClass');
  const thSortScore = document.getElementById('thSortScore');

  if (thSortName) thSortName.addEventListener('click', () => {
    const s = document.getElementById('sessionSortSelect');
    if (s) { s.value = 'name_asc'; renderSessionsTable(); }
  });
  if (thSortClass) thSortClass.addEventListener('click', () => {
    const s = document.getElementById('sessionSortSelect');
    if (s) {
      s.value = s.value === 'class_asc' ? 'class_desc' : 'class_asc';
      renderSessionsTable();
    }
  });
  if (thSortScore) thSortScore.addEventListener('click', () => {
    const s = document.getElementById('sessionSortSelect');
    if (s) { s.value = 'score_desc'; renderSessionsTable(); }
  });

  const adminClassTestFilter = document.getElementById('adminClassTestFilter');
  if (adminClassTestFilter) adminClassTestFilter.addEventListener('change', renderAdminTestSelectorOptions);

  if (addStudentBtn && newStudentNameInput) {
    const addStudent = async () => {
      const name = newStudentNameInput.value.trim();
      if (!name) return;
      if (!currentManagingClassId) return;
      try {
        addStudentBtn.disabled = true;
        const res = await adminFetch(`/api/admin/classes/${currentManagingClassId}/students`, {
          method: 'POST',
          body: JSON.stringify({ name })
        });
        if (!res.ok) throw new Error('Помилка додавання учня');
        const updated = await res.json();
        const foundIdx = allClasses.findIndex(c => c.id === currentManagingClassId);
        if (foundIdx !== -1) allClasses[foundIdx] = updated;
        newStudentNameInput.value = '';
        renderClassStudents(updated);
        renderClassesList();
      } catch (e) {
        alert(e.message);
      } finally {
        addStudentBtn.disabled = false;
      }
    };
    addStudentBtn.addEventListener('click', addStudent);
    newStudentNameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') addStudent();
    });
  }

  if (assignTestBtn && assignTestSelector) {
    assignTestBtn.addEventListener('click', async () => {
      const testId = assignTestSelector.value;
      if (!testId) return;
      if (!currentManagingClassId) return;
      try {
        assignTestBtn.disabled = true;
        const res = await adminFetch(`/api/admin/classes/${currentManagingClassId}/tests`, {
          method: 'POST',
          body: JSON.stringify({ testId })
        });
        if (!res.ok) throw new Error('Помилка призначення тесту');
        const updated = await res.json();
        const foundIdx = allClasses.findIndex(c => c.id === currentManagingClassId);
        if (foundIdx !== -1) allClasses[foundIdx] = updated;
        renderClassAssignedTests(updated);
        populateClassAssignTestSelector(updated);
        renderClassesList();
      } catch (e) {
        alert(e.message);
      } finally {
        assignTestBtn.disabled = false;
      }
    });
  }

  loadAdminClasses();
}

let cachedUpdateData = null;

function initSystemUpdateControls() {
  const manualCheckBtn = document.getElementById('manualCheckUpdateBtn');
  const bannerUpdateBtn = document.getElementById('bannerUpdateNowBtn');
  const bannerDismissBtn = document.getElementById('bannerDismissUpdateBtn');
  const modalCloseBtn = document.getElementById('closeUpdateModalBtn');
  const modalCancelBtn = document.getElementById('modalCancelUpdateBtn');
  const modalConfirmBtn = document.getElementById('modalConfirmUpdateBtn');

  if (manualCheckBtn) {
    manualCheckBtn.addEventListener('click', () => {
      checkSystemUpdate(false);
    });
  }

  if (bannerUpdateBtn) {
    bannerUpdateBtn.addEventListener('click', async () => {
      if (cachedUpdateData) {
        openUpdateModal(cachedUpdateData);
      } else {
        await checkSystemUpdate(false);
        if (cachedUpdateData) openUpdateModal(cachedUpdateData);
      }
    });
  }

  if (bannerDismissBtn) {
    bannerDismissBtn.addEventListener('click', () => {
      const banner = document.getElementById('systemUpdateBanner');
      if (banner) banner.classList.add('hidden');
    });
  }

  if (modalCloseBtn) {
    modalCloseBtn.addEventListener('click', closeUpdateModal);
  }

  if (modalCancelBtn) {
    modalCancelBtn.addEventListener('click', closeUpdateModal);
  }

  if (modalConfirmBtn) {
    modalConfirmBtn.addEventListener('click', applySystemUpdate);
  }

  setTimeout(() => {
    checkSystemUpdate(true);
  }, 1000);
}

async function checkSystemUpdate(silent = true) {
  try {
    const res = await adminFetch('/api/admin/update/check');
    if (!res.ok) return;
    const data = await res.json();
    cachedUpdateData = data;

    const versionBadge = document.getElementById('currentVersionBadge');
    if (versionBadge && data.currentVersion) {
      versionBadge.textContent = data.currentVersion;
    }

    const banner = document.getElementById('systemUpdateBanner');
    const bannerVer = document.getElementById('updateBannerVersion');
    const bannerSub = document.getElementById('updateBannerSub');

    if (data.hasUpdate) {
      if (bannerVer) bannerVer.textContent = data.latestVersion;
      if (bannerSub && data.changelog) {
        bannerSub.textContent = data.changelog.length > 90 ? data.changelog.substring(0, 90) + '...' : data.changelog;
      }
      if (banner) banner.classList.remove('hidden');
    } else {
      if (banner) banner.classList.add('hidden');
      if (!silent) {
        alert(`У вас встановлена остання версія SecureExam (${data.currentVersion || '1.0.0'}). Оновлення не потрібне.`);
      }
    }
  } catch (err) {
    if (!silent) alert('Помилка перевірки оновлення: ' + err.message);
  }
}

function openUpdateModal(data) {
  const modal = document.getElementById('systemUpdateModal');
  if (!modal) return;
  const verDisplay = document.getElementById('modalUpdateVersionDisplay');
  const changelogContent = document.getElementById('modalUpdateChangelogContent');
  const progressArea = document.getElementById('modalUpdateProgressArea');
  const successArea = document.getElementById('modalUpdateSuccessArea');
  const actionsArea = document.getElementById('modalUpdateActions');
  const confirmBtn = document.getElementById('modalConfirmUpdateBtn');
  const cancelBtn = document.getElementById('modalCancelUpdateBtn');
  const closeBtn = document.getElementById('closeUpdateModalBtn');

  if (verDisplay) verDisplay.textContent = data.latestVersion || '1.2.0';
  if (changelogContent) changelogContent.textContent = data.changelog || 'Покращення інтерфейсу та виправлення помилок.';
  if (progressArea) progressArea.classList.add('hidden');
  if (successArea) successArea.classList.add('hidden');
  if (actionsArea) actionsArea.classList.remove('hidden');
  if (confirmBtn) confirmBtn.disabled = false;
  if (cancelBtn) cancelBtn.disabled = false;
  if (closeBtn) closeBtn.disabled = false;

  modal.classList.remove('hidden');
}

function closeUpdateModal() {
  const modal = document.getElementById('systemUpdateModal');
  if (modal) modal.classList.add('hidden');
}

async function applySystemUpdate() {
  if (!cachedUpdateData) return;
  const progressArea = document.getElementById('modalUpdateProgressArea');
  const progressText = document.getElementById('modalUpdateProgressText');
  const percentText = document.getElementById('modalUpdatePercentText');
  const progressBar = document.getElementById('modalUpdateProgressBar');
  const detailText = document.getElementById('modalUpdateDetailText');
  const successArea = document.getElementById('modalUpdateSuccessArea');
  const actionsArea = document.getElementById('modalUpdateActions');
  const confirmBtn = document.getElementById('modalConfirmUpdateBtn');
  const cancelBtn = document.getElementById('modalCancelUpdateBtn');
  const closeBtn = document.getElementById('closeUpdateModalBtn');

  if (actionsArea) actionsArea.classList.add('hidden');
  if (progressArea) progressArea.classList.remove('hidden');
  if (successArea) successArea.classList.add('hidden');
  if (progressBar) progressBar.style.width = '5%';
  if (percentText) percentText.textContent = '5%';
  if (progressText) progressText.textContent = 'Створення резервної копії...';
  if (detailText) detailText.textContent = 'Підготовка даних';
  if (confirmBtn) confirmBtn.disabled = true;
  if (cancelBtn) cancelBtn.disabled = true;
  if (closeBtn) closeBtn.disabled = true;

  let progressInterval = setInterval(async () => {
    try {
      const pRes = await adminFetch('/api/admin/update/progress');
      if (pRes.ok) {
        const pData = await pRes.json();
        if (pData && typeof pData.percent === 'number') {
          if (progressBar) progressBar.style.width = Math.max(5, pData.percent) + '%';
          if (percentText) percentText.textContent = pData.percent + '%';
          if (progressText && pData.stage) progressText.textContent = pData.stage;
          if (detailText && pData.detail) detailText.textContent = pData.detail;
        }
      }
    } catch {}
  }, 250);

  try {
    const res = await adminFetch('/api/admin/update/apply', {
      method: 'POST',
      body: JSON.stringify({
        targetVersion: cachedUpdateData.latestVersion,
        downloadUrl: cachedUpdateData.downloadUrl
      })
    });

    clearInterval(progressInterval);

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Помилка під час встановлення оновлення');
    }

    if (progressBar) progressBar.style.width = '100%';
    if (percentText) percentText.textContent = '100%';
    if (progressText) progressText.textContent = 'Оновлення завершено!';
    if (detailText) detailText.textContent = 'Сервер перезапускається...';

    setTimeout(() => {
      if (progressArea) progressArea.classList.add('hidden');
      if (successArea) successArea.classList.remove('hidden');
      pollServerHealthAndReload();
    }, 600);

  } catch (err) {
    clearInterval(progressInterval);
    if (progressArea) progressArea.classList.add('hidden');
    if (actionsArea) actionsArea.classList.remove('hidden');
    if (confirmBtn) confirmBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = false;
    if (closeBtn) closeBtn.disabled = false;
    alert('Помилка: ' + err.message);
  }
}

function pollServerHealthAndReload() {
  let attempts = 0;
  const interval = setInterval(async () => {
    attempts++;
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      if (res.ok) {
        clearInterval(interval);
        setTimeout(() => {
          window.location.reload();
        }, 500);
      }
    } catch {}
    if (attempts > 50) {
      clearInterval(interval);
      window.location.reload();
    }
  }, 1000);
}

const changePasswordModal = document.getElementById('changePasswordModal');
const openChangePasswordModalBtn = document.getElementById('openChangePasswordModalBtn');
const closeChangePasswordModalBtn = document.getElementById('closeChangePasswordModalBtn');
const cancelChangePasswordBtn = document.getElementById('cancelChangePasswordBtn');
const submitChangePasswordBtn = document.getElementById('submitChangePasswordBtn');
const currentAdminPasswordInput = document.getElementById('currentAdminPasswordInput');
const newAdminPasswordInput = document.getElementById('newAdminPasswordInput');
const confirmAdminPasswordInput = document.getElementById('confirmAdminPasswordInput');
const changePasswordStatus = document.getElementById('changePasswordStatus');

function openChangePasswordModal() {
  if (!changePasswordModal) return;
  if (currentAdminPasswordInput) currentAdminPasswordInput.value = '';
  if (newAdminPasswordInput) newAdminPasswordInput.value = '';
  if (confirmAdminPasswordInput) confirmAdminPasswordInput.value = '';
  if (changePasswordStatus) {
    changePasswordStatus.textContent = '';
    changePasswordStatus.style.color = '';
  }
  changePasswordModal.classList.remove('hidden');
  changePasswordModal.style.display = 'flex';
}

function closeChangePasswordModal() {
  if (!changePasswordModal) return;
  changePasswordModal.classList.add('hidden');
  changePasswordModal.style.display = 'none';
}

if (openChangePasswordModalBtn) openChangePasswordModalBtn.addEventListener('click', openChangePasswordModal);
if (closeChangePasswordModalBtn) closeChangePasswordModalBtn.addEventListener('click', closeChangePasswordModal);
if (cancelChangePasswordBtn) cancelChangePasswordBtn.addEventListener('click', closeChangePasswordModal);

if (submitChangePasswordBtn) {
  submitChangePasswordBtn.addEventListener('click', async () => {
    const cur = (currentAdminPasswordInput ? currentAdminPasswordInput.value : '').trim();
    const np = (newAdminPasswordInput ? newAdminPasswordInput.value : '').trim();
    const cp = (confirmAdminPasswordInput ? confirmAdminPasswordInput.value : '').trim();

    if (!cur) {
      if (changePasswordStatus) {
        changePasswordStatus.textContent = 'Введіть поточний пароль';
        changePasswordStatus.style.color = 'var(--accent-red)';
      }
      return;
    }
    if (!np || np.length < 4) {
      if (changePasswordStatus) {
        changePasswordStatus.textContent = 'Новий пароль має бути не менше 4 символів';
        changePasswordStatus.style.color = 'var(--accent-red)';
      }
      return;
    }
    if (np !== cp) {
      if (changePasswordStatus) {
        changePasswordStatus.textContent = 'Нові паролі не співпадають';
        changePasswordStatus.style.color = 'var(--accent-red)';
      }
      return;
    }

    try {
      submitChangePasswordBtn.disabled = true;
      const res = await adminFetch('/api/admin/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: cur, newPassword: np })
      });
      const data = await res.json();
      submitChangePasswordBtn.disabled = false;
      if (res.ok && data.success) {
        adminToken = data.token || np;
        localStorage.setItem('admin_token', adminToken);
        if (changePasswordStatus) {
          changePasswordStatus.textContent = '✓ Пароль успішно змінено!';
          changePasswordStatus.style.color = 'var(--accent-green)';
        }
        showAdminToast('Пароль успішно змінено');
        setTimeout(closeChangePasswordModal, 1200);
      } else {
        if (changePasswordStatus) {
          changePasswordStatus.textContent = data.error || 'Помилка зміни пароля';
          changePasswordStatus.style.color = 'var(--accent-red)';
        }
      }
    } catch (err) {
      submitChangePasswordBtn.disabled = false;
      if (changePasswordStatus) {
        changePasswordStatus.textContent = 'Помилка: ' + err.message;
        changePasswordStatus.style.color = 'var(--accent-red)';
      }
    }
  });
}
