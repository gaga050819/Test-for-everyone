import { ProctorEngine } from './proctor.js';

(function initTheme() {
  const btn = document.getElementById('themeToggleBtn');
  const apply = (t) => {
    document.documentElement.setAttribute('data-theme', t);
    if (btn) btn.innerHTML = `<img src="/img/icons/${t === 'dark' ? 'moon' : 'sun'}.svg" class="pixel-icon" alt="">`;
    localStorage.setItem('theme', t);
    requestAnimationFrame(() => {
      if (typeof drawQuestionCanvas === 'function' && window.currentTest && window.currentTest.questions) {
        const q = window.currentTest.questions[window.currentQuestionIndex];
        if (q) drawQuestionCanvas(q.text);
      }
    });
  };
  apply(localStorage.getItem('theme') || 'light');
  if (btn) btn.addEventListener('click', () => {
    apply(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });
})();


let isDebugMode = sessionStorage.getItem('dev_debug_mode') === '1';

async function checkDebugModeStatus() {
  try {
    const res = await fetch('/api/dev/debug-mode');
    if (res.ok) {
      const data = await res.json();
      isDebugMode = !!data.debugMode;
      updateDebugBadge();
    }
  } catch {}
}

function updateDebugBadge() {
  let badge = document.getElementById('debugModeBadge');
  if (isDebugMode) {
    if (!badge) {
      badge = document.createElement('span');
      badge.id = 'debugModeBadge';
      badge.className = 'device-pill';
      badge.style.background = 'rgba(234, 179, 8, 0.15)';
      badge.style.color = '#eab308';
      badge.style.border = '1px solid rgba(234, 179, 8, 0.4)';
      badge.style.fontWeight = '700';
      badge.textContent = '⚡ Debug Mode';
      const row = document.querySelector('.device-badge-row');
      if (row) row.appendChild(badge);
    }
  } else {
    if (badge) badge.remove();
  }
}

function attachDebug5Clicks(el) {
  if (!el || el.dataset.debugBound) return;
  el.dataset.debugBound = '1';
  let clicks = 0;
  let timer = null;
  el.style.cursor = 'pointer';
  el.addEventListener('click', () => {
    clicks++;
    clearTimeout(timer);
    timer = setTimeout(() => {
      clicks = 0;
    }, 2000);

    if (clicks >= 5) {
      clicks = 0;
      clearTimeout(timer);
      const key = prompt('Введіть ключ доступу для режиму розробника (Debug Mode):');
      if (key === null) return;
      const cleanKey = key.trim();
      if (cleanKey !== 'Honda2020!05081988') {
        alert('Невірний ключ доступу.');
        return;
      }

      toggleDebugMode(cleanKey);
    }
  });
}

function toggleDebugMode(cleanKey) {
  isDebugMode = !isDebugMode;
  sessionStorage.setItem('dev_debug_mode', isDebugMode ? '1' : '0');

  if (proctor) {
    proctor.isBypassed = isDebugMode;
  }
  if (currentSession) {
    currentSession.proctorBypassed = isDebugMode;
  }

  if (isDebugMode) {
    closeWarningModal();
    hideFatalOverlay();
    updateTrustScore(100);
    alert('Режим відлагодження (Debug Mode) УВІМКНЕНО! Усі сповіщення та перевірки відключено.');
  } else {
    alert('Режим відлагодження (Debug Mode) ВИМКНЕНО! Захист відновлено.');
  }

  updateDebugBadge();

  fetch('/api/dev/debug-mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: cleanKey })
  }).catch(() => {});
}

function setupDebugModeListener() {
  attachDebug5Clicks(document.getElementById('welcomeTitle'));
  attachDebug5Clicks(document.getElementById('testTitleDisplay'));
}

checkDebugModeStatus();
setupDebugModeListener();

let currentSession = null;
let currentTest = null;
let currentQuestionIndex = 0;
let userAnswers = {};
let questionTimings = {};
let currentQuestionStartTime = Date.now();
let availableTests = [];
let selectedTestId = 'demo-test-1';
let proctor = null;
let testTimer = null;
let testSecondsRemaining = 0;
let trustScore = 100;
let recordedIncidents = [];

const welcomeScreen = document.getElementById('welcomeScreen');
const testScreen = document.getElementById('testScreen');
const resultScreen = document.getElementById('resultScreen');

const testSelectInput = document.getElementById('testSelectInput');
const selectedTestInfoBadge = document.getElementById('selectedTestInfoBadge');
const studentNameInput = document.getElementById('studentNameInput');
const studentIdInput = document.getElementById('studentIdInput');
const startTestBtn = document.getElementById('startTestBtn');
const deviceTypePill = document.getElementById('deviceTypePill');

const testTitleDisplay = document.getElementById('testTitleDisplay');
const testTimerDisplay = document.getElementById('testTimerDisplay');
const trustScoreNumber = document.getElementById('trustScoreNumber');
const trustScoreCircle = document.getElementById('trustScoreCircle');
const trustStatusText = document.getElementById('trustStatusText');
const networkStatusDot = document.getElementById('networkStatusDot');
const networkStatusText = document.getElementById('networkStatusText');

const questionCounterBadge = document.getElementById('questionCounterBadge');
const questionProgressFill = document.getElementById('questionProgressFill');
const questionCanvas = document.getElementById('questionCanvas');
const optionsList = document.getElementById('optionsList');
const questionNavPills = document.getElementById('questionNavPills');

const prevQuestionBtn = document.getElementById('prevQuestionBtn');
const nextQuestionBtn = document.getElementById('nextQuestionBtn');
const submitTestBtn = document.getElementById('submitTestBtn');

const warningModal = document.getElementById('warningModal');
const warningTitle = document.getElementById('warningTitle');
const warningMessage = document.getElementById('warningMessage');
const warningCountdown = document.getElementById('warningCountdown');
const warningActionBtn = document.getElementById('warningActionBtn');

const summarySubmitModal = document.getElementById('summarySubmitModal');
const summaryModalIcon = document.getElementById('summaryModalIcon');
const summaryModalTitle = document.getElementById('summaryModalTitle');
const summaryModalMessage = document.getElementById('summaryModalMessage');
const summaryModalPillsWrap = document.getElementById('summaryModalPillsWrap');
const summaryBackBtn = document.getElementById('summaryBackBtn');
const summaryConfirmBtn = document.getElementById('summaryConfirmBtn');

const cameraStatusBlock      = document.getElementById('cameraStatusBlock');
const cameraStatusIcon       = document.getElementById('cameraStatusIcon');
const cameraStatusTitle      = document.getElementById('cameraStatusTitle');
const cameraStatusDesc       = document.getElementById('cameraStatusDesc');
const cameraActionsRow       = document.getElementById('cameraActionsRow');
const cameraRetryBtn         = document.getElementById('cameraRetryBtn');
const cameraCopyIncognitoBtn = document.getElementById('cameraCopyIncognitoBtn');
const cameraHowTo            = document.getElementById('cameraHowTo');

let isCameraReady = false;
let activeCameraStream = null;

function initCameraTabs() {
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);

  let defaultTab = 'desktop';
  if (isIOS) defaultTab = 'ios';
  else if (isAndroid) defaultTab = 'android';

  const tabBtns = document.querySelectorAll('.cam-tab-btn');
  const tabContents = {
    android: document.getElementById('camTabContentAndroid'),
    ios: document.getElementById('camTabContentIos'),
    desktop: document.getElementById('camTabContentDesktop')
  };

  function switchTab(target) {
    tabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === target);
    });
    Object.keys(tabContents).forEach(key => {
      if (tabContents[key]) {
        tabContents[key].classList.toggle('hidden', key !== target);
      }
    });
  }

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  switchTab(defaultTab);
}

if (cameraCopyIncognitoBtn) {
  cameraCopyIncognitoBtn.addEventListener('click', async () => {
    const url = window.location.href;
    let copied = false;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch (e) {}
    }
    if (!copied) {
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); copied = true; } catch (e) {}
      ta.remove();
    }

    const toast = document.createElement('div');
    toast.className = 'cam-copy-toast';
    toast.innerHTML = '<img src="/img/icons/check.svg" class="pixel-icon inline" alt=""> Посилання скопійовано! Відкрийте нову вкладку Інкогніто у вашому браузері та вставте його туди.';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  });
}

function setCameraStatus(state) {
  if (state === 'checking') {
    isCameraReady = false;
    if (cameraStatusBlock) cameraStatusBlock.className = 'cam-card status-checking';
    if (cameraStatusIcon) cameraStatusIcon.innerHTML = '<img src="/img/icons/hourglass.svg" class="pixel-icon" alt="">';
    if (cameraStatusTitle) cameraStatusTitle.textContent = 'Запит доступу до камери (необов\'язково)...';
    if (cameraStatusDesc) cameraStatusDesc.textContent = 'Дозвольте використання камери у спливаючому вікні браузера або продовжуйте без неї.';
    if (cameraActionsRow) cameraActionsRow.classList.add('hidden');
    if (cameraHowTo) cameraHowTo.classList.add('hidden');
    if (startTestBtn) {
      startTestBtn.disabled = false;
      startTestBtn.style.opacity = '1';
      startTestBtn.style.cursor = 'pointer';
    }
  } else if (state === 'granted') {
    isCameraReady = true;
    if (cameraStatusBlock) cameraStatusBlock.className = 'cam-card status-granted';
    if (cameraStatusIcon) cameraStatusIcon.innerHTML = '<img src="/img/icons/check.svg" class="pixel-icon" alt="">';
    if (cameraStatusTitle) cameraStatusTitle.textContent = 'Камера підключена та активна';
    if (cameraStatusDesc) cameraStatusDesc.textContent = 'Фронтальна камера готова. Можна переходити до тестування.';
    if (cameraActionsRow) cameraActionsRow.classList.add('hidden');
    if (cameraHowTo) cameraHowTo.classList.add('hidden');
    if (startTestBtn) {
      startTestBtn.disabled = false;
      startTestBtn.style.opacity = '1';
      startTestBtn.style.cursor = 'pointer';
    }
  } else if (state === 'denied') {
    isCameraReady = false;
    if (activeCameraStream) {
      activeCameraStream.getTracks().forEach(t => t.stop());
      activeCameraStream = null;
    }
    if (cameraStatusBlock) cameraStatusBlock.className = 'cam-card status-denied';
    if (cameraStatusIcon) cameraStatusIcon.innerHTML = '<img src="/img/icons/blocked.svg" class="pixel-icon" alt="">';
    if (cameraStatusTitle) cameraStatusTitle.textContent = 'Камеру не увімкнено (необов\'язково)';
    if (cameraStatusDesc) cameraStatusDesc.textContent = 'Браузер не отримав доступу до камери. Ви можете скласти тест без камери або увімкнути її за інструкцією нижче.';
    if (cameraActionsRow) cameraActionsRow.classList.remove('hidden');
    if (cameraHowTo) cameraHowTo.classList.remove('hidden');
    if (startTestBtn) {
      startTestBtn.disabled = false;
      startTestBtn.style.opacity = '1';
      startTestBtn.style.cursor = 'pointer';
    }
  } else if (state === 'unavailable') {
    isCameraReady = false;
    if (activeCameraStream) {
      activeCameraStream.getTracks().forEach(t => t.stop());
      activeCameraStream = null;
    }
    if (cameraStatusBlock) cameraStatusBlock.className = 'cam-card status-denied';
    if (cameraStatusIcon) cameraStatusIcon.innerHTML = '<img src="/img/icons/camera.svg" class="pixel-icon" alt="">';
    if (cameraStatusTitle) cameraStatusTitle.textContent = 'Камеру не знайдено (необов\'язково)';
    if (cameraStatusDesc) cameraStatusDesc.textContent = 'Працюючу камеру не виявлено. Ви можете продовжувати тестування без камери.';
    if (cameraActionsRow) cameraActionsRow.classList.remove('hidden');
    if (cameraHowTo) cameraHowTo.classList.add('hidden');
    if (startTestBtn) {
      startTestBtn.disabled = false;
      startTestBtn.style.opacity = '1';
      startTestBtn.style.cursor = 'pointer';
    }
  }
}

async function checkCameraPermission() {
  setCameraStatus('checking');

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setCameraStatus('unavailable');
    return;
  }

  try {
    if (navigator.permissions && navigator.permissions.query) {
      const perm = await navigator.permissions.query({ name: 'camera' }).catch(() => null);
      if (perm && perm.state === 'denied') {
        setCameraStatus('denied');
        return;
      }
    }

    if (activeCameraStream && activeCameraStream.active) {
      setCameraStatus('granted');
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 } },
      audio: false
    });
    activeCameraStream = stream;
    setCameraStatus('granted');
  } catch (err) {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      setCameraStatus('denied');
    } else {
      setCameraStatus('unavailable');
    }
  }
}

if (cameraRetryBtn) {
  cameraRetryBtn.addEventListener('click', () => checkCameraPermission());
}

initCameraTabs();
checkCameraPermission();

window.addEventListener('beforeunload', () => {
  if (activeCameraStream) {
    activeCameraStream.getTracks().forEach(t => t.stop());
  }
});


let livePingMs = 0;
async function measureLivePing() {
  const start = Date.now();
  try {
    const res = await fetch('/api/ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientTimestamp: start }),
      cache: 'no-store'
    });
    if (res.ok) {
      livePingMs = Math.max(1, Date.now() - start);
      updateLivePingUI(livePingMs, true);
    } else {
      updateLivePingUI(0, false);
    }
  } catch {
    updateLivePingUI(0, false);
  }
}
setInterval(measureLivePing, 2000);
measureLivePing();

function updateLivePingUI(latency, isOnline) {
  const isHigh = latency > 250;
  if (networkStatusDot) networkStatusDot.className = isOnline ? (isHigh ? 'status-dot warning' : 'status-dot') : 'status-dot danger';
  if (networkStatusText) networkStatusText.textContent = isOnline ? `${latency} ms${isHigh ? ' (Високий пінг)' : ''}` : 'Офлайн';
  const testDot = document.getElementById('testLivePingDot');
  const testVal = document.getElementById('testLivePingValue');
  if (testDot) testDot.className = isOnline ? (isHigh ? 'status-dot warning' : 'status-dot') : 'status-dot danger';
  if (testVal) testVal.textContent = isOnline ? `${latency} ms` : 'Офлайн';
}

function persistLocalSession() {
  if (!currentSession || !currentTest) return;
  const data = {
    sessionId: currentSession.id,
    studentName: currentSession.studentName,
    studentId: currentSession.studentId,
    testId: currentTest.id,
    title: currentTest.title,
    currentQuestionIndex,
    userAnswers,
    startedAt: currentSession.startedAt,
    durationMinutes: currentTest.durationMinutes || 15
  };
  try {
    localStorage.setItem('secure_exam_active_session', JSON.stringify(data));
  } catch {}
  fetch(`/api/sessions/${currentSession.id}/answers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers: userAnswers })
  }).catch(() => {});
}

function checkCachedSession() {
  try {
    const savedName = localStorage.getItem('saved_student_name');
    const savedId = localStorage.getItem('saved_student_id');
    if (savedName && studentNameInput && !studentNameInput.value) studentNameInput.value = savedName;
    if (savedId && studentIdInput && !studentIdInput.value) studentIdInput.value = savedId;

    const raw = localStorage.getItem('secure_exam_active_session');
    if (!raw) return;
    const cached = JSON.parse(raw);
    if (!cached || !cached.sessionId) return;

    const banner = document.getElementById('resumeSessionBanner');
    const title = document.getElementById('resumeSessionTitle');
    const sub = document.getElementById('resumeSessionSub');
    const answeredCount = Object.keys(cached.userAnswers || {}).length;

    if (title) title.textContent = `Знайдено збережену сесію: ${cached.studentName}`;
    if (sub) sub.textContent = `Збережено відповідей: ${answeredCount}. Можна продовжити без втрати прогресу.`;
    if (banner) banner.classList.remove('hidden');

    const resumeBtn = document.getElementById('resumeSessionBtn');
    if (resumeBtn) {
      resumeBtn.onclick = () => resumeSession(cached);
    }
    const discardBtn = document.getElementById('discardSessionBtn');
    if (discardBtn) {
      discardBtn.onclick = () => {
        if (confirm('Скинути збережену спробу та розпочати новий тест?')) {
          localStorage.removeItem('secure_exam_active_session');
          banner.classList.add('hidden');
        }
      };
    }
  } catch (e) {
    console.error(e);
  }
}

async function resumeSession(cached) {
  try {
    const resumeBtn = document.getElementById('resumeSessionBtn');
    if (resumeBtn) {
      resumeBtn.disabled = true;
      resumeBtn.textContent = 'Відновлення...';
    }

    const res = await fetch(`/api/sessions/${cached.sessionId}/state`);
    if (!res.ok) {
      localStorage.removeItem('secure_exam_active_session');
      alert('Сесію на сервері не знайдено або вже завершено.');
      const banner = document.getElementById('resumeSessionBanner');
      if (banner) banner.classList.add('hidden');
      return;
    }
    const state = await res.json();
    if (state.status === 'completed' || state.status === 'disqualified') {
      localStorage.removeItem('secure_exam_active_session');
      alert('Цю сесію тестування вже було здано.');
      const banner = document.getElementById('resumeSessionBanner');
      if (banner) banner.classList.add('hidden');
      return;
    }

    currentSession = state;
    currentTest = {
      id: state.testId,
      title: state.title || cached.title || 'Підсумковий екзамен',
      durationMinutes: state.durationMinutes || cached.durationMinutes || 15,
      questions: state.questions
    };

    userAnswers = { ...(cached.userAnswers || {}), ...(state.partialAnswers || {}) };
    currentQuestionIndex = cached.currentQuestionIndex || 0;
    if (currentQuestionIndex >= currentTest.questions.length) currentQuestionIndex = 0;

    trustScore = state.trustScore !== undefined ? state.trustScore : 100;
    updateTrustScore(trustScore);

    const elapsedSeconds = Math.floor((Date.now() - state.startedAt) / 1000);
    const totalSeconds = (currentTest.durationMinutes || 15) * 60;
    testSecondsRemaining = Math.max(10, totalSeconds - elapsedSeconds);

    proctor = new ProctorEngine({
      sessionId: currentSession.id,
      studentName: currentSession.studentName,
      studentId: currentSession.studentId,
      clientIp: currentSession.clientIp || '127.0.0.1',
      cameraStream: activeCameraStream,
      proctorBypassed: !!state.proctorBypassed || isDebugMode,
      onIncident: (incident) => {
        if (isDebugMode || (proctor && proctor.isBypassed)) return;
        recordedIncidents.push(incident);
        if (incident.penalty) {
          updateTrustScore(trustScore - incident.penalty);
        }
      },
      onStatusChange: (statusData) => {
        updateLivePingUI(livePingMs, statusData.status !== 'offline');
      },
      onPingUpdate: (pingData) => {
        updateLivePingUI(pingData.latency, pingData.isOnline);
      },
      onTrustScoreUpdate: (newScore) => {
        updateTrustScore(newScore);
      },
      onWarning: (warningData) => {
        if (!warningData || isDebugMode || (proctor && proctor.isBypassed)) {
          closeWarningModal();
          return;
        }
        showWarningModal(warningData);
      },
      onFatalViolation: (fatalData) => {
        if (isDebugMode || (proctor && proctor.isBypassed)) return;
        showFatalOverlay(fatalData.reason);
      },
      onAdminUnlock: ({ trustScore: ts }) => {
        hideFatalOverlay();
        closeWarningModal();
        updateTrustScore(ts);
      },
      onAdminBypass: ({ trustScore: ts }) => {
        hideFatalOverlay();
        closeWarningModal();
        updateTrustScore(ts);
      }
    });

    if (proctor.isFullscreenSupported() && !isDebugMode && !state.proctorBypassed) {
      await proctor.enterFullscreen();
    }
    await proctor.start();

    initTestUI(true);
  } catch (err) {
    console.error(err);
    alert('Помилка відновлення сесії: ' + err.message);
    const resumeBtn = document.getElementById('resumeSessionBtn');
    if (resumeBtn) {
      resumeBtn.disabled = false;
      resumeBtn.textContent = 'Продовжити';
    }
  }
}

checkCachedSession();

let publicClasses = [];
const classSelectInput = document.getElementById('classSelectInput');
const classAssignedHint = document.getElementById('classAssignedHint');
const testTopicSearchInput = document.getElementById('testTopicSearchInput');
const subjectFilterSelect = document.getElementById('subjectFilterSelect');
const topicFilterSelect = document.getElementById('topicFilterSelect');
const testsCountBadge = document.getElementById('testsCountBadge');

async function loadAvailableClasses() {
  if (!classSelectInput) return;
  try {
    const res = await fetch('/api/classes');
    if (!res.ok) return;
    publicClasses = await res.json();
    if (!publicClasses || publicClasses.length === 0) return;

    classSelectInput.innerHTML = '<option value="">Оберіть клас зі списку...</option>';
    publicClasses.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.name} (${c.subject || 'Географія'})`;
      classSelectInput.appendChild(opt);
    });

    const savedId = localStorage.getItem('saved_student_id');
    if (savedId) {
      const matched = publicClasses.find(c => c.name.toLowerCase() === savedId.toLowerCase());
      if (matched) {
        classSelectInput.value = matched.id;
        updateClassSelection();
      }
    }

    classSelectInput.addEventListener('change', () => {
      updateClassSelection();
      renderTestOptions();
    });
  } catch (err) {
    console.error(err);
  }
}

function updateClassSelection() {
  const chosenClassId = classSelectInput ? classSelectInput.value : '';
  const chosen = publicClasses.find(c => c.id === chosenClassId);
  if (chosen) {
    if (studentIdInput) studentIdInput.value = chosen.name;
    if (classAssignedHint) {
      const count = (chosen.assignedTests || []).length;
      if (count > 0) {
        classAssignedHint.textContent = `✓ Для класу ${chosen.name} закріплено ${count} тестів`;
        classAssignedHint.classList.remove('hidden');
      } else {
        classAssignedHint.classList.add('hidden');
      }
    }
  } else {
    if (classAssignedHint) classAssignedHint.classList.add('hidden');
  }
}

function populateSubjectFilter() {
  if (!subjectFilterSelect) return;
  const currentVal = subjectFilterSelect.value;
  const subjects = [...new Set(availableTests.map(t => (t.subject || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'uk'));
  subjectFilterSelect.innerHTML = '<option value="">Усі предмети</option>';
  subjects.forEach(sb => {
    const opt = document.createElement('option');
    opt.value = sb;
    opt.textContent = sb;
    if (sb === currentVal) opt.selected = true;
    subjectFilterSelect.appendChild(opt);
  });
}

function populateTopicFilter() {
  if (!topicFilterSelect) return;
  const currentVal = topicFilterSelect.value;
  const selectedSubject = subjectFilterSelect ? subjectFilterSelect.value.trim().toLowerCase() : '';
  let pool = availableTests;
  if (selectedSubject) {
    pool = pool.filter(t => (t.subject || '').trim().toLowerCase() === selectedSubject);
  }
  const topics = [...new Set(pool.map(t => (t.topic || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'uk'));
  topicFilterSelect.innerHTML = '<option value="">Усі теми</option>';
  topics.forEach(tp => {
    const opt = document.createElement('option');
    opt.value = tp;
    opt.textContent = tp;
    if (tp === currentVal) opt.selected = true;
    topicFilterSelect.appendChild(opt);
  });
  if (currentVal && !topics.includes(currentVal)) {
    topicFilterSelect.value = '';
  }
}

function renderTestOptions() {
  if (!testSelectInput) return;
  const q = testTopicSearchInput ? testTopicSearchInput.value.trim().toLowerCase() : '';
  const selectedSubject = subjectFilterSelect ? subjectFilterSelect.value.trim().toLowerCase() : '';
  const selectedTopic = topicFilterSelect ? topicFilterSelect.value.trim().toLowerCase() : '';
  const chosenClassId = classSelectInput ? classSelectInput.value : '';
  const chosenClass = publicClasses.find(c => c.id === chosenClassId);

  let filtered = availableTests.slice();

  if (chosenClass && Array.isArray(chosenClass.assignedTests) && chosenClass.assignedTests.length > 0) {
    const assignedSet = new Set(chosenClass.assignedTests);
    filtered = filtered.filter(t => assignedSet.has(t.id));
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

  filtered.sort((a, b) => (a.subject || '').localeCompare(b.subject || '', 'uk') || (a.topic || '').localeCompare(b.topic || '', 'uk') || (a.title || '').localeCompare(b.title || '', 'uk'));

  if (testsCountBadge) {
    testsCountBadge.textContent = `${filtered.length} тестів`;
  }

  testSelectInput.innerHTML = '';
  if (filtered.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Тестів за цим фільтром не знайдено';
    testSelectInput.appendChild(opt);
    if (selectedTestInfoBadge) selectedTestInfoBadge.innerHTML = '';
    return;
  }

  const distinctSubjects = [...new Set(filtered.map(t => (t.subject || '').trim() || 'Без предмета'))];
  if (distinctSubjects.length > 1) {
    const grouped = {};
    filtered.forEach(t => {
      const s = (t.subject || '').trim() || 'Інші предмети';
      if (!grouped[s]) grouped[s] = [];
      grouped[s].push(t);
    });
    Object.keys(grouped).sort((a, b) => a.localeCompare(b, 'uk')).forEach(subjName => {
      const grp = document.createElement('optgroup');
      grp.label = subjName;
      grouped[subjName].forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        const topicLabel = t.topic ? `[${t.topic}] ` : '';
        opt.textContent = `${topicLabel}${t.title} (${t.questionsCount} пит., ${t.durationMinutes} хв)`;
        grp.appendChild(opt);
      });
      testSelectInput.appendChild(grp);
    });
  } else {
    filtered.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      const subjLabel = (distinctSubjects.length > 1 && t.subject) ? `[${t.subject}] ` : '';
      const topicLabel = t.topic ? `[${t.topic}] ` : '';
      opt.textContent = `${subjLabel}${topicLabel}${t.title} (${t.questionsCount} пит., ${t.durationMinutes} хв)`;
      testSelectInput.appendChild(opt);
    });
  }

  if (filtered.some(t => t.id === selectedTestId)) {
    testSelectInput.value = selectedTestId;
  } else if (filtered[0]) {
    selectedTestId = filtered[0].id;
    testSelectInput.value = selectedTestId;
  }

  updateSelectedBadge();
}

function updateSelectedBadge() {
  const cur = availableTests.find(t => t.id === (testSelectInput ? testSelectInput.value : selectedTestId));
  const activeTestTitleDisplay = document.getElementById('activeTestTitleDisplay');
  const startBtn = document.getElementById('startTestBtn');
  if (cur) {
    selectedTestId = cur.id;
    const welcomeTitle = document.getElementById('welcomeTitle');
    if (welcomeTitle) welcomeTitle.textContent = cur.title;
    if (activeTestTitleDisplay) {
      activeTestTitleDisplay.textContent = cur.title;
      activeTestTitleDisplay.classList.remove('skeleton');
    }
    if (selectedTestInfoBadge) {
      selectedTestInfoBadge.innerHTML = `
        <span class="tag-badge approved"><img src="/img/icons/folder.svg" class="pixel-icon inline" alt=""> ${escapeHtml(cur.topic || 'Загальний тест')}</span>
        <span class="tag-badge" style="background: var(--bg-surface); border: 1px solid var(--border);"><img src="/img/icons/timer.svg" class="pixel-icon inline" alt=""> ${cur.durationMinutes} хв</span>
        <span class="tag-badge" style="background: var(--bg-surface); border: 1px solid var(--border);"><img src="/img/icons/report.svg" class="pixel-icon inline" alt=""> ${cur.questionsCount} питань</span>
      `;
    }
    if (startBtn) startBtn.classList.remove('start-btn-disabled');
  } else {
    if (activeTestTitleDisplay) {
      activeTestTitleDisplay.innerHTML = '<div class="skeleton-line skeleton" style="width:80%"></div><div class="skeleton-line skeleton" style="width:55%"></div>';
    }
    if (selectedTestInfoBadge) selectedTestInfoBadge.innerHTML = '';
    if (startBtn) startBtn.classList.add('start-btn-disabled');
  }
}

async function loadAvailableTests() {
  try {
    const res = await fetch('/api/tests');
    if (!res.ok) return;
    availableTests = await res.json();
    if (!availableTests || availableTests.length === 0) return;

    try {
      const activeRes = await fetch('/api/active-test');
      if (activeRes.ok) {
        const activeData = await activeRes.json();
        if (activeData && activeData.id) {
          selectedTestId = activeData.id;
        }
      }
    } catch {}

    if (!selectedTestId || !availableTests.some(t => t.id === selectedTestId)) {
      if (availableTests[0]) selectedTestId = availableTests[0].id;
    }

    if (testSelectInput) testSelectInput.value = selectedTestId;
    updateSelectedBadge();
  } catch (err) {
    console.error(err);
  }
}

loadAvailableClasses();
loadAvailableTests();

const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || ('ontouchstart' in window);
if (deviceTypePill) {
  deviceTypePill.innerHTML = isMobile ? '<img src="/img/icons/mobile.svg" class="pixel-icon inline" alt=""> Мобільний пристрій' : '<img src="/img/icons/desktop.svg" class="pixel-icon inline" alt=""> Персональний комп\'ютер';
}

[studentNameInput, studentIdInput].forEach(inp => {
  if (inp) {
    inp.addEventListener('focus', () => { if (proctor) proctor.isInputFocused = true; });
    inp.addEventListener('blur',  () => { if (proctor) proctor.isInputFocused = false; });
  }
});

startTestBtn.addEventListener('click', async () => {
  const name = studentNameInput.value.trim() || (isDebugMode ? 'Тестер' : '');
  const studentId = studentIdInput.value.trim() || (isDebugMode ? '10-Debug' : '');

  if (!name) {
    alert('Будь ласка, введіть ваше прізвище та ім\'я');
    return;
  }

  if (!studentId) {
    alert('Будь ласка, введіть ваш клас');
    return;
  }

  localStorage.setItem('saved_student_name', name);
  localStorage.setItem('saved_student_id', studentId);

  let resumeSessionId = null;
  try {
    const raw = localStorage.getItem('secure_exam_active_session');
    if (raw) {
      const cached = JSON.parse(raw);
      if (cached && cached.sessionId && cached.studentName.toLowerCase() === name.toLowerCase()) {
        resumeSessionId = cached.sessionId;
      }
    }
  } catch {}

  try {
    startTestBtn.disabled = true;
    startTestBtn.textContent = 'Підготовка системи...';

    const chosenTestId = (testSelectInput && testSelectInput.value) ? testSelectInput.value : selectedTestId || 'demo-test-1';
    const testRes = await fetch(`/api/tests/${chosenTestId}`);
    if (!testRes.ok) throw new Error('Помилка завантаження тесту');
    currentTest = await testRes.json();
    questionTimings = {};
    currentQuestionStartTime = Date.now();

    const sessionRes = await fetch('/api/sessions/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentName: name,
        studentId: studentId,
        testId: currentTest.id,
        resumeSessionId,
        proctorBypassed: isDebugMode,
        clientInfo: {
          isMobile,
          userAgent: navigator.userAgent,
          screenWidth: window.screen.width,
          screenHeight: window.screen.height
        }
      })
    });

    if (!sessionRes.ok) throw new Error('Помилка реєстрації сесії');
    currentSession = await sessionRes.json();
    if (currentSession.questions && currentSession.questions.length > 0) {
      currentTest.questions = currentSession.questions;
    }

    if (currentSession.partialAnswers) {
      userAnswers = { ...userAnswers, ...currentSession.partialAnswers };
    }

    if (currentSession.trustScore !== undefined) {
      trustScore = currentSession.trustScore;
      updateTrustScore(trustScore);
    }

    proctor = new ProctorEngine({
      sessionId: currentSession.id,
      studentName: name,
      studentId: studentId,
      clientIp: currentSession.clientIp || '127.0.0.1',
      cameraStream: activeCameraStream,
      proctorBypassed: !!currentSession.proctorBypassed || isDebugMode,
      onIncident: (incident) => {
        if (isDebugMode || (proctor && proctor.isBypassed)) return;
        recordedIncidents.push(incident);
        if (incident.penalty) {
          updateTrustScore(trustScore - incident.penalty);
        }
      },
      onStatusChange: (statusData) => {
        updateLivePingUI(livePingMs, statusData.status !== 'offline');
      },
      onPingUpdate: (pingData) => {
        updateLivePingUI(pingData.latency, pingData.isOnline);
      },
      onTrustScoreUpdate: (newScore) => {
        updateTrustScore(newScore);
      },
      onWarning: (warningData) => {
        if (!warningData || isDebugMode || (proctor && proctor.isBypassed)) {
          closeWarningModal();
          return;
        }
        showWarningModal(warningData);
      },
      onFatalViolation: (fatalData) => {
        if (isDebugMode || (proctor && proctor.isBypassed)) return;
        showFatalOverlay(fatalData.reason);
      },
      onAdminUnlock: ({ trustScore: ts }) => {
        hideFatalOverlay();
        closeWarningModal();
        updateTrustScore(ts);
      },
      onAdminBypass: ({ trustScore: ts }) => {
        hideFatalOverlay();
        closeWarningModal();
        updateTrustScore(ts);
      }
    });

    if (proctor.isFullscreenSupported() && !isDebugMode && !currentSession.proctorBypassed) {
      await proctor.enterFullscreen();
    }
    await proctor.start();

    persistLocalSession();
    initTestUI(currentSession.isResumed);
  } catch (err) {
    console.error(err);
    alert('Помилка запуску: ' + err.message);
    startTestBtn.disabled = false;
    startTestBtn.textContent = 'Розпочати тестування';
  }
});

function initTestUI(isResuming = false) {
  welcomeScreen.classList.add('hidden');
  testScreen.classList.remove('hidden');

  testTitleDisplay.textContent = currentTest.title || 'Підсумковий тест';
  attachDebug5Clicks(testTitleDisplay);
  if (isDebugMode && proctor) {
    proctor.isBypassed = true;
    closeWarningModal();
    hideFatalOverlay();
  }
  if (!isResuming) {
    testSecondsRemaining = (currentTest.durationMinutes || 15) * 60;
  }
  startTimer();

  renderNavPills();
  renderQuestion(currentQuestionIndex || 0);
}

function startTimer() {
  if (testTimer) clearInterval(testTimer);
  updateTimerDisplay();

  testTimer = setInterval(() => {
    testSecondsRemaining--;
    updateTimerDisplay();

    if (testSecondsRemaining <= 0) {
      clearInterval(testTimer);
      alert('Час на складання тесту вичерпано!');
      submitTest();
    }
  }, 1000);
}

function updateTimerDisplay() {
  const mins = Math.floor(testSecondsRemaining / 60);
  const secs = testSecondsRemaining % 60;
  const el = document.getElementById('testTimerDisplay');
  if (el) el.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  const ring = document.getElementById('timerRingVal');
  if (ring) {
    const totalSeconds = (currentTest && currentTest.durationMinutes ? currentTest.durationMinutes : 15) * 60;
    const circumference = 113.1;
    const ratio = Math.max(0, testSecondsRemaining / totalSeconds);
    ring.style.strokeDashoffset = circumference - ratio * circumference;
    ring.setAttribute('class', 'timer-ring-val');
    if (testSecondsRemaining <= 60) ring.classList.add('danger');
    else if (testSecondsRemaining <= 180) ring.classList.add('warning');
  }

  const statusEl = document.getElementById('timerStatusText');
  if (statusEl) {
    if (testSecondsRemaining <= 60) {
      statusEl.textContent = 'Мало часу!';
      statusEl.style.color = 'var(--accent-red)';
    } else if (testSecondsRemaining <= 180) {
      statusEl.textContent = 'Увага';
      statusEl.style.color = 'var(--accent-amber)';
    } else {
      statusEl.textContent = 'Таймер';
      statusEl.style.color = 'var(--accent-blue)';
    }
  }
}

function isQuestionAnswered(q) {
  if (!q) return false;
  const ans = userAnswers[q.id];
  if (q.type === 'multiple') {
    return Array.isArray(ans) && ans.length > 0;
  }
  if (q.type === 'matching') {
    return !!(ans && typeof ans === 'object' && Object.keys(ans).length > 0);
  }
  if (q.type === 'ordering') {
    return Array.isArray(ans) && ans.length > 0;
  }
  return ans !== undefined && ans !== null && ans !== '';
}

function getUnansweredQuestions() {
  if (!currentTest || !Array.isArray(currentTest.questions)) return [];
  const list = [];
  currentTest.questions.forEach((q, idx) => {
    if (!isQuestionAnswered(q)) {
      list.push({ index: idx, number: idx + 1, question: q });
    }
  });
  return list;
}

function renderNavPills() {
  questionNavPills.innerHTML = '';
  currentTest.questions.forEach((q, idx) => {
    const isAnswered = isQuestionAnswered(q);
    const pill = document.createElement('div');
    pill.className = 'pill-item' + (idx === currentQuestionIndex ? ' active' : '') + (isAnswered ? ' answered' : '');
    pill.textContent = idx + 1;
    pill.addEventListener('click', () => {
      renderQuestion(idx);
    });
    questionNavPills.appendChild(pill);
  });
}

function renderQuestion(index, direction = 'right') {
  if (currentTest && currentTest.questions && currentTest.questions[currentQuestionIndex]) {
    const prevQId = currentTest.questions[currentQuestionIndex].id;
    const elapsed = Math.max(1, Math.round((Date.now() - currentQuestionStartTime) / 1000));
    questionTimings[prevQId] = (questionTimings[prevQId] || 0) + elapsed;
  }
  currentQuestionStartTime = Date.now();

  const prevIndex = currentQuestionIndex;
  currentQuestionIndex = index;
  const slideDir = index > prevIndex ? 'right' : 'left';

  const question = currentTest.questions[index];

  if (proctor) {
    proctor.sendProgress(index + 1, currentTest.questions.length);
  }

  questionCounterBadge.textContent = `Питання ${index + 1} з ${currentTest.questions.length}`;
  const progressPercent = ((index + 1) / currentTest.questions.length) * 100;
  questionProgressFill.style.width = `${progressPercent}%`;

  drawQuestionCanvas(question.text);

  optionsList.innerHTML = '';

  if (question.type === 'multiple') {
    const currentAnswers = Array.isArray(userAnswers[question.id]) ? userAnswers[question.id] : [];
    (question.options || []).forEach((optText, optIdx) => {
      const item = document.createElement('div');
      const isSelected = currentAnswers.includes(optIdx);
      item.className = 'option-item multi-choice' + (isSelected ? ' selected' : '');

      item.innerHTML = `
        <div class="option-indicator">
          <div class="option-indicator-inner">${isSelected ? '✓' : ''}</div>
        </div>
        <div class="option-text">${escapeHtml(optText)}</div>
      `;

      item.addEventListener('click', () => {
        let cur = Array.isArray(userAnswers[question.id]) ? [...userAnswers[question.id]] : [];
        if (cur.includes(optIdx)) {
          cur = cur.filter(i => i !== optIdx);
          item.classList.remove('selected');
          const check = item.querySelector('.option-indicator-inner');
          if (check) check.textContent = '';
        } else {
          cur.push(optIdx);
          item.classList.add('selected');
          const check = item.querySelector('.option-indicator-inner');
          if (check) check.textContent = '✓';
        }
        userAnswers[question.id] = cur.sort((a, b) => a - b);
        persistLocalSession();
        renderNavPills();
      });

      optionsList.appendChild(item);
    });
  } else if (question.type === 'matching') {
    const layout = document.createElement('div');
    layout.className = 'matching-layout';

    const leftItems = Array.isArray(question.matchingLeft) ? question.matchingLeft : [];
    const rightItems = Array.isArray(question.matchingRight) ? question.matchingRight : [];
    const userMap = (userAnswers[question.id] && typeof userAnswers[question.id] === 'object') ? userAnswers[question.id] : {};

    leftItems.forEach((leftText, leftIdx) => {
      const row = document.createElement('div');
      row.className = 'matching-pair-row';

      const leftEl = document.createElement('div');
      leftEl.className = 'matching-pair-left';
      leftEl.innerHTML = `<strong>${leftIdx + 1}.</strong> ${escapeHtml(leftText)}`;

      const arrow = document.createElement('div');
      arrow.className = 'matching-pair-arrow';
      arrow.textContent = '➔';

      const select = document.createElement('select');
      select.className = 'matching-pair-select';
      select.innerHTML = '<option value="">-- Оберіть відповідник --</option>';

      rightItems.forEach((rightText, rightIdx) => {
        const opt = document.createElement('option');
        opt.value = rightIdx;
        opt.textContent = `${String.fromCharCode(65 + rightIdx)}) ${rightText}`;
        if (String(userMap[leftIdx]) === String(rightIdx)) {
          opt.selected = true;
        }
        select.appendChild(opt);
      });

      select.addEventListener('change', () => {
        if (!userAnswers[question.id] || typeof userAnswers[question.id] !== 'object') {
          userAnswers[question.id] = {};
        }
        if (select.value === '') {
          delete userAnswers[question.id][leftIdx];
        } else {
          userAnswers[question.id][leftIdx] = parseInt(select.value, 10);
        }
        persistLocalSession();
        renderNavPills();
      });

      row.appendChild(leftEl);
      row.appendChild(arrow);
      row.appendChild(select);
      layout.appendChild(row);
    });
    optionsList.appendChild(layout);
  } else if (question.type === 'ordering') {
    const layout = document.createElement('div');
    layout.className = 'ordering-layout';

    let currentOrder = Array.isArray(userAnswers[question.id]) ? [...userAnswers[question.id]] : (Array.isArray(question.options) ? [...question.options] : []);
    if (!userAnswers[question.id]) {
      userAnswers[question.id] = [...currentOrder];
    }

    currentOrder.forEach((itemText, itIdx) => {
      const card = document.createElement('div');
      card.className = 'ordering-card-item';

      card.innerHTML = `
        <div class="ordering-item-index">${itIdx + 1}</div>
        <div class="ordering-item-text">${escapeHtml(itemText)}</div>
        <div class="ordering-actions">
          <button type="button" class="ordering-move-btn" data-dir="up" ${itIdx === 0 ? 'disabled' : ''} title="Підняти вище">↑</button>
          <button type="button" class="ordering-move-btn" data-dir="down" ${itIdx === currentOrder.length - 1 ? 'disabled' : ''} title="Опустити нижче">↓</button>
        </div>
      `;

      const upBtn = card.querySelector('[data-dir="up"]');
      const downBtn = card.querySelector('[data-dir="down"]');

      if (upBtn) {
        upBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (itIdx > 0) {
            const temp = currentOrder[itIdx];
            currentOrder[itIdx] = currentOrder[itIdx - 1];
            currentOrder[itIdx - 1] = temp;
            userAnswers[question.id] = [...currentOrder];
            persistLocalSession();
            renderQuestion(currentQuestionIndex);
            renderNavPills();
          }
        });
      }

      if (downBtn) {
        downBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (itIdx < currentOrder.length - 1) {
            const temp = currentOrder[itIdx];
            currentOrder[itIdx] = currentOrder[itIdx + 1];
            currentOrder[itIdx + 1] = temp;
            userAnswers[question.id] = [...currentOrder];
            persistLocalSession();
            renderQuestion(currentQuestionIndex);
            renderNavPills();
          }
        });
      }

      layout.appendChild(card);
    });
    optionsList.appendChild(layout);
  } else {
    (question.options || []).forEach((optText, optIdx) => {
      const item = document.createElement('div');
      const isSelected = userAnswers[question.id] === optIdx;
      item.className = 'option-item' + (isSelected ? ' selected' : '');

      item.innerHTML = `
        <div class="option-indicator">
          <div class="option-indicator-inner"></div>
        </div>
        <div class="option-text">${escapeHtml(optText)}</div>
      `;

      item.addEventListener('click', () => {
        userAnswers[question.id] = optIdx;
        persistLocalSession();
        optionsList.querySelectorAll('.option-item').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
        renderNavPills();
      });

      optionsList.appendChild(item);
    });
  }

  prevQuestionBtn.disabled = index === 0;
  if (index === currentTest.questions.length - 1) {
    nextQuestionBtn.classList.add('hidden');
    submitTestBtn.classList.remove('hidden');
  } else {
    nextQuestionBtn.classList.remove('hidden');
    submitTestBtn.classList.add('hidden');
  }

  renderNavPills();
}

function drawQuestionCanvas(text) {
  if (!questionCanvas || !text) return;
  try {
    const dpr = window.devicePixelRatio || 1;
    const parent = questionCanvas.parentElement;
    const parentW = parent ? parent.clientWidth : 0;
    const containerWidth = Math.max(280, parentW || window.innerWidth - 64 || 320);

    const fontSize = isMobile ? 15 : 17;
    const lineHeight = Math.round(fontSize * 1.45);

    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.font = `600 ${fontSize}px Inter, -apple-system, sans-serif`;

    const words = text.split(' ');
    const lines = [];
    let currentLine = words[0] || '';

    const maxTextWidth = containerWidth - 20;
    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      const width = tempCtx.measureText(currentLine + ' ' + word).width;
      if (width < maxTextWidth) {
        currentLine += ' ' + word;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
    lines.push(currentLine);

    const padY = 6;
    const canvasHeight = lines.length * lineHeight + padY * 2;

    questionCanvas.width = Math.round(containerWidth * dpr);
    questionCanvas.height = Math.round(canvasHeight * dpr);
    questionCanvas.style.width = `${containerWidth}px`;
    questionCanvas.style.height = `${canvasHeight}px`;

    const ctx = questionCanvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, containerWidth, canvasHeight);

    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#0d0f1a';
    ctx.fillStyle = textColor;
    ctx.font = `600 ${fontSize}px Inter, -apple-system, sans-serif`;
    ctx.textBaseline = 'top';

    lines.forEach((line, idx) => {
      ctx.fillText(line, 4, padY + idx * lineHeight);
    });
  } catch (err) {
    console.error('Canvas draw error:', err);
  }
}

window.addEventListener('resize', () => {
  if (currentTest && currentTest.questions && currentTest.questions[currentQuestionIndex]) {
    drawQuestionCanvas(currentTest.questions[currentQuestionIndex].text);
  }
});

prevQuestionBtn.addEventListener('click', () => {
  if (currentQuestionIndex > 0) {
    renderQuestion(currentQuestionIndex - 1, 'left');
  }
});

nextQuestionBtn.addEventListener('click', () => {
  if (currentQuestionIndex < currentTest.questions.length - 1) {
    renderQuestion(currentQuestionIndex + 1, 'right');
  }
});

(function initSwipe() {
  let touchStartX = 0;
  let touchStartY = 0;
  const swipeArea = document.getElementById('testScreen');
  if (!swipeArea) return;
  swipeArea.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  swipeArea.addEventListener('touchend', e => {
    if (!currentTest || !currentTest.questions) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx) * 0.8) return;
    if (dx < 0 && currentQuestionIndex < currentTest.questions.length - 1) {
      renderQuestion(currentQuestionIndex + 1, 'right');
    } else if (dx > 0 && currentQuestionIndex > 0) {
      renderQuestion(currentQuestionIndex - 1, 'left');
    }
  }, { passive: true });
})();

function openSummaryModal() {
  if (!summarySubmitModal) {
    submitTest();
    return;
  }

  const unanswered = getUnansweredQuestions();
  const totalCount = currentTest && currentTest.questions ? currentTest.questions.length : 0;

  if (unanswered.length > 0) {
    if (summaryModalIcon) {
      summaryModalIcon.className = 'modal-icon-wrap warning';
      summaryModalIcon.innerHTML = '<img src="/img/icons/warning.svg" class="pixel-icon large" alt="">';
    }
    if (summaryModalTitle) {
      summaryModalTitle.textContent = 'Залишилися питання без відповіді';
    }

    const count = unanswered.length;
    let word = 'питань';
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) {
      word = 'питання';
    } else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
      word = 'питання';
    }

    const numbersList = unanswered.map(u => `№${u.number}`).join(', ');
    if (summaryModalMessage) {
      summaryModalMessage.textContent = `У вас залишилося ${count} ${word} без відповіді (${numbersList}). Ви впевнені?`;
    }

    if (summaryModalPillsWrap) {
      summaryModalPillsWrap.innerHTML = '';
      summaryModalPillsWrap.classList.remove('hidden');

      unanswered.forEach(u => {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'summary-pill-btn';
        pill.innerHTML = `<span>№${u.number}</span> <span style="opacity:0.7;">➔</span>`;
        pill.title = `Перейти до питання №${u.number}`;
        pill.addEventListener('click', () => {
          closeSummaryModal();
          renderQuestion(u.index);
        });
        summaryModalPillsWrap.appendChild(pill);
      });
    }

    if (summaryBackBtn) {
      summaryBackBtn.textContent = 'Повернутися до тесту';
    }
    if (summaryConfirmBtn) {
      summaryConfirmBtn.textContent = 'Все одно завершити';
      summaryConfirmBtn.className = 'btn-primary danger';
    }
  } else {
    if (summaryModalIcon) {
      summaryModalIcon.className = 'modal-icon-wrap success';
      summaryModalIcon.innerHTML = '<img src="/img/icons/check.svg" class="pixel-icon large" alt="">';
    }
    if (summaryModalTitle) {
      summaryModalTitle.textContent = 'Завершення тестування';
    }
    if (summaryModalMessage) {
      summaryModalMessage.textContent = `Ви відповіли на всі питання (${totalCount} з ${totalCount}). Бажаєте надіслати роботу на перевірку?`;
    }
    if (summaryModalPillsWrap) {
      summaryModalPillsWrap.innerHTML = '';
      summaryModalPillsWrap.classList.add('hidden');
    }
    if (summaryBackBtn) {
      summaryBackBtn.textContent = 'Перевірити ще раз';
    }
    if (summaryConfirmBtn) {
      summaryConfirmBtn.textContent = 'Здати тест';
      summaryConfirmBtn.className = 'btn-primary success';
    }
  }

  summarySubmitModal.classList.remove('hidden');
}

function closeSummaryModal() {
  if (summarySubmitModal) {
    summarySubmitModal.classList.add('hidden');
  }
  if (proctor) {
    proctor.isCompleted = false;
  }
}

if (summaryBackBtn) {
  summaryBackBtn.addEventListener('click', () => {
    closeSummaryModal();
  });
}

if (summaryConfirmBtn) {
  summaryConfirmBtn.addEventListener('click', () => {
    closeSummaryModal();
    submitTest();
  });
}

if (summarySubmitModal) {
  summarySubmitModal.addEventListener('click', (e) => {
    if (e.target === summarySubmitModal) {
      closeSummaryModal();
    }
  });
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && summarySubmitModal && !summarySubmitModal.classList.contains('hidden')) {
    closeSummaryModal();
  }
});

submitTestBtn.addEventListener('click', () => {
  if (proctor) proctor.isCompleted = true;
  openSummaryModal();
});

async function submitTest() {
  if (testTimer) clearInterval(testTimer);
  submitTestBtn.disabled = true;
  submitTestBtn.textContent = 'Обробка результатів...';

  if (proctor) {
    proctor.isCompleted = true;
    proctor.options.onWarning(null);
  }

  if (currentTest && currentTest.questions && currentTest.questions[currentQuestionIndex]) {
    const prevQId = currentTest.questions[currentQuestionIndex].id;
    const elapsed = Math.max(1, Math.round((Date.now() - currentQuestionStartTime) / 1000));
    questionTimings[prevQId] = (questionTimings[prevQId] || 0) + elapsed;
  }

  const answersToSend = { ...userAnswers };
  const timingsToSend = { ...questionTimings };
  const questionsSnapshot = (currentTest && currentTest.questions) ? [...currentTest.questions] : [];
  userAnswers = {};

  try {
    const response = await fetch('/api/sessions/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: currentSession.id,
        answers: answersToSend,
        questionTimings: timingsToSend
      })
    });

    const result = await response.json();
    localStorage.removeItem('secure_exam_active_session');
    if (proctor) proctor.destroy();

    showResults(result, questionsSnapshot, timingsToSend);
  } catch (err) {
    console.error(err);
    alert('Помилка надсилання: ' + err.message);
  }
}

function updateTrustScore(newScore) {
  trustScore = Math.max(0, Math.min(100, newScore));
  if (trustScoreNumber) trustScoreNumber.textContent = `${trustScore}%`;

  const circumference = 113.1;
  const offset = circumference - (trustScore / 100) * circumference;
  if (trustScoreCircle) trustScoreCircle.style.strokeDashoffset = offset;

  if (trustScoreCircle && trustStatusText) {
    if (trustScore >= 70) {
      trustScoreCircle.style.stroke = 'var(--accent-green)';
      trustStatusText.style.color = 'var(--accent-green)';
      trustStatusText.textContent = 'Висока доброчесність';
    } else if (trustScore >= 40) {
      trustScoreCircle.style.stroke = 'var(--accent-amber)';
      trustStatusText.style.color = 'var(--accent-amber)';
      trustStatusText.textContent = 'Підозріла активність';
    } else {
      trustScoreCircle.style.stroke = 'var(--accent-red)';
      trustStatusText.style.color = 'var(--accent-red)';
      trustStatusText.textContent = 'Критичні порушення';
    }
  }
}

function showWarningModal(warningData) {
  if (isDebugMode || (proctor && proctor.isBypassed)) {
    closeWarningModal();
    return;
  }
  warningTitle.textContent = warningData.title || 'Попередження';
  warningMessage.textContent = warningData.message || '';

  if (warningData.isCountdown) {
    warningCountdown.classList.remove('hidden');
    let remaining = warningData.countdownSeconds || 15;
    warningCountdown.textContent = `${remaining} сек`;

    warningActionBtn.classList.remove('hidden');
    warningActionBtn.textContent = 'Повернутися в повноекранний режим';
    warningActionBtn.onclick = () => {
      if (warningData.onRestore) warningData.onRestore();
    };
  } else {
    warningCountdown.classList.add('hidden');
    warningActionBtn.classList.remove('hidden');
    warningActionBtn.textContent = 'Зрозуміло, продовжую тест';
    warningActionBtn.onclick = closeWarningModal;
  }

  warningModal.classList.remove('hidden');
}

function closeWarningModal() {
  warningModal.classList.add('hidden');
}

function showFatalOverlay(reason) {
  if (isDebugMode || (proctor && proctor.isBypassed)) {
    hideFatalOverlay();
    return;
  }
  if (document.getElementById('fatalViolationOverlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'fatalViolationOverlay';
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:2147483646',
    'background:rgba(15,23,42,0.97)', 'color:#fff',
    'display:flex', 'flex-direction:column',
    'align-items:center', 'justify-content:center',
    'padding:32px', 'text-align:center', 'box-sizing:border-box'
  ].join(';');

  overlay.innerHTML = `
    <div style="margin-bottom:12px;"><img src="/img/icons/blocked.svg" class="pixel-icon large" alt="" style="width:48px;height:48px;"></div>
    <h2 style="font-size:18px;font-weight:700;color:#ef4444;margin:0 0 10px;">${reason || 'Тест анульовано через порушення'}</h2>
    <p style="font-size:13px;color:#94a3b8;max-width:400px;line-height:1.6;margin:0 0 20px;">
      Ваші відповіді збережено. Зверніться до викладача — він може відновити ваш тест без перезавантаження сторінки.
    </p>
    <div style="display:inline-flex;align-items:center;gap:8px;font-size:12px;color:#64748b;border:1px solid rgba(100,116,139,0.3);border-radius:6px;padding:8px 16px;">
      <img src="/img/icons/hourglass.svg" class="pixel-icon inline" alt=""> Очікуйте дій викладача...
    </div>
  `;
  document.body.appendChild(overlay);
}

function hideFatalOverlay() {
  const el = document.getElementById('fatalViolationOverlay');
  if (el) el.remove();
}

function showResults(result, questionsSnapshot = [], timings = {}) {
  testScreen.classList.add('hidden');
  resultScreen.classList.remove('hidden');

  document.getElementById('resultStudentName').textContent = currentSession.studentName;
  const s12 = result.score12 !== undefined ? result.score12 : (result.totalQuestions > 0 ? Math.min(12, Math.max(1, Math.round((result.rawScore / result.totalQuestions) * 12))) : 1);
  const score12El = document.getElementById('resultScore12');
  const trustEl = document.getElementById('resultTrustScore');

  function animateCounter(el, from, to, suffix, duration = 800) {
    if (!el) return;
    const start = performance.now();
    el.classList.add('result-count-anim');
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const val = Math.round(from + (to - from) * eased);
      el.textContent = val + suffix;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  animateCounter(score12El, 0, s12, ' / 12');
  animateCounter(trustEl, 0, result.trustScore, '%');
  document.getElementById('resultScorePercent').textContent = `(${result.scorePercentage}%)`;
  document.getElementById('resultRawScore').textContent = `${result.rawScore} з ${result.totalQuestions} правильних`;

  if (s12 >= 10) {
    const colors = ['#6366f1','#a78bfa','#f472b6','#34d399','#fbbf24','#60a5fa'];
    for (let i = 0; i < 80; i++) {
      setTimeout(() => {
        const p = document.createElement('div');
        p.className = 'confetti-piece';
        p.style.left = Math.random() * 100 + 'vw';
        p.style.top = '-12px';
        p.style.background = colors[Math.floor(Math.random() * colors.length)];
        p.style.animationDuration = (1.8 + Math.random() * 2) + 's';
        p.style.animationDelay = '0s';
        p.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
        document.body.appendChild(p);
        setTimeout(() => p.remove(), 4000);
      }, i * 35);
    }
  }

  const verdictBadge = document.getElementById('resultVerdictBadge');
  const verdictReason = document.getElementById('resultVerdictReason');

  if (result.finalVerdict) {
    verdictReason.textContent = result.finalVerdict.reason;
    if (result.finalVerdict.decision === 'ANNULLED_SPLIT_SCREEN') {
      verdictBadge.className = 'tag-badge danger';
      verdictBadge.textContent = 'Анульовано (Split Screen)';
    } else if (result.finalVerdict.decision === 'PERFECT_INTEGRITY') {
      verdictBadge.className = 'tag-badge approved';
      verdictBadge.textContent = '100% Доброчесність';
    } else if (result.finalVerdict.decision === 'APPROVED_WITH_NETWORK_NOTICES') {
      verdictBadge.className = 'tag-badge approved';
      verdictBadge.textContent = 'Схвалено (мережеві перебої)';
    } else if (result.finalVerdict.decision === 'REVIEW_REQUIRED') {
      verdictBadge.className = 'tag-badge warning';
      verdictBadge.textContent = 'Потребує перевірки';
    } else {
      verdictBadge.className = 'tag-badge danger';
      verdictBadge.textContent = 'Анульовано / Списування';
    }
  }

  const questionsListEl = document.getElementById('resultQuestionsList');
  if (questionsListEl) {
    questionsListEl.innerHTML = '';
    const qList = (questionsSnapshot && questionsSnapshot.length > 0) ? questionsSnapshot : (currentSession && currentSession.questions ? currentSession.questions : []);
    const wrongAnswers = result.wrongAnswers || {};
    const mistakes = qList
      .map((q, idx) => ({ q, idx, ansInfo: wrongAnswers[q.id] }))
      .filter(item => item.ansInfo);
    const mistakeCountBadge = document.getElementById('resultMistakeCount');

    if (!result.answerReviewAvailable) {
      const message = document.createElement('div');
      message.className = 'result-review-empty';
      message.textContent = 'Перегляд помилок недоступний для цієї сесії.';
      questionsListEl.appendChild(message);
      if (mistakeCountBadge) mistakeCountBadge.textContent = 'Перевірка недоступна';
    } else if (mistakes.length === 0) {
      const message = document.createElement('div');
      message.className = 'result-review-empty result-review-success';
      message.textContent = 'Помилок немає — ви відповіли правильно на всі питання.';
      questionsListEl.appendChild(message);
      if (mistakeCountBadge) mistakeCountBadge.textContent = `Помилок: 0 з ${qList.length}`;
    }

    mistakes.forEach(({ q, idx, ansInfo }) => {
      const qTime = ansInfo.timeSpent || timings[q.id] || 0;
      const isCorrect = false;
      let userChoiceText = 'Не відповіли';
      let correctChoiceText = '';

      if (q.type === 'multiple') {
        const uArr = Array.isArray(ansInfo?.userAnswer) ? ansInfo.userAnswer : [];
        const cArr = Array.isArray(ansInfo?.correctAnswer) ? ansInfo.correctAnswer : [];
        if (uArr.length > 0) {
          userChoiceText = uArr.map(i => (q.options && q.options[i]) ? q.options[i] : `#${i + 1}`).join('; ');
        }
        if (cArr.length > 0) {
          correctChoiceText = cArr.map(i => (q.options && q.options[i]) ? q.options[i] : `#${i + 1}`).join('; ');
        }
      } else if (q.type === 'matching') {
        const uMap = (ansInfo?.userAnswer && typeof ansInfo.userAnswer === 'object') ? ansInfo.userAnswer : {};
        const cMap = (ansInfo?.correctAnswer && typeof ansInfo.correctAnswer === 'object') ? ansInfo.correctAnswer : {};
        const leftArr = q.matchingLeft || [];
        const rightArr = q.matchingRight || [];
        const uKeys = Object.keys(uMap);
        if (uKeys.length > 0) {
          userChoiceText = uKeys.map(k => `${leftArr[k] || k} ➔ ${rightArr[uMap[k]] || uMap[k]}`).join(' | ');
        }
        const cKeys = Object.keys(cMap);
        if (cKeys.length > 0) {
          correctChoiceText = cKeys.map(k => `${leftArr[k] || k} ➔ ${rightArr[cMap[k]] || cMap[k]}`).join(' | ');
        }
      } else if (q.type === 'ordering') {
        const uArr = Array.isArray(ansInfo?.userAnswer) ? ansInfo.userAnswer : [];
        const cArr = Array.isArray(ansInfo?.correctAnswer) ? ansInfo.correctAnswer : [];
        if (uArr.length > 0) {
          userChoiceText = uArr.join(' ➔ ');
        }
        if (cArr.length > 0) {
          correctChoiceText = cArr.join(' ➔ ');
        }
      } else {
        const userChoiceIdx = ansInfo ? ansInfo.userAnswer : undefined;
        if (userChoiceIdx !== undefined && q.options && q.options[userChoiceIdx] !== undefined) {
          userChoiceText = q.options[userChoiceIdx];
        }
        const cIdx = ansInfo?.correctAnswer !== undefined ? ansInfo.correctAnswer : q.correct;
        if (q.options && q.options[cIdx] !== undefined) {
          correctChoiceText = q.options[cIdx];
        }
      }

      const card = document.createElement('div');
      card.style.cssText = 'background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 12px 14px;';
      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 6px;">
          <div style="font-size: 13px; font-weight: 700; color: var(--text);">#${idx + 1}. ${escapeHtml(q.text)}</div>
          <span class="tag-badge ${isCorrect ? 'approved' : 'danger'}" style="font-size: 10px; padding: 2px 8px; flex-shrink: 0;">${isCorrect ? '✓ Правильно' : '✗ Помилка'}</span>
        </div>
        <div style="font-size: 12px; color: var(--text-muted); display: flex; flex-direction: column; gap: 4px;">
          <div style="display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px;">
            <span>Ваша відповідь: <strong style="color: ${isCorrect ? 'var(--accent-green)' : 'var(--accent-red)'};">${escapeHtml(userChoiceText)}</strong></span>
            <span style="display: inline-flex; align-items: center; gap: 4px;"><img src="/img/icons/timer.svg" class="pixel-icon inline" alt=""> ${qTime} сек</span>
          </div>
          ${!isCorrect && correctChoiceText ? `<div style="font-size: 11px; color: var(--accent-green);">Правильна відповідь: <strong>${escapeHtml(correctChoiceText)}</strong></div>` : ''}
        </div>
      `;
      questionsListEl.appendChild(card);
    });

    if (mistakeCountBadge && mistakes.length > 0 && result.answerReviewAvailable) {
      mistakeCountBadge.textContent = `Помилок: ${mistakes.length} з ${qList.length}`;
    }
  }

  loadLeaderboardUI(currentSession.testId || selectedTestId, currentSession.id);

  const incidentsListEl = document.getElementById('resultIncidentsList');
  incidentsListEl.innerHTML = '';

  if (recordedIncidents.length === 0) {
    incidentsListEl.innerHTML = '<div style="color: var(--text-dim); font-size: 13px;">Жодних підозрілих інцидентів або перебоїв зв\'язку не виявлено.</div>';
  } else {
    recordedIncidents.forEach((inc) => {
      const item = document.createElement('div');
      item.className = 'timeline-item';
      const isCheat = inc.category === 'cheating_attempt' || inc.category === 'devtools_opened';
      const icon = isCheat
        ? '<img src="/img/icons/warning.svg" class="pixel-icon" alt="">'
        : (inc.category === 'network_issue'
          ? '<img src="/img/icons/signal.svg" class="pixel-icon" alt="">'
          : '<img src="/img/icons/info.svg" class="pixel-icon" alt="">');

      item.innerHTML = `
        <div class="timeline-icon">${icon}</div>
        <div class="timeline-details">
          <div class="timeline-header">
            <span class="timeline-name">${inc.message}</span>
            <span class="timeline-time">${new Date(inc.timestamp).toLocaleTimeString()}</span>
          </div>
          <div class="timeline-text">
            ${inc.networkState ? `Мережа: ${inc.networkState.online ? 'Онлайн' : 'Офлайн'} (пінг: ${inc.networkState.latency || 0} ms)` : ''}
            ${inc.penalty ? ` | Штраф: -${inc.penalty}%` : ''}
          </div>
        </div>
      `;
      incidentsListEl.appendChild(item);
    });
  }
}

async function loadLeaderboardUI(testId, mySessionId) {
  const tbody = document.getElementById('resultLeaderboardTbody');
  const rankBadge = document.getElementById('resultLeaderboardRankBadge');
  if (!tbody) return;

  try {
    const res = await fetch(`/api/leaderboard?testId=${encodeURIComponent(testId)}`);
    if (!res.ok) throw new Error('Помилка завантаження рейтингу');
    const leaders = await res.json();

    if (!leaders || leaders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-dim); padding: 16px;">Результатів у рейтингу ще немає.</td></tr>';
      return;
    }

    const classFilterEl = document.getElementById('resultLeaderboardClassFilter');
    const sortEl = document.getElementById('resultLeaderboardSortSelect');

    const classes = [...new Set(leaders.map(i => i.studentId).filter(Boolean))].sort();
    if (classFilterEl) {
      const prev = classFilterEl.value;
      classFilterEl.innerHTML = '<option value="">Усі класи</option>';
      classes.forEach(cls => {
        const opt = document.createElement('option');
        opt.value = cls;
        opt.textContent = cls;
        if (cls === prev) opt.selected = true;
        classFilterEl.appendChild(opt);
      });
    }

    function renderLeaderboard() {
      const classVal = classFilterEl ? classFilterEl.value : '';
      const sortVal = sortEl ? sortEl.value : 'rank_asc';

      let list = leaders.slice();
      if (classVal) {
        list = list.filter(i => i.studentId === classVal);
      }

      if (sortVal === 'class_asc') {
        list.sort((a, b) => (a.studentId || '').localeCompare(b.studentId || ''));
      } else if (sortVal === 'class_desc') {
        list.sort((a, b) => (b.studentId || '').localeCompare(a.studentId || ''));
      } else {
        list.sort((a, b) => a.rank - b.rank);
      }

      if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-dim); padding: 16px;">Немає записів для обраного класу.</td></tr>';
        if (rankBadge) rankBadge.textContent = 'Ваше місце: —';
        return;
      }

      tbody.innerHTML = '';
      let myRank = null;

      list.forEach((item, idx) => {
        const isMe = item.sessionId === mySessionId;
        if (isMe) myRank = idx + 1;

        const tr = document.createElement('tr');
        if (isMe) {
          tr.style.background = 'rgba(99, 102, 241, 0.14)';
          tr.style.fontWeight = '700';
        }

        let medal = `#${idx + 1}`;
        if (idx === 0) medal = '<img src="/img/icons/medal-gold.svg" class="pixel-icon inline" alt=""> 1';
        else if (idx === 1) medal = '<img src="/img/icons/medal-silver.svg" class="pixel-icon inline" alt=""> 2';
        else if (idx === 2) medal = '<img src="/img/icons/medal-bronze.svg" class="pixel-icon inline" alt=""> 3';

        const mins = Math.floor(item.durationSeconds / 60);
        const secs = item.durationSeconds % 60;
        const durStr = `${mins > 0 ? `${mins} хв ` : ''}${secs} с`;

        tr.innerHTML = `
          <td style="text-align: center; font-weight: 700;">${medal}</td>
          <td>${escapeHtml(item.studentName)}${isMe ? ' <span class="tag-badge approved" style="font-size: 9px; padding: 1px 5px;">Ви</span>' : ''}</td>
          <td>${escapeHtml(item.studentId || '—')}</td>
          <td style="color: var(--accent-blue); font-weight: 800;">${item.score12} / 12</td>
          <td>${item.rawScore}/${item.totalQuestions} (${item.scorePercentage}%)</td>
          <td><span class="tag-badge ${item.trustScore >= 70 ? 'approved' : 'warning'}" style="font-size: 10px;">${item.trustScore}%</span></td>
          <td style="color: var(--text-muted);">${durStr}</td>
        `;
        tbody.appendChild(tr);
      });

      if (rankBadge) {
        if (myRank) {
          rankBadge.textContent = `Ваше місце: #${myRank} з ${list.length}`;
        } else {
          rankBadge.textContent = `Усього учасників: ${list.length}`;
        }
      }
    }

    renderLeaderboard();

    if (classFilterEl) classFilterEl.addEventListener('change', renderLeaderboard);
    if (sortEl) sortEl.addEventListener('change', renderLeaderboard);

    const thName = document.getElementById('thStudentLeadName');
    const thClass = document.getElementById('thStudentLeadClass');
    const thScore = document.getElementById('thStudentLeadScore');

    if (thName) thName.onclick = () => { if (sortEl) { sortEl.value = 'rank_asc'; renderLeaderboard(); } };
    if (thClass) thClass.onclick = () => {
      if (sortEl) {
        sortEl.value = sortEl.value === 'class_asc' ? 'class_desc' : 'class_asc';
        renderLeaderboard();
      }
    };
    if (thScore) thScore.onclick = () => { if (sortEl) { sortEl.value = 'rank_asc'; renderLeaderboard(); } };

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--accent-red); padding: 16px;">Помилка: ${err.message}</td></tr>`;
  }
}

function escapeHtml(text) {

  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}
