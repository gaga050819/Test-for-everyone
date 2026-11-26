const defaultSampleTest = {
  id: 'test_sample_studio_01',
  name: 'Географія 10 клас: Загальна характеристика Азії',
  subject: 'Географія',
  topic: 'Загальна характеристика Азії',
  durationMinutes: 15,
  questions: [
    {
      id: 'q1',
      text: 'Яка країна Азії є світовим лідером за чисельністю населення станом на сьогодні?',
      type: 'single',
      options: ['Японія', 'Китай', 'Індія', 'Індонезія'],
      correct: 2,
      points: 1,
      timeLimit: 60,
      imageUrl: '',
      explanation: 'За даними ООН, Індія випередила Китай за кількістю населення, перетнувши позначку 1.43 млрд жителів.'
    },
    {
      id: 'q2',
      text: 'Оберіть країни, які належать до регіону Східної Азії:',
      type: 'multiple',
      options: ['Японія', 'Індія', 'Південна Корея', 'В\'єтнам', 'Монголія'],
      correct: [0, 2, 4],
      points: 2,
      timeLimit: 75,
      imageUrl: '',
      explanation: 'До Східної Азії географічно належать Китай, Японія, КНДР, Південна Корея та Монголія.'
    },
    {
      id: 'q3',
      text: 'Найглибшим прісноводним озером Азії та всієї планети є озеро [Байкал], а найвищою гірською вершиною — [Еверест|Джомолунгма].',
      type: 'fill_blanks',
      options: [],
      correct: ['Байкал', 'Еверест'],
      points: 2,
      timeLimit: 90,
      imageUrl: '',
      explanation: 'Байкал має максимальну глибину 1642 м, а висота вершини Еверест становить 8848.86 м.'
    },
    {
      id: 'q4',
      text: 'Встановіть логічну відповідність між країною Азії та її столицею:',
      type: 'matching',
      matchingPairs: [
        { left: 'Японія', right: 'Токіо' },
        { left: 'Південна Корея', right: 'Сеул' },
        { left: 'Китай', right: 'Пекін' },
        { left: 'Казахстан', right: 'Астана' }
      ],
      points: 4,
      timeLimit: 120,
      imageUrl: '',
      explanation: 'Токіо — столиця Японії, Сеул — Республіки Корея, Пекін — КНР, Астана — Казахстану.'
    },
    {
      id: 'q5',
      text: 'Велика частина території півострова Аравія зайнята посушливими тропічними пустелями.',
      type: 'true_false',
      options: ['Неправда', 'Правда'],
      correct: 1,
      points: 1,
      timeLimit: 45,
      imageUrl: '',
      explanation: 'Близько 95% Аравійського півострова займають пустелі Руб-ель-Халі, Великий Нефуд та пустельні плато.'
    }
  ]
};

let currentTest = null;
let activeQuestionIndex = 0;
let draggedQuestionIndex = null;
let draggedOptionIndex = null;
let undoStack = [];
let aiChatHistory = [];

function loadTestIntoStudio(testData) {
  if (!testData) return;
  const prevId = currentTest?.id;
  currentTest = {
    id: testData.id || ('test_' + Date.now()),
    name: testData.title || testData.name || 'Новий тест',
    title: testData.title || testData.name || 'Новий тест',
    subject: testData.subject || 'Географія',
    topic: testData.topic || '',
    class: testData.class || '10-А',
    durationMinutes: parseInt(testData.durationMinutes, 10) || 15,
    questions: Array.isArray(testData.questions) ? JSON.parse(JSON.stringify(testData.questions)) : []
  };
  currentTest.questions.forEach((q, idx) => {
    if (!q.id) q.id = 'q_' + (idx + 1);
    if (!q.type) q.type = 'single';
    if (q.timeLimitSeconds && !q.timeLimit) q.timeLimit = q.timeLimitSeconds;
    if (!q.timeLimit) q.timeLimit = 60;
    if (q.points === undefined) q.points = 1;
    if (!q.options) q.options = [];
  });

  if (prevId && prevId !== currentTest.id) {
    aiChatHistory = [];
  }
  activeQuestionIndex = 0;
  undoStack = [];
  updateUndoButtonState();

  syncMetaHeader();
  renderQuestionsNav();
  if (currentTest.questions.length > 0) {
    loadQuestionIntoEditor(0);
  } else {
    renderEmptyEditorState();
  }
  updateTestAnalytics();
  updateLivePreview();
}
window.loadTestIntoStudio = loadTestIntoStudio;

function init() {
  if (window.currentAdminTest) {
    loadTestIntoStudio(window.currentAdminTest);
  } else {
    const saved = localStorage.getItem('test_studio_draft');
    if (saved) {
      try {
        currentTest = JSON.parse(saved);
      } catch {
        currentTest = JSON.parse(JSON.stringify(defaultSampleTest));
      }
    } else {
      currentTest = JSON.parse(JSON.stringify(defaultSampleTest));
    }
  }

  initUndoSystem();

  syncMetaHeader();
  bindMetaInputs();
  bindActionButtons();
  bindEditorInputs();
  bindAiSmartTools();
  bindAiChatSidebar();
  bindMassImportModal();
  bindAiGeneratorModal();
  bindDeviceSwitcher();
  bindFullPreviewModal();
  bindPrintExportModal();
  bindTutorialTour();

  renderQuestionsNav();
  if (currentTest && currentTest.questions && currentTest.questions.length > 0) {
    loadQuestionIntoEditor(0);
  } else {
    renderEmptyEditorState();
  }
  updateTestAnalytics();
}

function initUndoSystem() {
  const undoBtn = document.getElementById('undoActionBtn');
  if (undoBtn) {
    undoBtn.addEventListener('click', undoAction);
  }
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z' || e.key === 'я' || e.key === 'Я') && !e.shiftKey) {
      if (undoStack.length > 0) {
        e.preventDefault();
        undoAction();
      }
    }
  });
}

function recordUndoSnapshot() {
  if (!currentTest) return;
  const snapshot = {
    test: JSON.parse(JSON.stringify(currentTest)),
    index: activeQuestionIndex
  };
  undoStack.push(snapshot);
  if (undoStack.length > 30) undoStack.shift();
  updateUndoButtonState();
}

function updateUndoButtonState() {
  const undoBtn = document.getElementById('undoActionBtn');
  if (undoBtn) {
    undoBtn.disabled = undoStack.length === 0;
    undoBtn.style.opacity = undoStack.length === 0 ? '0.5' : '1';
    undoBtn.style.cursor = undoStack.length === 0 ? 'not-allowed' : 'pointer';
  }
}

function undoAction() {
  if (undoStack.length === 0) return;
  const prev = undoStack.pop();
  currentTest = JSON.parse(JSON.stringify(prev.test));
  activeQuestionIndex = Math.min(prev.index, Math.max(0, currentTest.questions.length - 1));

  syncMetaHeader();
  renderQuestionsNav();
  loadQuestionIntoEditor(activeQuestionIndex);
  updateTestAnalytics();
  saveDraftToStorage();
  updateUndoButtonState();
  showToast('Дію скасовано (Відмінено)');
}

function syncMetaHeader() {
  const titleInput = document.getElementById('editTestTitleInput');
  const topicInput = document.getElementById('editTestTopicInput');
  const subjectInput = document.getElementById('editTestSubjectInput');
  const durationInput = document.getElementById('editTestDurationInput');
  const editorSelector = document.getElementById('editorTestSelector');
  const adminSelector = document.getElementById('adminTestSelector');

  if (titleInput) titleInput.value = currentTest.name || currentTest.title || '';
  if (topicInput) topicInput.value = currentTest.topic || '';
  if (subjectInput) subjectInput.value = currentTest.subject || '';
  if (durationInput) durationInput.value = currentTest.durationMinutes || 15;

  const shuffleQInput = document.getElementById('editTestShuffleQInput');
  const shuffleOptInput = document.getElementById('editTestShuffleOptInput');
  if (shuffleQInput) shuffleQInput.checked = !!currentTest.shuffleQuestions;
  if (shuffleOptInput) shuffleOptInput.checked = !!currentTest.shuffleOptions;

  if (editorSelector && currentTest.id) {
    editorSelector.value = currentTest.id;
  }
  if (adminSelector && currentTest.id) {
    adminSelector.value = currentTest.id;
  }
}

function bindMetaInputs() {
  const titleInput = document.getElementById('editTestTitleInput');
  const topicInput = document.getElementById('editTestTopicInput');
  const subjectInput = document.getElementById('editTestSubjectInput');
  const durationInput = document.getElementById('editTestDurationInput');

  if (titleInput) {
    titleInput.addEventListener('input', e => {
      currentTest.name = e.target.value;
      currentTest.title = e.target.value;
      const editorSelector = document.getElementById('editorTestSelector');
      if (editorSelector && editorSelector.selectedOptions && editorSelector.selectedOptions[0]) {
        editorSelector.selectedOptions[0].text = `${currentTest.name} (${currentTest.questions.length} пит., ${currentTest.durationMinutes} хв)`;
      }
      saveDraftToStorage();
    });
  }
  if (topicInput) {
    topicInput.addEventListener('input', e => {
      currentTest.topic = e.target.value;
      saveDraftToStorage();
    });
  }
  if (subjectInput) {
    subjectInput.addEventListener('input', e => {
      currentTest.subject = e.target.value;
      saveDraftToStorage();
    });
  }
  if (durationInput) {
    durationInput.addEventListener('input', e => {
      currentTest.durationMinutes = parseInt(e.target.value, 10) || 15;
      const editorSelector = document.getElementById('editorTestSelector');
      if (editorSelector && editorSelector.selectedOptions && editorSelector.selectedOptions[0]) {
        editorSelector.selectedOptions[0].text = `${currentTest.name} (${currentTest.questions.length} пит., ${currentTest.durationMinutes} хв)`;
      }
      saveDraftToStorage();
    });
  }
  const shuffleQInput = document.getElementById('editTestShuffleQInput');
  if (shuffleQInput) {
    shuffleQInput.addEventListener('change', e => {
      currentTest.shuffleQuestions = e.target.checked;
      saveDraftToStorage();
    });
  }
  const shuffleOptInput = document.getElementById('editTestShuffleOptInput');
  if (shuffleOptInput) {
    shuffleOptInput.addEventListener('change', e => {
      currentTest.shuffleOptions = e.target.checked;
      saveDraftToStorage();
    });
  }
}

function bindActionButtons() {
  const addSide = document.getElementById('addQuestionSideBtn');
  const quickSave = document.getElementById('quickSaveBtn');

  const addHandler = () => {
    recordUndoSnapshot();
    const newQ = {
      id: 'q_' + Date.now(),
      text: 'Нове тестове запитання',
      type: 'single',
      options: ['Варіант 1', 'Варіант 2', 'Варіант 3', 'Варіант 4'],
      correct: 0,
      points: 1,
      timeLimit: 60,
      imageUrl: '',
      explanation: ''
    };
    currentTest.questions.push(newQ);
    activeQuestionIndex = currentTest.questions.length - 1;
    renderQuestionsNav();
    loadQuestionIntoEditor(activeQuestionIndex);
    updateTestAnalytics();
    showToast('Додано нове запитання #' + (activeQuestionIndex + 1));
  };

  if (addSide) addSide.addEventListener('click', addHandler);

  if (quickSave) {
    quickSave.addEventListener('click', async () => {
      quickSave.disabled = true;
      try {
        const savedOk = await persistStudioTestToServer();
        showToast(savedOk ? 'Тест успішно збережено на сервері!' : 'Тест збережено локально');
      } finally {
        quickSave.disabled = false;
      }
    });
  }
}

async function persistStudioTestToServer() {
  saveCurrentEditorQuestion();
  saveDraftToStorage();
  if (!currentTest || !currentTest.id) return false;
  const payload = {
    title: currentTest.name || currentTest.title,
    subject: currentTest.subject || 'Загальний',
    topic: currentTest.topic || '',
    durationMinutes: parseInt(currentTest.durationMinutes, 10) || 15,
    class: currentTest.class || '10-А',
    shuffleQuestions: !!currentTest.shuffleQuestions,
    shuffleOptions: !!currentTest.shuffleOptions,
    questions: (currentTest.questions || []).map(q => {
      const copy = { ...q };
      copy.timeLimitSeconds = copy.timeLimit || copy.timeLimitSeconds || 60;
      return copy;
    })
  };
  try {
    const token = localStorage.getItem('admin_token') || '';
    const res = await fetch(`/api/admin/tests/${encodeURIComponent(currentTest.id)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': token
      },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      if (typeof window.refreshAdminTestsList === 'function') {
        await window.refreshAdminTestsList();
      }
      return true;
    }
  } catch {}
  return false;
}

function saveDraftToStorage() {
  try {
    localStorage.setItem('test_studio_draft', JSON.stringify(currentTest));
  } catch {}
}

function updateTestAnalytics() {
  const totalScoreEl = document.getElementById('statTotalScore');
  const estTimeEl = document.getElementById('statEstimatedTime');
  const diffBadgeEl = document.getElementById('statDifficultyBadge');
  const distEl = document.getElementById('statDistribution');
  const qaCheckEl = document.getElementById('statQualityCheck');
  const qCountLabel = document.getElementById('questionsCountLabel');
  const qBadge = document.getElementById('questionsCountBadge');

  const questions = currentTest.questions || [];
  const count = questions.length;

  if (qCountLabel) qCountLabel.textContent = `Всього питань: ${count} • Загальний час: ${currentTest.durationMinutes || 15} хв`;
  if (qBadge) qBadge.textContent = count;

  let totalScore = 0;
  let estSeconds = 0;
  let typeCounts = { single: 0, multiple: 0, true_false: 0, matching: 0, ordering: 0, fill_blanks: 0, short_answer: 0, numeric: 0 };
  let issues = [];

  questions.forEach((q, i) => {
    totalScore += (parseInt(q.points) || 1);
    estSeconds += (parseInt(q.timeLimit) || 60);
    if (typeCounts[q.type] !== undefined) typeCounts[q.type]++;

    if (!q.text || !q.text.trim()) {
      issues.push(`Питання #${i + 1} не має тексту`);
    }
    if ((q.type === 'single' || q.type === 'multiple' || q.type === 'true_false') && (!q.options || q.options.length < 2)) {
      issues.push(`Питання #${i + 1} має замало варіантів`);
    }
    if (q.type === 'single' && (q.correct === undefined || q.correct === null)) {
      issues.push(`Питання #${i + 1} не має правильної відповіді`);
    }
    if (q.type === 'numeric' && (q.correct === undefined || q.correct === null || q.correct === '' || isNaN(Number(String(q.correct).replace(',', '.'))))) {
      issues.push(`Питання #${i + 1} потребує числової відповіді`);
    }
  });

  if (totalScoreEl) totalScoreEl.textContent = `${totalScore} б.`;
  const estMinutes = (estSeconds / 60).toFixed(1);
  if (estTimeEl) estTimeEl.textContent = `${estMinutes} хв.`;

  const complexCount = typeCounts.matching + typeCounts.ordering + typeCounts.fill_blanks + typeCounts.numeric;
  if (diffBadgeEl) {
    if (count === 0) {
      diffBadgeEl.textContent = 'Немає питань';
      diffBadgeEl.className = 'diff-badge warning';
    } else if (complexCount >= count * 0.5) {
      diffBadgeEl.textContent = 'Високий рівень';
      diffBadgeEl.className = 'diff-badge danger';
    } else if (complexCount >= 1 || typeCounts.multiple >= 1) {
      diffBadgeEl.textContent = 'Оптимальний';
      diffBadgeEl.className = 'diff-badge optimal';
    } else {
      diffBadgeEl.textContent = 'Базовий';
      diffBadgeEl.className = 'diff-badge warning';
    }
  }

  if (distEl) {
    const parts = [];
    if (typeCounts.single) parts.push(`${typeCounts.single} вибір`);
    if (typeCounts.multiple) parts.push(`${typeCounts.multiple} мн. вибір`);
    if (typeCounts.matching) parts.push(`${typeCounts.matching} пари`);
    if (typeCounts.true_false) parts.push(`${typeCounts.true_false} так/ні`);
    if (typeCounts.fill_blanks) parts.push(`${typeCounts.fill_blanks} пропуски`);
    if (typeCounts.short_answer) parts.push(`${typeCounts.short_answer} відкриті`);
    if (typeCounts.numeric) parts.push(`${typeCounts.numeric} числові`);
    distEl.textContent = parts.length > 0 ? parts.join(' • ') : 'Немає питань';
  }

  if (qaCheckEl) {
    if (issues.length === 0 && count > 0) {
      qaCheckEl.innerHTML = '<img src="/img/icons/check.svg" class="pixel-icon inline" alt=""> Усі відповіді заповнено';
      qaCheckEl.className = 'qa-badge success';
    } else if (count === 0) {
      qaCheckEl.innerHTML = '<img src="/img/icons/warning.svg" class="pixel-icon inline" alt=""> Додайте запитання';
      qaCheckEl.className = 'qa-badge warning';
    } else {
      qaCheckEl.innerHTML = `<img src="/img/icons/warning.svg" class="pixel-icon inline" alt=""> ${issues[0]}`;
      qaCheckEl.className = 'qa-badge warning';
    }
  }
}

function renderQuestionsNav() {
  const container = document.getElementById('questionsNavList');
  if (!container) return;
  container.innerHTML = '';

  const questions = currentTest.questions || [];
  if (questions.length === 0) {
    container.innerHTML = '<div style="text-align: center; padding: 24px 8px; color: var(--text-muted); font-size: 12px;">Список питань порожній.<br>Натисніть "+ Додати", щоб створити.</div>';
    return;
  }

  questions.forEach((q, index) => {
    const item = document.createElement('div');
    item.className = 'q-nav-item' + (index === activeQuestionIndex ? ' active' : '');
    item.draggable = true;
    item.dataset.index = index;

    const typeLabels = {
      single: '1 правильний',
      multiple: 'Кілька правильних',
      true_false: 'Правда/Неправда',
      matching: 'Відповідність',
      ordering: 'Послідовність',
      fill_blanks: 'Пропуски',
      short_answer: 'Коротка відповідь',
      numeric: 'Числова ±'
    };

    item.innerHTML = `
      <div class="q-nav-grip" title="Перетягніть для зміни порядку">⋮⋮</div>
      <div class="q-nav-content">
        <div class="q-nav-top-meta">
          <span class="q-nav-number">#${index + 1}</span>
          <span class="q-nav-points">${q.points || 1} б.</span>
        </div>
        <div class="q-nav-text-preview">${escapeHtml(q.text || 'Питання без назви')}</div>
        <div class="q-nav-type-tag">${typeLabels[q.type] || 'Тест'}</div>
      </div>
    `;

    item.addEventListener('click', () => {
      saveCurrentEditorQuestion();
      activeQuestionIndex = index;
      renderQuestionsNav();
      loadQuestionIntoEditor(index);
    });

    item.addEventListener('dragstart', (e) => {
      draggedQuestionIndex = index;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', index);
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      draggedQuestionIndex = null;
      document.querySelectorAll('.q-nav-item').forEach(el => {
        el.classList.remove('drag-over-top', 'drag-over-bottom');
      });
    });

    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (draggedQuestionIndex === null || draggedQuestionIndex === index) return;
      const rect = item.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        item.classList.add('drag-over-top');
        item.classList.remove('drag-over-bottom');
      } else {
        item.classList.add('drag-over-bottom');
        item.classList.remove('drag-over-top');
      }
    });

    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    item.addEventListener('drop', (e) => {
      e.preventDefault();
      if (draggedQuestionIndex === null || draggedQuestionIndex === index) return;
      recordUndoSnapshot();
      const rect = item.getBoundingClientRect();
      const insertBefore = e.clientY < (rect.top + rect.height / 2);

      const movingItem = currentTest.questions.splice(draggedQuestionIndex, 1)[0];
      let targetIndex = index;
      if (draggedQuestionIndex < index) {
        targetIndex = insertBefore ? index - 1 : index;
      } else {
        targetIndex = insertBefore ? index : index + 1;
      }
      currentTest.questions.splice(targetIndex, 0, movingItem);
      activeQuestionIndex = targetIndex;
      renderQuestionsNav();
      loadQuestionIntoEditor(activeQuestionIndex);
      updateTestAnalytics();
      saveDraftToStorage();
      showToast('Порядок питань змінено');
    });

    container.appendChild(item);
  });
}

function filterQuestionsBySearch(keyword) {
  const qItems = document.querySelectorAll('.q-nav-item');
  const lower = (keyword || '').toLowerCase().trim();
  qItems.forEach(el => {
    const text = el.querySelector('.q-nav-text-preview')?.textContent.toLowerCase() || '';
    if (!lower || text.includes(lower)) {
      el.style.display = 'flex';
    } else {
      el.style.display = 'none';
    }
  });
}

function loadQuestionIntoEditor(index) {
  const questions = currentTest.questions || [];
  if (!questions[index]) {
    renderEmptyEditorState();
    return;
  }
  const q = questions[index];

  const indexBadge = document.getElementById('editorQuestionIndexBadge');
  const typeSelect = document.getElementById('editorQuestionType');
  const pointsInput = document.getElementById('editorPoints');
  const timeLimitInput = document.getElementById('editorTimeLimit');
  const textInput = document.getElementById('editorQuestionText');
  const explanationBox = document.getElementById('aiExplanationBox');
  const explanationText = document.getElementById('editorExplanationText');
  const imageUrlInput = document.getElementById('editorImageUrl');
  const imagePreviewBox = document.getElementById('imagePreviewBox');
  const imagePreviewImg = document.getElementById('imagePreviewImg');

  if (indexBadge) indexBadge.textContent = `Питання #${index + 1}`;
  if (typeSelect) typeSelect.value = q.type || 'single';
  if (pointsInput) pointsInput.value = q.points || 1;
  if (timeLimitInput) timeLimitInput.value = q.timeLimit || 60;
  if (textInput) textInput.value = q.text || '';

  if (explanationBox && explanationText) {
    explanationText.value = q.explanation || '';
    if (q.explanation && q.explanation.trim()) {
      explanationBox.classList.remove('hidden');
    } else {
      explanationBox.classList.add('hidden');
    }
  }

  if (imageUrlInput && imagePreviewBox && imagePreviewImg) {
    imageUrlInput.value = q.imageUrl || '';
    if (q.imageUrl) {
      imagePreviewImg.src = q.imageUrl;
      imagePreviewBox.classList.remove('hidden');
    } else {
      imagePreviewBox.classList.add('hidden');
    }
  }

  renderTypeSpecificControls(q);
  updateLivePreview();
}

function renderEmptyEditorState() {
  const indexBadge = document.getElementById('editorQuestionIndexBadge');
  const textInput = document.getElementById('editorQuestionText');
  const container = document.getElementById('optionsContainer');
  if (indexBadge) indexBadge.textContent = 'Немає питань';
  if (textInput) textInput.value = '';
  if (container) container.innerHTML = '<div style="color:var(--text-muted); font-size:12px; padding:12px;">Створіть питання, щоб редагувати його параметри.</div>';
  updateLivePreview();
}

function parseEditorNumericVal(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim().replace(/\s+/g, '').replace(',', '.');
  if (!s || !/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function formatEditorNumeric(n) {
  return String(Number(n.toFixed(6)));
}

function syncEditorNumericToleranceUI(q) {
  const targetInput = document.getElementById('editorNumericTarget');
  const tolToggle = document.getElementById('editorNumericToleranceToggle');
  const tolControls = document.getElementById('editorNumericToleranceControls');
  const tolInput = document.getElementById('editorNumericTolerance');
  const chipsWrap = document.getElementById('editorNumericTolChips');
  const previewEl = document.getElementById('editorNumericRangePreview');
  const applyAllBtn = document.getElementById('applyNumericTolAllBtn');
  const statePill = document.getElementById('editorNumericTolStatePill');

  const enabled = !!(tolToggle && tolToggle.checked);
  if (statePill) {
    statePill.textContent = enabled ? 'Увімкнено' : 'Вимкнено';
    statePill.classList.toggle('is-on', enabled);
  }
  if (tolControls) tolControls.classList.toggle('hidden', !enabled);
  const tolVal = enabled ? Math.max(0, Math.abs(parseEditorNumericVal(tolInput ? tolInput.value : 0) ?? 0)) : 0;

  if (chipsWrap) {
    chipsWrap.querySelectorAll('.tol-chip').forEach(ch => {
      const chipVal = Number(ch.dataset.tol);
      ch.classList.toggle('active', enabled && Math.abs(chipVal - tolVal) < 1e-9);
    });
  }

  if (previewEl) {
    const targetNum = parseEditorNumericVal(targetInput ? targetInput.value : q?.correct);
    if (targetNum === null) {
      previewEl.textContent = enabled
        ? `Вкажіть правильне число (поточна похибка ± ${formatEditorNumeric(tolVal)}). Підтримуються крапка й кома.`
        : 'Вкажіть правильне число. Похибка вимкнена (вимагатиметься точний збіг).';
    } else if (!enabled || tolVal === 0) {
      previewEl.textContent = `Приймається лише точне число: ${formatEditorNumeric(targetNum)} (крапка й кома однакові).`;
    } else {
      const minV = formatEditorNumeric(targetNum - tolVal);
      const maxV = formatEditorNumeric(targetNum + tolVal);
      previewEl.textContent = `Зарахуються числа від ${minV} до ${maxV} (± ${formatEditorNumeric(tolVal)}).`;
    }
  }

  if (applyAllBtn) {
    const numericCount = Array.isArray(currentTest?.questions) ? currentTest.questions.filter(item => item.type === 'numeric').length : 0;
    applyAllBtn.classList.toggle('hidden', numericCount < 2);
  }
}

function renderTypeSpecificControls(q) {
  const optionsSection = document.getElementById('optionsBuilderSection');
  const matchingSection = document.getElementById('matchingBuilderSection');
  const blanksSection = document.getElementById('fillBlanksHelperSection');
  const shortSection = document.getElementById('shortAnswerSection');
  const numericSection = document.getElementById('numericBuilderSection');

  if (optionsSection) optionsSection.classList.add('hidden');
  if (matchingSection) matchingSection.classList.add('hidden');
  if (blanksSection) blanksSection.classList.add('hidden');
  if (shortSection) shortSection.classList.add('hidden');
  if (numericSection) numericSection.classList.add('hidden');

  if (q.type === 'single' || q.type === 'multiple' || q.type === 'true_false' || q.type === 'ordering') {
    if (optionsSection) optionsSection.classList.remove('hidden');
    renderOptionsBuilder(q);
  } else if (q.type === 'matching') {
    if (matchingSection) matchingSection.classList.remove('hidden');
    renderMatchingBuilder(q);
  } else if (q.type === 'fill_blanks') {
    if (blanksSection) blanksSection.classList.remove('hidden');
    updateDetectedBlanks(q.text);
  } else if (q.type === 'short_answer') {
    if (shortSection) shortSection.classList.remove('hidden');
    const shortInput = document.getElementById('editorShortKeywords');
    if (shortInput) {
      shortInput.value = Array.isArray(q.correct) ? q.correct.join(', ') : (q.correct || '');
    }
    const aiToggle = document.getElementById('editorAiGradingToggle');
    if (aiToggle) {
      aiToggle.disabled = false;
      aiToggle.checked = !!q.useAiGrading;
      aiToggle.onchange = (e) => {
        q.useAiGrading = e.target.checked;
        saveDraftToStorage();
      };
    }
  } else if (q.type === 'numeric') {
    if (numericSection) numericSection.classList.remove('hidden');
    const targetInput = document.getElementById('editorNumericTarget');
    const tolInput = document.getElementById('editorNumericTolerance');
    const tolToggle = document.getElementById('editorNumericToleranceToggle');
    const rawTol = Number(String(q.numericTolerance ?? 0).replace(',', '.'));
    const tolNum = Number.isFinite(rawTol) ? Math.abs(rawTol) : 0;
    const isEnabled = q.numericToleranceEnabled !== undefined ? !!q.numericToleranceEnabled : tolNum > 0;
    if (targetInput) targetInput.value = q.correct !== undefined && q.correct !== null ? String(q.correct) : '';
    if (tolInput) {
      if (tolNum > 0) tolInput.dataset.lastTol = String(tolNum);
      tolInput.value = tolNum > 0 ? String(tolNum) : (tolInput.dataset.lastTol || '0.2');
    }
    if (tolToggle) tolToggle.checked = isEnabled;
    syncEditorNumericToleranceUI(q);
  }
}

function renderOptionsBuilder(q) {
  const container = document.getElementById('optionsContainer');
  const header = document.getElementById('optionsSectionHeader');
  const addBtn = document.getElementById('addOptionBtn');
  if (!container) return;
  container.innerHTML = '';

  if (q.type === 'true_false') {
    if (header) header.textContent = 'Виберіть правильне твердження:';
    if (addBtn) addBtn.style.display = 'none';
    if (!q.options || q.options.length !== 2) {
      q.options = ['Неправда', 'Правда'];
    }
  } else if (q.type === 'ordering') {
    if (header) header.textContent = 'Вкажіть правильний порядок елементів (зверху вниз):';
    if (addBtn) addBtn.style.display = 'inline-block';
  } else {
    if (header) header.textContent = q.type === 'multiple' ? 'Варіанти відповідей (позначте кілька правильних):' : 'Варіанти відповідей (виберіть правильний):';
    if (addBtn) addBtn.style.display = 'inline-block';
  }

  const options = q.options || [];
  options.forEach((optText, optIndex) => {
    const row = document.createElement('div');
    const isCorrect = Array.isArray(q.correct) ? q.correct.includes(optIndex) : (q.correct === optIndex);
    row.className = 'option-row' + (isCorrect ? ' correct' : '');
    row.draggable = q.type !== 'true_false';
    row.dataset.index = optIndex;

    const inputType = q.type === 'multiple' ? 'checkbox' : 'radio';

    row.innerHTML = `
      ${q.type !== 'true_false' ? '<span class="opt-grip" title="Перетягніть варіант">⋮⋮</span>' : ''}
      ${q.type !== 'ordering' ? `<input type="${inputType}" name="opt_correct_group" class="opt-correct-toggle" ${isCorrect ? 'checked' : ''} title="Позначити як правильний">` : `<span style="font-size:11px; font-weight:700; color:var(--accent);">${optIndex + 1}.</span>`}
      <input type="text" class="opt-text-input" value="${escapeHtml(optText)}" placeholder="Варіант відповіді...">
      ${q.type !== 'true_false' && options.length > 2 ? '<button type="button" class="opt-delete-btn" title="Видалити варіант"><img src="/img/icons/cross.svg" class="pixel-icon inline" alt=""></button>' : ''}
    `;

    const textInput = row.querySelector('.opt-text-input');
    textInput.addEventListener('input', (e) => {
      q.options[optIndex] = e.target.value;
      updateLivePreview();
    });

    const toggle = row.querySelector('.opt-correct-toggle');
    if (toggle) {
      toggle.addEventListener('change', () => {
        recordUndoSnapshot();
        if (q.type === 'multiple') {
          if (!Array.isArray(q.correct)) q.correct = [];
          if (toggle.checked) {
            if (!q.correct.includes(optIndex)) q.correct.push(optIndex);
          } else {
            q.correct = q.correct.filter(x => x !== optIndex);
          }
        } else {
          q.correct = optIndex;
        }
        renderOptionsBuilder(q);
        updateLivePreview();
        updateTestAnalytics();
      });
    }

    const delBtn = row.querySelector('.opt-delete-btn');
    if (delBtn) {
      delBtn.addEventListener('click', () => {
        recordUndoSnapshot();
        q.options.splice(optIndex, 1);
        if (Array.isArray(q.correct)) {
          q.correct = q.correct.filter(x => x !== optIndex).map(x => x > optIndex ? x - 1 : x);
        } else if (q.correct === optIndex) {
          q.correct = 0;
        } else if (q.correct > optIndex) {
          q.correct--;
        }
        renderOptionsBuilder(q);
        updateLivePreview();
        updateTestAnalytics();
      });
    }

    if (q.type !== 'true_false') {
      row.addEventListener('dragstart', (e) => {
        draggedOptionIndex = optIndex;
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });

      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        draggedOptionIndex = null;
        document.querySelectorAll('.option-row').forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom'));
      });

      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (draggedOptionIndex === null || draggedOptionIndex === optIndex) return;
        const rect = row.getBoundingClientRect();
        if (e.clientY < (rect.top + rect.height / 2)) {
          row.classList.add('drag-over-top');
          row.classList.remove('drag-over-bottom');
        } else {
          row.classList.add('drag-over-bottom');
          row.classList.remove('drag-over-top');
        }
      });

      row.addEventListener('dragleave', () => {
        row.classList.remove('drag-over-top', 'drag-over-bottom');
      });

      row.addEventListener('drop', (e) => {
        e.preventDefault();
        if (draggedOptionIndex === null || draggedOptionIndex === optIndex) return;
        recordUndoSnapshot();
        const rect = row.getBoundingClientRect();
        const insertBefore = e.clientY < (rect.top + rect.height / 2);

        const movingOpt = q.options.splice(draggedOptionIndex, 1)[0];
        let targetIndex = optIndex;
        if (draggedOptionIndex < optIndex) {
          targetIndex = insertBefore ? optIndex - 1 : optIndex;
        } else {
          targetIndex = insertBefore ? optIndex : optIndex + 1;
        }
        q.options.splice(targetIndex, 0, movingOpt);

        renderOptionsBuilder(q);
        updateLivePreview();
        showToast('Порядок варіантів оновлено');
      });
    }

    container.appendChild(row);
  });
}

function renderMatchingBuilder(q) {
  const container = document.getElementById('matchingPairsContainer');
  if (!container) return;
  container.innerHTML = '';

  const pairs = q.matchingPairs || [];
  pairs.forEach((pair, pairIndex) => {
    const row = document.createElement('div');
    row.className = 'option-row';
    row.style.display = 'grid';
    row.style.gridTemplateColumns = '24px 1fr 20px 1fr 28px';
    row.style.gap = '8px';
    row.style.alignItems = 'center';

    row.innerHTML = `
      <span style="font-weight:700; font-size:11px; color:var(--accent);">${pairIndex + 1}.</span>
      <input type="text" class="form-input left-pair-input" style="font-size:12px; padding:4px 8px;" value="${escapeHtml(pair.left || '')}" placeholder="Елемент зліва">
      <span style="text-align:center; color:var(--text-muted); font-size:12px;">⟷</span>
      <input type="text" class="form-input right-pair-input" style="font-size:12px; padding:4px 8px;" value="${escapeHtml(pair.right || '')}" placeholder="Відповідність справа">
      ${pairs.length > 2 ? '<button type="button" class="opt-delete-btn" title="Видалити пару"><img src="/img/icons/cross.svg" class="pixel-icon inline" alt=""></button>' : '<span></span>'}
    `;

    const leftInput = row.querySelector('.left-pair-input');
    const rightInput = row.querySelector('.right-pair-input');
    const delBtn = row.querySelector('.opt-delete-btn');

    if (leftInput) leftInput.addEventListener('input', e => { pair.left = e.target.value; updateLivePreview(); });
    if (rightInput) rightInput.addEventListener('input', e => { pair.right = e.target.value; updateLivePreview(); });
    if (delBtn) {
      delBtn.addEventListener('click', () => {
        recordUndoSnapshot();
        q.matchingPairs.splice(pairIndex, 1);
        renderMatchingBuilder(q);
        updateLivePreview();
      });
    }

    container.appendChild(row);
  });
}

function updateDetectedBlanks(text) {
  const listEl = document.getElementById('detectedBlanksList');
  if (!listEl) return;
  listEl.innerHTML = '';

  const regex = /\[([^\]]+)\]/g;
  let match;
  let found = [];
  while ((match = regex.exec(text || '')) !== null) {
    found.push(match[1]);
  }

  if (found.length === 0) {
    listEl.innerHTML = '<span style="font-size:11px; color:var(--text-muted);">Пропусків ще не знайдено. Додайте [слово] у тексті вище.</span>';
  } else {
    found.forEach((blank, idx) => {
      const tag = document.createElement('span');
      tag.className = 'blank-tag';
      tag.textContent = `#${idx + 1}: ${blank}`;
      listEl.appendChild(tag);
    });
  }
}

function bindEditorInputs() {
  const typeSelect = document.getElementById('editorQuestionType');
  const pointsInput = document.getElementById('editorPoints');
  const timeLimitInput = document.getElementById('editorTimeLimit');
  const textInput = document.getElementById('editorQuestionText');
  const explanationText = document.getElementById('editorExplanationText');
  const addOptionBtn = document.getElementById('addOptionBtn');
  const addMatchingPairBtn = document.getElementById('addMatchingPairBtn');
  const duplicateBtn = document.getElementById('duplicateQuestionBtn');
  const deleteBtn = document.getElementById('deleteQuestionBtn');
  const closeExplanationBtn = document.getElementById('closeExplanationBtn');

  if (typeSelect) {
    typeSelect.addEventListener('change', () => {
      const q = currentTest.questions[activeQuestionIndex];
      if (!q) return;
      recordUndoSnapshot();
      q.type = typeSelect.value;
      if (q.type === 'matching' && (!q.matchingPairs || q.matchingPairs.length === 0)) {
        q.matchingPairs = [
          { left: 'Елемент 1', right: 'Пара 1' },
          { left: 'Елемент 2', right: 'Пара 2' }
        ];
      }
      if (q.type === 'numeric') {
        if (q.correct === undefined || typeof q.correct !== 'number') q.correct = '';
        if (q.numericTolerance === undefined) q.numericTolerance = 0;
        if (q.numericToleranceEnabled === undefined) q.numericToleranceEnabled = Number(q.numericTolerance) > 0;
      }
      renderTypeSpecificControls(q);
      renderQuestionsNav();
      updateTestAnalytics();
      updateLivePreview();
    });
  }

  const editorShortKeywords = document.getElementById('editorShortKeywords');
  if (editorShortKeywords) {
    editorShortKeywords.addEventListener('input', e => {
      const q = currentTest.questions[activeQuestionIndex];
      if (q && q.type === 'short_answer') {
        q.correct = e.target.value;
        q.correctKeywords = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
        updateTestAnalytics();
        updateLivePreview();
      }
    });
  }

  const editorNumericTarget = document.getElementById('editorNumericTarget');
  const editorNumericTolerance = document.getElementById('editorNumericTolerance');
  const editorNumericToleranceToggle = document.getElementById('editorNumericToleranceToggle');
  const editorNumericTolChips = document.getElementById('editorNumericTolChips');
  const applyNumericTolAllBtn = document.getElementById('applyNumericTolAllBtn');

  if (editorNumericTarget) {
    editorNumericTarget.addEventListener('input', e => {
      const q = currentTest.questions[activeQuestionIndex];
      if (q && q.type === 'numeric') {
        const parsed = parseEditorNumericVal(e.target.value);
        q.correct = parsed === null ? e.target.value : parsed;
        syncEditorNumericToleranceUI(q);
        updateTestAnalytics();
        updateLivePreview();
      }
    });
  }
  if (editorNumericToleranceToggle) {
    editorNumericToleranceToggle.addEventListener('change', e => {
      const q = currentTest.questions[activeQuestionIndex];
      if (!q || q.type !== 'numeric') return;
      const enabled = !!e.target.checked;
      q.numericToleranceEnabled = enabled;
      if (enabled) {
        const fallbackTol = parseEditorNumericVal(editorNumericTolerance?.dataset.lastTol) || 0.2;
        const currentTol = parseEditorNumericVal(editorNumericTolerance?.value);
        const nextTol = (currentTol !== null && currentTol > 0) ? currentTol : fallbackTol;
        if (editorNumericTolerance) editorNumericTolerance.value = String(nextTol);
        q.numericTolerance = nextTol;
      } else {
        const prevTol = parseEditorNumericVal(editorNumericTolerance?.value);
        if (prevTol !== null && prevTol > 0 && editorNumericTolerance) {
          editorNumericTolerance.dataset.lastTol = String(prevTol);
        }
        q.numericTolerance = 0;
      }
      syncEditorNumericToleranceUI(q);
      updateTestAnalytics();
      updateLivePreview();
      saveDraftToStorage();
    });
  }
  if (editorNumericTolerance) {
    editorNumericTolerance.addEventListener('input', e => {
      const q = currentTest.questions[activeQuestionIndex];
      if (q && q.type === 'numeric') {
        const parsed = parseEditorNumericVal(e.target.value);
        const absTol = parsed !== null ? Math.abs(parsed) : 0;
        if (absTol > 0) e.target.dataset.lastTol = String(absTol);
        const isEnabled = editorNumericToleranceToggle ? editorNumericToleranceToggle.checked : absTol > 0;
        q.numericToleranceEnabled = isEnabled && absTol > 0;
        q.numericTolerance = isEnabled ? absTol : 0;
        syncEditorNumericToleranceUI(q);
        updateTestAnalytics();
        updateLivePreview();
      }
    });
  }
  if (editorNumericTolChips) {
    editorNumericTolChips.addEventListener('click', e => {
      const btn = e.target.closest('.tol-chip');
      if (!btn) return;
      const val = parseEditorNumericVal(btn.dataset.tol);
      if (val === null) return;
      const q = currentTest.questions[activeQuestionIndex];
      if (!q || q.type !== 'numeric') return;
      if (editorNumericToleranceToggle) editorNumericToleranceToggle.checked = true;
      if (editorNumericTolerance) {
        editorNumericTolerance.value = String(val);
        editorNumericTolerance.dataset.lastTol = String(val);
      }
      q.numericToleranceEnabled = true;
      q.numericTolerance = val;
      syncEditorNumericToleranceUI(q);
      updateTestAnalytics();
      updateLivePreview();
      saveDraftToStorage();
    });
  }
  if (applyNumericTolAllBtn) {
    applyNumericTolAllBtn.addEventListener('click', () => {
      const q = currentTest.questions[activeQuestionIndex];
      if (!q || q.type !== 'numeric') return;
      const enabled = editorNumericToleranceToggle ? editorNumericToleranceToggle.checked : false;
      const tolVal = enabled ? Math.max(0, Math.abs(parseEditorNumericVal(editorNumericTolerance?.value) ?? 0)) : 0;
      let updatedCount = 0;
      recordUndoSnapshot();
      (currentTest.questions || []).forEach(item => {
        if (item.type === 'numeric') {
          item.numericToleranceEnabled = enabled && tolVal > 0;
          item.numericTolerance = enabled ? tolVal : 0;
          updatedCount++;
        }
      });
      saveDraftToStorage();
      updateLivePreview();
      showToast(enabled && tolVal > 0
        ? `Похибку ± ${formatEditorNumeric(tolVal)} застосовано до ${updatedCount} числових питань`
        : `Похибку вимкнено для ${updatedCount} числових питань`);
    });
  }

  if (pointsInput) {
    pointsInput.addEventListener('input', e => {
      const q = currentTest.questions[activeQuestionIndex];
      if (q) {
        q.points = parseInt(e.target.value) || 1;
        renderQuestionsNav();
        updateTestAnalytics();
      }
    });
  }

  if (timeLimitInput) {
    timeLimitInput.addEventListener('input', e => {
      const q = currentTest.questions[activeQuestionIndex];
      if (q) {
        q.timeLimit = parseInt(e.target.value) || 60;
        updateTestAnalytics();
        updateLivePreview();
      }
    });
  }

  let textDebounce = null;
  if (textInput) {
    textInput.addEventListener('input', e => {
      const q = currentTest.questions[activeQuestionIndex];
      if (q) {
        clearTimeout(textDebounce);
        textDebounce = setTimeout(() => {
          recordUndoSnapshot();
        }, 800);
        q.text = e.target.value;
        const navItem = document.querySelector(`.q-nav-item[data-index="${activeQuestionIndex}"] .q-nav-text-preview`);
        if (navItem) navItem.textContent = q.text || 'Питання без назви';
        if (q.type === 'fill_blanks') updateDetectedBlanks(q.text);
        updateTestAnalytics();
        updateLivePreview();
      }
    });
  }

  if (explanationText) {
    explanationText.addEventListener('input', e => {
      const q = currentTest.questions[activeQuestionIndex];
      if (q) q.explanation = e.target.value;
    });
  }

  if (closeExplanationBtn) {
    closeExplanationBtn.addEventListener('click', () => {
      const box = document.getElementById('aiExplanationBox');
      if (box) box.classList.add('hidden');
    });
  }

  const toggleImageBtn = document.getElementById('toggleImageSectionBtn');
  const closeImageBtn = document.getElementById('closeImageSectionBtn');
  const clearImageBtn = document.getElementById('clearImageBtn');
  const imageUrlInput = document.getElementById('editorImageUrl');
  const imageFileInput = document.getElementById('imageFileInput');
  const uploadImageFileBtn = document.getElementById('uploadImageFileBtn');
  const toggleUrlImageInputBtn = document.getElementById('toggleUrlImageInputBtn');
  const applyImageUrlBtn = document.getElementById('applyImageUrlBtn');
  const imageUrlRow = document.getElementById('imageUrlRow');
  const imageDropzone = document.getElementById('imageDropzone');

  const setQuestionImage = (imgSrc, toastMsg) => {
    const q = currentTest.questions[activeQuestionIndex];
    if (!q) return;
    recordUndoSnapshot();
    q.imageUrl = imgSrc;
    const previewBox = document.getElementById('imagePreviewBox');
    const previewImg = document.getElementById('imagePreviewImg');
    const sec = document.getElementById('imageAttachmentSection');
    if (previewBox && previewImg) {
      previewImg.src = imgSrc;
      previewBox.classList.remove('hidden');
    }
    if (sec) sec.classList.remove('hidden');
    if (imageUrlInput) imageUrlInput.value = imgSrc.startsWith('data:') ? '' : imgSrc;
    updateLivePreview();
    saveDraftToStorage();
    if (toastMsg) showToast(toastMsg);
  };

  const handleImageFile = (file) => {
    if (!file || !file.type.startsWith('image/')) {
      showToast('Оберіть файл зображення (PNG, JPG, WEBP)');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      setQuestionImage(e.target.result, 'Фото успішно завантажено з комп\'ютера');
    };
    reader.readAsDataURL(file);
  };

  if (toggleImageBtn) {
    toggleImageBtn.addEventListener('click', () => {
      const sec = document.getElementById('imageAttachmentSection');
      if (sec) sec.classList.toggle('hidden');
    });
  }

  if (closeImageBtn) {
    closeImageBtn.addEventListener('click', () => {
      const sec = document.getElementById('imageAttachmentSection');
      if (sec) sec.classList.add('hidden');
    });
  }

  if (uploadImageFileBtn && imageFileInput) {
    uploadImageFileBtn.addEventListener('click', () => {
      imageFileInput.click();
    });
    imageFileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handleImageFile(e.target.files[0]);
      }
    });
  }

  if (toggleUrlImageInputBtn && imageUrlRow) {
    toggleUrlImageInputBtn.addEventListener('click', () => {
      imageUrlRow.classList.toggle('hidden');
    });
  }

  if (applyImageUrlBtn && imageUrlInput) {
    applyImageUrlBtn.addEventListener('click', () => {
      const val = imageUrlInput.value.trim();
      if (!val) {
        showToast('Введіть коректну URL-адресу фото');
        return;
      }
      setQuestionImage(val, 'Фото за посиланням прикріплено');
    });
  }

  if (imageDropzone) {
    ['dragenter', 'dragover'].forEach(evt => {
      imageDropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        imageDropzone.classList.add('drag-active');
      });
    });
    ['dragleave', 'drop'].forEach(evt => {
      imageDropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        imageDropzone.classList.remove('drag-active');
      });
    });
    imageDropzone.addEventListener('drop', (e) => {
      const files = e.dataTransfer?.files;
      if (files && files[0]) {
        handleImageFile(files[0]);
      }
    });
  }

  document.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const blob = items[i].getAsFile();
        if (blob) {
          handleImageFile(blob);
          break;
        }
      }
    }
  });

  if (clearImageBtn) {
    clearImageBtn.addEventListener('click', () => {
      const q = currentTest.questions[activeQuestionIndex];
      if (q) {
        recordUndoSnapshot();
        q.imageUrl = '';
      }
      if (imageUrlInput) imageUrlInput.value = '';
      if (imageFileInput) imageFileInput.value = '';
      const previewBox = document.getElementById('imagePreviewBox');
      if (previewBox) previewBox.classList.add('hidden');
      updateLivePreview();
      saveDraftToStorage();
      showToast('Фото видалено');
    });
  }

  if (addOptionBtn) {
    addOptionBtn.addEventListener('click', () => {
      const q = currentTest.questions[activeQuestionIndex];
      if (!q) return;
      recordUndoSnapshot();
      if (!q.options) q.options = [];
      q.options.push(`Варіант ${q.options.length + 1}`);
      renderOptionsBuilder(q);
      updateLivePreview();
      updateTestAnalytics();
    });
  }

  if (addMatchingPairBtn) {
    addMatchingPairBtn.addEventListener('click', () => {
      const q = currentTest.questions[activeQuestionIndex];
      if (!q) return;
      recordUndoSnapshot();
      if (!q.matchingPairs) q.matchingPairs = [];
      q.matchingPairs.push({
        left: `Елемент ${q.matchingPairs.length + 1}`,
        right: `Пара ${q.matchingPairs.length + 1}`
      });
      renderMatchingBuilder(q);
      updateLivePreview();
    });
  }

  if (duplicateBtn) {
    duplicateBtn.addEventListener('click', () => {
      const q = currentTest.questions[activeQuestionIndex];
      if (!q) return;
      recordUndoSnapshot();
      saveCurrentEditorQuestion();
      const copy = JSON.parse(JSON.stringify(q));
      copy.id = 'q_' + Date.now();
      copy.text = copy.text + ' (Копія)';
      currentTest.questions.splice(activeQuestionIndex + 1, 0, copy);
      activeQuestionIndex++;
      renderQuestionsNav();
      loadQuestionIntoEditor(activeQuestionIndex);
      updateTestAnalytics();
      showToast('Питання здубльовано');
    });
  }

  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      if (currentTest.questions.length <= 1) {
        showToast('Неможливо видалити останнє запитання');
        return;
      }
      recordUndoSnapshot();
      currentTest.questions.splice(activeQuestionIndex, 1);
      if (activeQuestionIndex >= currentTest.questions.length) {
        activeQuestionIndex = currentTest.questions.length - 1;
      }
      renderQuestionsNav();
      loadQuestionIntoEditor(activeQuestionIndex);
      updateTestAnalytics();
      showToast('Питання видалено');
    });
  }

  document.querySelectorAll('.tool-btn[data-wrap]').forEach(btn => {
    btn.addEventListener('click', () => {
      const wrap = btn.dataset.wrap;
      const textarea = document.getElementById('editorQuestionText');
      if (!textarea) return;
      recordUndoSnapshot();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const val = textarea.value;
      const selected = val.substring(start, end) || 'текст';
      textarea.value = val.substring(0, start) + wrap + selected + wrap + val.substring(end);
      textarea.focus();
      textarea.selectionStart = start + wrap.length;
      textarea.selectionEnd = start + wrap.length + selected.length;
      const q = currentTest.questions[activeQuestionIndex];
      if (q) q.text = textarea.value;
      updateLivePreview();
    });
  });
}

function saveCurrentEditorQuestion() {
  const q = currentTest.questions[activeQuestionIndex];
  if (!q) return;
  const textInput = document.getElementById('editorQuestionText');
  const pointsInput = document.getElementById('editorPoints');
  const timeLimitInput = document.getElementById('editorTimeLimit');
  const explanationText = document.getElementById('editorExplanationText');

  if (textInput) q.text = textInput.value;
  if (pointsInput) q.points = parseInt(pointsInput.value) || 1;
  if (timeLimitInput) q.timeLimit = parseInt(timeLimitInput.value) || 60;
  if (explanationText) q.explanation = explanationText.value;
  if (q.type === 'numeric') {
    const targetInput = document.getElementById('editorNumericTarget');
    const tolInput = document.getElementById('editorNumericTolerance');
    const tolToggle = document.getElementById('editorNumericToleranceToggle');
    if (targetInput) {
      const parsed = parseEditorNumericVal(targetInput.value);
      if (parsed !== null) q.correct = parsed;
    }
    const enabled = tolToggle ? tolToggle.checked : false;
    const parsedTol = tolInput ? parseEditorNumericVal(tolInput.value) : 0;
    const absTol = parsedTol !== null ? Math.abs(parsedTol) : 0;
    q.numericToleranceEnabled = enabled && absTol > 0;
    q.numericTolerance = q.numericToleranceEnabled ? absTol : 0;
  } else if (q.type === 'short_answer') {
    const shortInput = document.getElementById('editorShortKeywords');
    if (shortInput) {
      q.correct = shortInput.value;
      q.correctKeywords = shortInput.value.split(',').map(s => s.trim()).filter(Boolean);
    }
  }
}

let lastGeminiError = '';

const STUDIO_TYPE_LABELS = {
  single: '1 варіант',
  multiple: 'Кілька правильних',
  true_false: 'Правда / Неправда',
  numeric: 'Числова ±',
  matching: 'Відповідність',
  ordering: 'Послідовність',
  short_answer: 'Коротка відповідь',
  fill_blanks: 'Пропуски'
};

function normalizeStudioQuestion(raw, fallbackTimeLimit = 60, fallbackToleranceHint = null) {
  if (!raw || typeof raw !== 'object') return null;
  const text = String(raw.text || raw.question || '').trim();
  if (!text) return null;

  const typeAliases = {
    single: 'single',
    multiple: 'multiple',
    true_false: 'true_false',
    tf: 'true_false',
    boolean: 'true_false',
    matching: 'matching',
    match: 'matching',
    ordering: 'ordering',
    order: 'ordering',
    numeric: 'numeric',
    number: 'numeric',
    short_answer: 'short_answer',
    short: 'short_answer',
    open: 'short_answer',
    fill_blanks: 'fill_blanks'
  };
  const qType = typeAliases[String(raw.type || 'single').toLowerCase()] || 'single';
  const tl = Math.max(10, Math.min(600, parseInt(raw.timeLimit || raw.timeLimitSeconds || fallbackTimeLimit, 10) || 60));
  const points = Math.max(1, parseInt(raw.points, 10) || 1);
  const explanation = String(raw.explanation || '').trim();

  const q = {
    id: raw.id || ('q_ai_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)),
    text,
    type: qType,
    images: [],
    imageUrl: '',
    options: [],
    matchingPairs: [],
    orderingItems: [],
    blanks: [],
    correctKeywords: [],
    points,
    timeLimit: tl,
    timeLimitSeconds: tl,
    explanation
  };

  if (qType === 'true_false') {
    q.options = ['Неправда', 'Правда'];
    const cRaw = raw.correct !== undefined ? raw.correct : raw.correctAnswer;
    const cStr = String(cRaw).trim().toLowerCase();
    q.correct = (cRaw === true || cRaw === 1 || cStr === '1' || cStr === 'true' || cStr === 'правда') ? 1 : 0;
    return q;
  }

  if (qType === 'matching') {
    const rawPairs = Array.isArray(raw.matchingPairs) ? raw.matchingPairs : (Array.isArray(raw.pairs) ? raw.pairs : []);
    const pairs = rawPairs
      .map(p => ({ left: String(p?.left || p?.a || '').trim(), right: String(p?.right || p?.b || '').trim() }))
      .filter(p => p.left && p.right);
    if (pairs.length < 2) return null;
    q.matchingPairs = pairs;
    q.correct = {};
    return q;
  }

  if (qType === 'ordering') {
    const rawItems = Array.isArray(raw.orderingItems)
      ? raw.orderingItems
      : (Array.isArray(raw.items) ? raw.items : (Array.isArray(raw.options) ? raw.options : []));
    const items = rawItems.map(i => String(i || '').trim()).filter(Boolean);
    if (items.length < 2) return null;
    q.orderingItems = items;
    q.options = items;
    q.correct = items;
    return q;
  }

  if (qType === 'numeric') {
    const target = parseEditorNumericVal(raw.correct !== undefined ? raw.correct : raw.answer);
    if (target === null) return null;
    let parsedTol = parseEditorNumericVal(raw.numericTolerance);
    if (parsedTol === null && fallbackToleranceHint !== null && fallbackToleranceHint !== undefined) {
      parsedTol = parseEditorNumericVal(fallbackToleranceHint);
    }
    const absTol = Math.max(0, Math.abs(parsedTol ?? 0));
    const enabled = fallbackToleranceHint === 0
      ? false
      : (raw.numericToleranceEnabled !== undefined ? !!raw.numericToleranceEnabled && absTol > 0 : absTol > 0);
    q.correct = target;
    q.numericTolerance = enabled ? absTol : 0;
    q.numericToleranceEnabled = enabled;
    return q;
  }

  if (qType === 'short_answer') {
    let keywords = [];
    if (Array.isArray(raw.correctKeywords)) {
      keywords = raw.correctKeywords.map(k => String(k || '').trim()).filter(Boolean);
    }
    if (keywords.length === 0) {
      if (Array.isArray(raw.correct)) {
        keywords = raw.correct.map(k => String(k || '').trim()).filter(Boolean);
      } else if (raw.correct !== undefined || raw.answer !== undefined) {
        keywords = String(raw.correct !== undefined ? raw.correct : raw.answer)
          .split(',')
          .map(s => s.trim())
          .filter(Boolean);
      }
    }
    if (keywords.length === 0) return null;
    q.correct = keywords.join(', ');
    q.correctKeywords = keywords;
    q.useAiGrading = !!raw.useAiGrading;
    return q;
  }

  const opts = Array.isArray(raw.options) ? raw.options.map(o => String(o || '').trim()).filter(Boolean) : [];
  if (opts.length < 2) return null;
  q.options = opts;

  if (qType === 'multiple') {
    let corr = Array.isArray(raw.correct)
      ? raw.correct.map(c => parseInt(c, 10)).filter(n => !isNaN(n) && n >= 0 && n < opts.length)
      : [];
    corr = Array.from(new Set(corr)).sort((a, b) => a - b);
    q.correct = corr.length > 0 ? corr : [0];
    return q;
  }

  let corrIdx = parseInt(raw.correct, 10);
  if ((isNaN(corrIdx) || corrIdx < 0 || corrIdx >= opts.length) && raw.correctAnswer !== undefined) {
    corrIdx = opts.findIndex(o => o.toLowerCase() === String(raw.correctAnswer).trim().toLowerCase());
  }
  q.correct = (!isNaN(corrIdx) && corrIdx >= 0 && corrIdx < opts.length) ? corrIdx : 0;
  return q;
}

function formatQuestionSummaryLines(q) {
  if (!q) return [];
  if (q.type === 'matching' && Array.isArray(q.matchingPairs)) {
    return q.matchingPairs.map((p, idx) => `${idx + 1}. ${p.left} ↔ ${p.right}`);
  }
  if (q.type === 'ordering') {
    const items = Array.isArray(q.orderingItems) && q.orderingItems.length > 0 ? q.orderingItems : (q.options || []);
    return items.map((item, idx) => `${idx + 1}) ${item}`);
  }
  if (q.type === 'numeric') {
    const target = q.correct;
    const tol = q.numericToleranceEnabled && Number(q.numericTolerance) > 0
      ? ` (± ${q.numericTolerance})`
      : ' (точне число)';
    return [`Відповідь: ${target}${tol}`];
  }
  if (q.type === 'short_answer') {
    const kw = Array.isArray(q.correctKeywords) && q.correctKeywords.length > 0
      ? q.correctKeywords.join(', ')
      : String(q.correct || '');
    return [`Прийнятні відповіді: ${kw}`];
  }
  const opts = Array.isArray(q.options) ? q.options : [];
  return opts.map((opt, idx) => {
    const isCorr = Array.isArray(q.correct) ? q.correct.includes(idx) : Number(q.correct) === idx;
    return `${isCorr ? '[✓]' : '•'} ${opt}`;
  });
}

async function callGeminiApi(promptText, expectJson = true, extraOptions = {}) {
  lastGeminiError = '';
  const token = localStorage.getItem('admin_token') || '';
  if (!token) {
    lastGeminiError = 'Потрібна авторизація адміністратора.';
    showToast(lastGeminiError);
    return null;
  }
  try {
    const res = await fetch('/api/admin/gemini/prompt', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': token
      },
      body: JSON.stringify({
        prompt: promptText,
        expectJson: !!expectJson,
        history: Array.isArray(extraOptions.history) ? extraOptions.history : undefined,
        systemInstruction: extraOptions.systemInstruction || undefined,
        timeoutMs: extraOptions.timeoutMs || undefined
      })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success && data.result !== undefined) {
      return data.result;
    }
    lastGeminiError = data.error || `Помилка Gemini API (${res.status})`;
    showToast(lastGeminiError);
  } catch (err) {
    lastGeminiError = err.message || 'Мережева помилка при зверненні до сервера';
    showToast(lastGeminiError);
  }
  return null;
}

function appendChatErrorWithRetry(errorMessage, onRetry) {
  const container = document.getElementById('aiChatMessages');
  if (!container) return;
  const msg = document.createElement('div');
  msg.className = 'chat-msg assistant';
  msg.innerHTML = `
    <div class="chat-msg-avatar"><img src="/img/icons/warning.svg" class="pixel-icon inline" alt=""></div>
    <div class="chat-msg-bubble">
      <div>Не вдалося виконати запит через Gemini.</div>
      <div class="chat-retry-wrap">
        <span>${escapeHtml(errorMessage || 'Помилка з’єднання або таймаут сервера.')}</span>
        ${typeof onRetry === 'function' ? '<button type="button" class="btn-chat-retry">Спробувати ще раз</button>' : ''}
      </div>
    </div>
  `;
  const retryBtn = msg.querySelector('.btn-chat-retry');
  if (retryBtn && typeof onRetry === 'function') {
    retryBtn.addEventListener('click', () => {
      msg.remove();
      onRetry();
    });
  }
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

function bindAiSmartTools() {
  const genOptionsBtn = document.getElementById('aiGenOptionsBtn');
  const improveTextBtn = document.getElementById('aiImproveTextBtn');
  const explainBtn = document.getElementById('aiExplainBtn');
  const openChatSidebarBtn = document.getElementById('openChatSidebarBtn');
  if (openChatSidebarBtn) {
    openChatSidebarBtn.addEventListener('click', () => {
      switchToRightTab('chat');
    });
  }

  if (genOptionsBtn) {
    const runGenerateOptions = async () => {
      const q = currentTest.questions[activeQuestionIndex];
      if (!q || !q.text) {
        showToast('Спочатку введіть текст запитання');
        return;
      }
      switchToRightTab('chat');
      appendChatMessage('user', `Згенеруй правильні та точні варіанти для питання: "${q.text}"`);

      const typingId = appendTypingIndicator();
      showToast('Gemini AI формує варіанти...');

      const prompt = `Ти — експертний методист зі складання тестів українською мовою.
Предмет: "${currentTest.subject || 'Загальний'}". Тема: "${currentTest.topic || ''}".
Текст запитання: "${q.text}".
Тип запитання: "${q.type}".
Вимоги:
1. Склади 4 або 5 правдоподібних, якісних варіантів відповідей українською мовою. Варіанти мають бути конкретними фактами чи термінами (НІЯКИХ заглушок на кшталт "Варіант А" чи "Дистрактор Б").
2. Якщо тип multiple — вкажи ВСІ правильні індекси (наприклад, [0, 2]). Якщо single або true_false — вкажи 1 індекс правильної відповіді (наприклад, 1).
3. Напиши коротке і точне пояснення правильної відповіді.
Поверни строго валідний JSON у форматі:
{
  "options": ["...", "...", "...", "..."],
  "correct": [0],
  "explanation": "..."
}`;

      const result = await callGeminiApi(prompt, true, { timeoutMs: 35000 });
      removeTypingIndicator(typingId);

      if (!result || !Array.isArray(result.options) || result.options.length < 2) {
        appendChatErrorWithRetry(lastGeminiError || 'Gemini не повернув коректні варіанти.', runGenerateOptions);
        return;
      }

      recordUndoSnapshot();
      q.options = result.options.map(o => String(o || '').trim()).filter(Boolean);
      if (q.type === 'multiple') {
        q.correct = Array.isArray(result.correct) ? result.correct : [result.correct || 0];
      } else {
        q.correct = Array.isArray(result.correct) ? (result.correct[0] || 0) : (result.correct || 0);
      }
      if (result.explanation) {
        q.explanation = result.explanation;
        const expBox = document.getElementById('aiExplanationBox');
        const expText = document.getElementById('editorExplanationText');
        if (expText) expText.value = result.explanation;
        if (expBox) expBox.classList.remove('hidden');
      }

      renderOptionsBuilder(q);
      updateLivePreview();
      updateTestAnalytics();
      saveDraftToStorage();

      appendChatMessage('assistant', `Ось згенеровані варіанти для запитання #${activeQuestionIndex + 1}:`, {
        title: 'Застосовані варіанти відповідей:',
        items: q.options.map((opt, i) => {
          const isCorr = Array.isArray(q.correct) ? q.correct.includes(i) : q.correct === i;
          return `${isCorr ? '[✓]' : '•'} ${opt}`;
        }),
        explanation: q.explanation
      });
      showToast('Gemini згенерував варіанти!');
    };
    genOptionsBtn.addEventListener('click', runGenerateOptions);
  }

  if (improveTextBtn) {
    const runImproveText = async () => {
      const q = currentTest.questions[activeQuestionIndex];
      if (!q || !q.text) {
        showToast('Спочатку введіть текст запитання');
        return;
      }
      switchToRightTab('chat');
      appendChatMessage('user', `Покращ формулювання: "${q.text}"`);

      const typingId = appendTypingIndicator();
      showToast('Gemini покращує формулювання...');

      const prompt = `Ти — експерт зі стандартизованого тестування (ЗНО/НМТ).
Покращ текст наступного тестового завдання, зроби його чітким, однозначним і грамотним українською мовою:
"${q.text}".
Поверни строго JSON: { "improved": "покращений текст завдання" }`;

      const result = await callGeminiApi(prompt, true, { timeoutMs: 30000 });
      removeTypingIndicator(typingId);

      const improvedText = result && typeof result.improved === 'string' ? result.improved.trim() : '';
      if (!improvedText) {
        appendChatErrorWithRetry(lastGeminiError || 'Не вдалося покращити формулювання.', runImproveText);
        return;
      }

      recordUndoSnapshot();
      q.text = improvedText;
      const textInput = document.getElementById('editorQuestionText');
      if (textInput) textInput.value = improvedText;
      renderQuestionsNav();
      updateLivePreview();
      saveDraftToStorage();

      appendChatMessage('assistant', 'Текст завдання оновлено відповідно до стандартів тестування:', {
        title: 'Покращене формулювання:',
        items: [improvedText]
      });
      showToast('Формулювання покращено!');
    };
    improveTextBtn.addEventListener('click', runImproveText);
  }

  if (explainBtn) {
    const runExplainQuestion = async () => {
      const q = currentTest.questions[activeQuestionIndex];
      if (!q || !q.text) {
        showToast('Спочатку введіть текст запитання');
        return;
      }
      switchToRightTab('chat');
      appendChatMessage('user', `Створи пояснення до питання: "${q.text}"`);

      const typingId = appendTypingIndicator();
      showToast('Gemini створює пояснення...');

      const prompt = `Створи лаконічне і науково обґрунтоване методичне пояснення правильної відповіді до тестового завдання українською мовою.
Завдання: "${q.text}".
Тип: "${q.type}".
Дані: ${JSON.stringify({ options: q.options || [], matchingPairs: q.matchingPairs || [], orderingItems: q.orderingItems || [], correct: q.correct, numericTolerance: q.numericTolerance })}.
Поверни строго JSON: { "explanation": "текст пояснення з фактами" }`;

      const result = await callGeminiApi(prompt, true, { timeoutMs: 30000 });
      removeTypingIndicator(typingId);

      const explanation = result && typeof result.explanation === 'string' ? result.explanation.trim() : '';
      if (!explanation) {
        appendChatErrorWithRetry(lastGeminiError || 'Не вдалося згенерувати пояснення.', runExplainQuestion);
        return;
      }

      recordUndoSnapshot();
      q.explanation = explanation;
      const expBox = document.getElementById('aiExplanationBox');
      const expText = document.getElementById('editorExplanationText');
      if (expText) expText.value = explanation;
      if (expBox) expBox.classList.remove('hidden');
      saveDraftToStorage();

      appendChatMessage('assistant', 'Методичне пояснення для учнів готове:', {
        title: 'Пояснення:',
        items: [explanation]
      });
      showToast('Пояснення створено!');
    };
    explainBtn.addEventListener('click', runExplainQuestion);
  }
}

function copyTextToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
  return Promise.resolve();
}

function formatQuestionForClipboard(q, index = 1) {
  const qText = q.text || q.question || '';
  let out = `${index}. ${qText}\n`;
  const opts = Array.isArray(q.options) ? q.options : [];
  if (opts.length > 0) {
    const letters = ['А', 'Б', 'В', 'Г', 'Д', 'Е'];
    opts.forEach((opt, idx) => {
      const letter = letters[idx] || ((idx + 1) + ')');
      out += `   ${letter}) ${opt}\n`;
    });
  }
  const corr = q.correct !== undefined ? q.correct : q.correctAnswer;
  if (corr !== undefined) {
    const letters = ['А', 'Б', 'В', 'Г', 'Д', 'Е'];
    if (Array.isArray(corr)) {
      const ans = corr.map(c => typeof c === 'number' ? (letters[c] || c) : c).join(', ');
      out += `   Правильна відповідь: ${ans}\n`;
    } else if (typeof corr === 'number') {
      out += `   Правильна відповідь: ${letters[corr] || corr}\n`;
    } else {
      out += `   Правильна відповідь: ${corr}\n`;
    }
  }
  if (q.explanation) {
    out += `   Пояснення: ${q.explanation}\n`;
  }
  return out;
}

function formatTestForClipboard(testTitle, questions) {
  let out = `Тест: ${testTitle || 'Новий тест'}\nКількість завдань: ${questions.length}\n\n`;
  questions.forEach((q, idx) => {
    out += formatQuestionForClipboard(q, idx + 1) + '\n';
  });
  return out;
}

function extractJsonFromText(text) {
  if (!text) return null;
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i);
  if (codeBlockMatch && codeBlockMatch[1]) {
    const candidate = codeBlockMatch[1].trim();
    try {
      return JSON.parse(candidate);
    } catch {}
    try {
      return JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1'));
    } catch {}
  }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = text.substring(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch {}
    try {
      return JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1'));
    } catch {}
  }
  const firstBracket = text.indexOf('[');
  const lastBracket = text.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    const candidate = text.substring(firstBracket, lastBracket + 1);
    try {
      return JSON.parse(candidate);
    } catch {}
    try {
      return JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1'));
    } catch {}
  }
  return null;
}

function bindAiChatSidebar() {
  const tabChatBtn = document.getElementById('rightTabChatBtn');
  const tabPreviewBtn = document.getElementById('rightTabPreviewBtn');
  const chatPanel = document.getElementById('rightAiChatPanel');
  const previewPanel = document.getElementById('rightPreviewPanel');
  if (tabChatBtn) tabChatBtn.classList.remove('hidden');
  if (chatPanel && previewPanel && tabChatBtn && tabPreviewBtn) {
    switchToRightTab('chat');
  }

  const input = document.getElementById('aiChatInput');
  const sendBtn = document.getElementById('aiChatSendBtn');
  const clearBtn = document.getElementById('clearChatBtn');
  const chips = document.querySelectorAll('.chat-chip');

  if (tabChatBtn) {
    tabChatBtn.addEventListener('click', () => switchToRightTab('chat'));
  }
  if (tabPreviewBtn) {
    tabPreviewBtn.addEventListener('click', () => switchToRightTab('preview'));
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      aiChatHistory = [];
      const container = document.getElementById('aiChatMessages');
      if (container) {
        container.innerHTML = `
          <div class="chat-msg assistant">
            <div class="chat-msg-avatar"><img src="/img/icons/star.svg" class="pixel-icon inline" alt=""></div>
            <div class="chat-msg-bubble">Історію чату очищено. Що ти хочеш створити або покращити в тесті?</div>
          </div>
        `;
      }
    });
  }

  async function applyQuestionsToCurrent(questionsToApply, mode = 'append', newTitle = '') {
    if (!Array.isArray(questionsToApply) || questionsToApply.length === 0) {
      showToast('Оберіть хоча б одне питання');
      return;
    }
    recordUndoSnapshot();
    const prepared = questionsToApply.map(q => JSON.parse(JSON.stringify(q)));
    if (mode === 'replace') {
      currentTest.questions = prepared;
      if (newTitle) currentTest.name = currentTest.title = newTitle;
      activeQuestionIndex = 0;
    } else {
      if (!Array.isArray(currentTest.questions)) currentTest.questions = [];
      const startIdx = currentTest.questions.length;
      currentTest.questions.push(...prepared);
      activeQuestionIndex = startIdx;
    }
    syncMetaHeader();
    renderQuestionsNav();
    loadQuestionIntoEditor(activeQuestionIndex);
    updateTestAnalytics();
    await persistStudioTestToServer();
    if (typeof window.switchTabTo === 'function') {
      window.switchTabTo('testEditor');
    }
    showToast(mode === 'replace'
      ? `Тест замінено на ${prepared.length} питань!`
      : `Додано ${prepared.length} питань до поточного тесту!`);
  }

  async function createNewTestFromChat(questionsToCreate, title, parsedMeta = {}) {
    if (!Array.isArray(questionsToCreate) || questionsToCreate.length === 0) {
      showToast('Оберіть хоча б одне питання');
      return;
    }
    try {
      const token = localStorage.getItem('admin_token') || '';
      const res = await fetch('/api/admin/tests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': token
        },
        body: JSON.stringify({
          title: title || ((currentTest?.subject || 'Новий тест') + ' (ШІ)'),
          durationMinutes: parseInt(parsedMeta.durationMinutes, 10) || 15,
          topic: parsedMeta.topic || currentTest?.topic || '',
          subject: parsedMeta.subject || currentTest?.subject || 'Загальний',
          questions: questionsToCreate
        })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        showToast(errData.error || 'Не вдалося створити тест на сервері');
        return;
      }
      const created = await res.json();
      if (typeof window.refreshAdminTestsList === 'function') {
        await window.refreshAdminTestsList();
      }
      if (typeof window.selectAndOpenAdminTest === 'function') {
        await window.selectAndOpenAdminTest(created.id);
      } else {
        loadTestIntoStudio(created);
      }
      if (typeof window.switchTabTo === 'function') {
        window.switchTabTo('testEditor');
      }
      showToast(`Тест "${created.title}" створено та відкрито!`);
    } catch (e) {
      showToast('Помилка створення тесту: ' + e.message);
    }
  }

  const handleSend = async (customPrompt) => {
    const text = customPrompt || (input ? input.value.trim() : '');
    if (!text) return;
    if (input) input.value = '';

    appendChatMessage('user', text);
    const typingId = appendTypingIndicator();

    const q = (currentTest?.questions && currentTest.questions[activeQuestionIndex]) || {};
    const existingList = Array.isArray(currentTest?.questions)
      ? currentTest.questions.slice(0, 35).map((item, idx) => `${idx + 1}. [${item.type || 'single'}] ${String(item.text || '').replace(/\s+/g, ' ').slice(0, 100)}`)
      : [];

    const prompt = `Ти — інтелектуальний помічник викладача Gemini у системі створення тестів SecureExam.
Поточний тест: "${currentTest?.name || ''}", предмет: "${currentTest?.subject || ''}", тема: "${currentTest?.topic || ''}".
Повний список уже наявних питань у тесті (${currentTest?.questions?.length || 0}):
${existingList.length > 0 ? existingList.join('\n') : '(поки порожній)'}

Поточне активне питання у редакторі (#${activeQuestionIndex + 1}):
"${q.text || ''}", тип: "${q.type || 'single'}", дані: ${JSON.stringify({ options: q.options || [], matchingPairs: q.matchingPairs || [], orderingItems: q.orderingItems || [], correct: q.correct, numericTolerance: q.numericTolerance })}.

Поточний запит викладача: "${text}"

ІНСТРУКЦІЯ ВІДПОВІДІ:
Підтримувані типи питань:
- "single": options[], correct (індекс 0..3)
- "multiple": options[], correct ([0, 2])
- "true_false": options:["Неправда","Правда"], correct (0 або 1)
- "matching": matchingPairs:[{"left":"...","right":"..."}]
- "ordering": orderingItems:["...","..."]
- "numeric": correct (число), numericTolerance (число >=0), numericToleranceEnabled (boolean)
- "short_answer": correctKeywords:["..."]

1. Якщо викладач просить створити тест або кілька питань (наприклад "додай 5 питань", "створи тест про...", "зроби 3 задачі"):
Напиши короткий коментар і ОБОВ'ЯЗКОВО додай JSON-блок:
\`\`\`json
{
  "action": "create_test",
  "testTitle": "Назва тесту",
  "subject": "Предмет",
  "topic": "Тема",
  "durationMinutes": 15,
  "questions": [
    {
      "text": "Текст питання",
      "type": "single",
      "options": ["Варіант 1", "Варіант 2", "Варіант 3", "Варіант 4"],
      "correct": 0,
      "points": 1,
      "timeLimit": 60,
      "explanation": "Пояснення правильної відповіді"
    }
  ]
}
\`\`\`

2. Якщо викладач просить створити ОДНЕ питання або переробити/оновити активне питання (#${activeQuestionIndex + 1}):
\`\`\`json
{
  "action": "update_or_add_question",
  "text": "Текст запитання",
  "type": "single",
  "options": ["Варіант 1", "Варіант 2", "Варіант 3", "Варіант 4"],
  "correct": 0,
  "explanation": "Пояснення"
}
\`\`\`

3. Якщо це методична порада, рев'ю тесту чи пояснення — відповідай чітко українською без вигадувань.`;

    const historySnapshot = aiChatHistory.slice(-8);
    const reply = await callGeminiApi(prompt, false, {
      history: historySnapshot,
      timeoutMs: 45000
    });
    removeTypingIndicator(typingId);

    if (!reply) {
      appendChatErrorWithRetry(
        lastGeminiError || 'Не вдалося отримати відповідь від Gemini API на сервері.',
        () => handleSend(text)
      );
      return;
    }

    aiChatHistory.push({ role: 'user', text });
    aiChatHistory.push({ role: 'model', text: String(reply).slice(0, 6000) });
    if (aiChatHistory.length > 12) {
      aiChatHistory = aiChatHistory.slice(-12);
    }

    let parsedAction = extractJsonFromText(reply);

    let cleanReply = reply
      .replace(/```(?:json)?[\s\S]*?```/gi, '')
      .replace(/```(?:json)?[\s\S]*$/gi, '')
      .trim();

    if (parsedAction) {
      const firstBrace = cleanReply.indexOf('{');
      const lastBrace = cleanReply.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        cleanReply = (cleanReply.substring(0, firstBrace) + cleanReply.substring(lastBrace + 1)).trim();
      }
      const firstBracket = cleanReply.indexOf('[');
      const lastBracket = cleanReply.lastIndexOf(']');
      if (firstBracket !== -1 && lastBracket > firstBracket) {
        cleanReply = (cleanReply.substring(0, firstBracket) + cleanReply.substring(lastBracket + 1)).trim();
      }
    }

    let cardData = null;
    let rawQuestionsList = null;
    if (Array.isArray(parsedAction)) {
      rawQuestionsList = parsedAction;
    } else if (parsedAction && Array.isArray(parsedAction.questions)) {
      rawQuestionsList = parsedAction.questions;
    } else if (parsedAction && parsedAction.test && Array.isArray(parsedAction.test.questions)) {
      rawQuestionsList = parsedAction.test.questions;
    }

    if (!rawQuestionsList || rawQuestionsList.length === 0) {
      const fallbackQuestions = parseRawTestText(reply);
      if (fallbackQuestions && fallbackQuestions.length >= 2) {
        rawQuestionsList = fallbackQuestions;
        if (!parsedAction) parsedAction = { action: 'create_test', questions: rawQuestionsList };
      }
    }

    if (rawQuestionsList && rawQuestionsList.length > 0) {
      const normalizedList = rawQuestionsList
        .map(item => normalizeStudioQuestion(item, 60))
        .filter(Boolean);

      if (normalizedList.length > 0) {
        const qCount = normalizedList.length;
        const testTitle = (parsedAction && (parsedAction.testTitle || parsedAction.topic)) || ((currentTest?.subject ? currentTest.subject : 'Тест') + ': Новий набір');
        const fullTestClipboard = formatTestForClipboard(testTitle, normalizedList);

        cardData = {
          title: `Підготовлено ${qCount} завдань («${testTitle}»). Оберіть потрібні та дію:`,
          selectableQuestions: normalizedList.map((nq, idx) => ({
            question: nq,
            label: `${idx + 1}. [${STUDIO_TYPE_LABELS[nq.type] || nq.type}] ${nq.text}`,
            summary: formatQuestionSummaryLines(nq).slice(0, 4).join(' • ')
          })),
          explanation: parsedAction?.explanation || '',
          onAppendSelected: (selected) => applyQuestionsToCurrent(selected, 'append'),
          onReplaceSelected: (selected) => applyQuestionsToCurrent(selected, 'replace', parsedAction?.testTitle || ''),
          onCreateNewSelected: (selected) => createNewTestFromChat(selected, testTitle, parsedAction || {}),
          onCopyText: () => {
            copyTextToClipboard(fullTestClipboard).then(() => showToast('Весь тест скопійовано в буфер обміну!'));
          },
          onCopyJson: () => {
            copyTextToClipboard(JSON.stringify({ title: testTitle, questions: normalizedList }, null, 2)).then(() => showToast('JSON тесту скопійовано!'));
          }
        };
      }
    } else if (parsedAction && (parsedAction.options || parsedAction.matchingPairs || parsedAction.orderingItems || parsedAction.correctKeywords || parsedAction.text || parsedAction.question || parsedAction.correct !== undefined)) {
      const normalizedSingle = normalizeStudioQuestion({
        ...parsedAction,
        text: parsedAction.text || parsedAction.question || q.text || 'Нове запитання від Gemini',
        type: parsedAction.type || q.type || 'single'
      }, q.timeLimit || 60);

      if (normalizedSingle) {
        const qClipboard = formatQuestionForClipboard(normalizedSingle, activeQuestionIndex + 1);
        const applySingle = (asNew) => {
          recordUndoSnapshot();
          if (asNew || !currentTest.questions || currentTest.questions.length === 0) {
            if (!Array.isArray(currentTest.questions)) currentTest.questions = [];
            currentTest.questions.push(JSON.parse(JSON.stringify(normalizedSingle)));
            activeQuestionIndex = currentTest.questions.length - 1;
            showToast('Нове запитання додано до тесту!');
          } else {
            const targetQ = currentTest.questions[activeQuestionIndex] || currentTest.questions[0];
            Object.assign(targetQ, JSON.parse(JSON.stringify(normalizedSingle)), { id: targetQ.id });
            showToast('Поточне запитання оновлено!');
          }
          renderQuestionsNav();
          loadQuestionIntoEditor(activeQuestionIndex);
          updateTestAnalytics();
          saveDraftToStorage();
          if (typeof window.switchTabTo === 'function') {
            window.switchTabTo('testEditor');
          }
        };

        cardData = {
          title: `Пропозиція питання [${STUDIO_TYPE_LABELS[normalizedSingle.type] || normalizedSingle.type}]:`,
          items: [normalizedSingle.text, ...formatQuestionSummaryLines(normalizedSingle)],
          explanation: normalizedSingle.explanation || '',
          onApply: () => applySingle(false),
          onAddNew: () => applySingle(true),
          onCopyQuestion: () => {
            copyTextToClipboard(qClipboard).then(() => showToast('Запитання скопійовано в буфер обміну!'));
          },
          onCopyJson: () => {
            copyTextToClipboard(JSON.stringify(normalizedSingle, null, 2)).then(() => showToast('JSON скопійовано!'));
          }
        };
      }
    }

    if (!cleanReply) {
      cleanReply = cardData ? 'Готово! Перевірте згенерований результат нижче:' : 'Відповідь від Gemini:';
    }

    appendChatMessage('assistant', cleanReply, cardData);
  };

  if (sendBtn) {
    sendBtn.addEventListener('click', () => handleSend());
  }
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });
  }

  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      const prompt = chip.dataset.prompt;
      if (prompt) handleSend(prompt);
    });
  });
}

function switchToRightTab(tabName) {
  const tabChatBtn = document.getElementById('rightTabChatBtn');
  const tabPreviewBtn = document.getElementById('rightTabPreviewBtn');
  const chatPanel = document.getElementById('rightAiChatPanel');
  const previewPanel = document.getElementById('rightPreviewPanel');

  if (tabName === 'chat') {
    if (tabChatBtn) tabChatBtn.classList.add('active');
    if (tabPreviewBtn) tabPreviewBtn.classList.remove('active');
    if (chatPanel) chatPanel.classList.remove('hidden');
    if (previewPanel) previewPanel.classList.add('hidden');
  } else {
    if (tabChatBtn) tabChatBtn.classList.remove('active');
    if (tabPreviewBtn) tabPreviewBtn.classList.add('active');
    if (chatPanel) chatPanel.classList.add('hidden');
    if (previewPanel) previewPanel.classList.remove('hidden');
    updateLivePreview();
  }
}

function appendChatMessage(role, text, cardData = null) {
  const container = document.getElementById('aiChatMessages');
  if (!container) return;

  const msg = document.createElement('div');
  msg.className = `chat-msg ${role}`;

  let inner = '';
  if (role === 'assistant') {
    inner += `<div class="chat-msg-avatar"><img src="/img/icons/star.svg" class="pixel-icon inline" alt=""></div>`;
  }
  inner += `<div class="chat-msg-bubble"><div>${escapeHtml(text).replace(/\n/g, '<br>')}</div>`;

  if (cardData) {
    let listMarkup = '';
    if (Array.isArray(cardData.selectableQuestions) && cardData.selectableQuestions.length > 0) {
      listMarkup = `
        <div class="chat-preview-items">
          ${cardData.selectableQuestions.map((entry, idx) => `
            <label class="chat-preview-cb-row">
              <input type="checkbox" class="chat-q-select-cb" data-idx="${idx}" checked>
              <div>
                <div style="font-weight:600;">${escapeHtml(entry.label)}</div>
                ${entry.summary ? `<div style="font-size:10px; color:var(--text-muted); margin-top:2px;">${escapeHtml(entry.summary)}</div>` : ''}
              </div>
            </label>
          `).join('')}
        </div>
      `;
    } else if (Array.isArray(cardData.items) && cardData.items.length > 0) {
      listMarkup = `
        <ul class="chat-action-list">
          ${cardData.items.map(it => `<li>${escapeHtml(it)}</li>`).join('')}
        </ul>
      `;
    }

    inner += `
      <div class="chat-action-card">
        <div class="chat-action-title">${escapeHtml(cardData.title)}</div>
        ${listMarkup}
        ${cardData.explanation ? `<div style="font-size:10px; color:var(--text-muted); margin-top:4px;"><img src="/img/icons/bulb.svg" class="pixel-icon inline" alt=""> ${escapeHtml(cardData.explanation)}</div>` : ''}
        <div class="chat-action-btns" style="display:flex; flex-wrap:wrap; gap:6px; margin-top:8px;">
          ${cardData.onAppendSelected ? `<button type="button" class="btn-chat-apply btn-chat-append-sel">Додати в поточний тест</button>` : ''}
          ${cardData.onCreateNewSelected ? `<button type="button" class="btn-chat-new btn-chat-create-sel">Створити як новий тест</button>` : ''}
          ${cardData.onReplaceSelected ? `<button type="button" class="btn-chat-new btn-chat-replace-sel">Замінити поточний</button>` : ''}
          ${cardData.onCopyText ? `<button type="button" class="btn-chat-new btn-chat-copy-text">Копіювати</button>` : ''}
          ${cardData.onCopyQuestion ? `<button type="button" class="btn-chat-new btn-chat-copy-q">Копіювати питання</button>` : ''}
          ${cardData.onCopyJson ? `<button type="button" class="btn-chat-new btn-chat-copy-json">JSON</button>` : ''}
          ${cardData.onApply ? `<button type="button" class="btn-chat-apply">Застосувати до поточного</button>` : ''}
          ${cardData.onAddNew ? `<button type="button" class="btn-chat-new">Додати як нове</button>` : ''}
        </div>
      </div>
    `;
  }

  inner += `</div>`;
  msg.innerHTML = inner;

  if (cardData) {
    const getSelectedQuestions = () => {
      if (!Array.isArray(cardData.selectableQuestions)) return [];
      const checked = Array.from(msg.querySelectorAll('.chat-q-select-cb:checked')).map(cb => parseInt(cb.dataset.idx, 10));
      return checked.map(i => cardData.selectableQuestions[i]?.question).filter(Boolean);
    };

    const appendSelBtn = msg.querySelector('.btn-chat-append-sel');
    const createSelBtn = msg.querySelector('.btn-chat-create-sel');
    const replaceSelBtn = msg.querySelector('.btn-chat-replace-sel');
    const copyTextBtn = msg.querySelector('.btn-chat-copy-text');
    const copyQBtn = msg.querySelector('.btn-chat-copy-q');
    const copyJsonBtn = msg.querySelector('.btn-chat-copy-json');
    const applyBtn = msg.querySelector('.btn-chat-apply:not(.btn-chat-append-sel)');
    const addBtn = msg.querySelector('.btn-chat-new:not(.btn-chat-create-sel):not(.btn-chat-replace-sel):not(.btn-chat-copy-text):not(.btn-chat-copy-q):not(.btn-chat-copy-json)');

    if (appendSelBtn && cardData.onAppendSelected) appendSelBtn.addEventListener('click', () => cardData.onAppendSelected(getSelectedQuestions()));
    if (createSelBtn && cardData.onCreateNewSelected) createSelBtn.addEventListener('click', () => cardData.onCreateNewSelected(getSelectedQuestions()));
    if (replaceSelBtn && cardData.onReplaceSelected) replaceSelBtn.addEventListener('click', () => cardData.onReplaceSelected(getSelectedQuestions()));
    if (copyTextBtn && cardData.onCopyText) copyTextBtn.addEventListener('click', cardData.onCopyText);
    if (copyQBtn && cardData.onCopyQuestion) copyQBtn.addEventListener('click', cardData.onCopyQuestion);
    if (copyJsonBtn && cardData.onCopyJson) copyJsonBtn.addEventListener('click', cardData.onCopyJson);
    if (applyBtn && cardData.onApply) applyBtn.addEventListener('click', cardData.onApply);
    if (addBtn && cardData.onAddNew) addBtn.addEventListener('click', cardData.onAddNew);
  }

  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

function appendTypingIndicator() {
  const container = document.getElementById('aiChatMessages');
  if (!container) return null;
  const id = 'typing_' + Date.now();
  const el = document.createElement('div');
  el.id = id;
  el.className = 'chat-msg assistant';
  el.innerHTML = `
    <div class="chat-msg-avatar"><img src="/img/icons/star.svg" class="pixel-icon inline" alt=""></div>
    <div class="chat-msg-bubble" style="display:flex; align-items:center; gap:6px; font-size:11px; color:var(--text-muted);">
      <div class="ai-spinner" style="width:12px; height:12px; border-width:2px;"></div>
      <span>Gemini формулює відповідь...</span>
    </div>
  `;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
  return id;
}

function removeTypingIndicator(id) {
  if (!id) return;
  const el = document.getElementById(id);
  if (el) el.remove();
}

function bindDeviceSwitcher() {
  const desktopBtn = document.getElementById('viewModeDesktopBtn');
  const mobileBtn = document.getElementById('viewModeMobileBtn');
  const desktopFrame = document.getElementById('desktopBrowserFrame');
  const mobileFrame = document.getElementById('mobilePhoneFrame');

  if (desktopBtn && mobileBtn) {
    desktopBtn.addEventListener('click', () => {
      desktopBtn.classList.add('active');
      mobileBtn.classList.remove('active');
      if (desktopFrame) desktopFrame.classList.remove('hidden');
      if (mobileFrame) mobileFrame.classList.add('hidden');
      updateLivePreview();
    });

    mobileBtn.addEventListener('click', () => {
      mobileBtn.classList.add('active');
      desktopBtn.classList.remove('active');
      if (desktopFrame) desktopFrame.classList.add('hidden');
      if (mobileFrame) mobileFrame.classList.remove('hidden');
      updateLivePreview();
    });
  }
}

function updateLivePreview() {
  const q = currentTest.questions[activeQuestionIndex];
  const questions = currentTest.questions || [];
  const qNumText = `Питання ${activeQuestionIndex + 1} з ${questions.length}`;

  const s = q ? (q.timeLimit || 60) : 60;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  const timerText = `${m < 10 ? '0' + m : m}:${rem < 10 ? '0' + rem : rem}`;

  const deskNum = document.getElementById('previewQNumberDesktop');
  const deskTimer = document.getElementById('previewQTimerDesktop');
  const deskTitle = document.getElementById('previewQTextDesktop');
  const deskImgWrap = document.getElementById('previewQImageWrapDesktop');
  const deskImg = document.getElementById('previewQImageDesktop');
  const deskOptions = document.getElementById('previewQOptionsDesktop');

  if (deskNum) deskNum.textContent = qNumText;
  if (deskTimer) deskTimer.innerHTML = '<img src="/img/icons/timer.svg" class="pixel-icon inline" alt=""> ' + timerText;
  if (deskTitle) {
    deskTitle.textContent = q ? (q.text || 'Текст запитання...') : 'Створіть запитання';
    if (window.renderMathInElement) {
      try {
        window.renderMathInElement(deskTitle, {
          delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }],
          throwOnError: false
        });
      } catch {}
    }
  }

  if (deskImgWrap && deskImg) {
    if (q && q.imageUrl) {
      deskImg.src = q.imageUrl;
      deskImgWrap.classList.remove('hidden');
    } else {
      deskImgWrap.classList.add('hidden');
    }
  }

  if (deskOptions) {
    deskOptions.innerHTML = '';
    renderOptionsListInto(deskOptions, q, false);
  }

  const mobNum = document.getElementById('previewQNumberMobile');
  const mobTimer = document.getElementById('previewQTimerMobile');
  const mobTitle = document.getElementById('previewQTextMobile');
  const mobImgWrap = document.getElementById('previewQImageWrapMobile');
  const mobImg = document.getElementById('previewQImageMobile');
  const mobOptions = document.getElementById('previewQOptionsMobile');

  if (mobNum) mobNum.textContent = `Завдання ${activeQuestionIndex + 1} з ${questions.length}`;
  if (mobTimer) mobTimer.textContent = timerText;
  if (mobTitle) {
    mobTitle.textContent = q ? (q.text || 'Текст запитання...') : 'Створіть запитання';
    if (window.renderMathInElement) {
      try {
        window.renderMathInElement(mobTitle, {
          delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }],
          throwOnError: false
        });
      } catch {}
    }
  }

  if (mobImgWrap && mobImg) {
    if (q && q.imageUrl) {
      mobImg.src = q.imageUrl;
      mobImgWrap.classList.remove('hidden');
    } else {
      mobImgWrap.classList.add('hidden');
    }
  }

  if (mobOptions) {
    mobOptions.innerHTML = '';
    renderOptionsListInto(mobOptions, q, true);
  }
}

function renderOptionsListInto(container, q, isMobile) {
  if (!q) return;

  if (q.type === 'matching') {
    const pairs = q.matchingPairs || [];
    pairs.forEach((p, idx) => {
      const item = document.createElement('div');
      item.className = isMobile ? 'phone-opt-btn' : 'student-opt-pill';
      item.innerHTML = `<strong>${idx + 1}. ${escapeHtml(p.left)}</strong> → <span>${escapeHtml(p.right)}</span>`;
      container.appendChild(item);
    });
  } else if (q.type === 'fill_blanks') {
    const note = document.createElement('div');
    note.className = isMobile ? 'phone-opt-btn' : 'student-opt-pill';
    note.style.fontStyle = 'italic';
    note.textContent = 'Учень вводитиме пропущені слова в інтерактивні поля.';
    container.appendChild(note);
  } else if (q.type === 'short_answer' || q.type === 'numeric') {
    const inputDemo = document.createElement('input');
    inputDemo.className = 'form-input';
    inputDemo.placeholder = q.type === 'numeric' ? 'Числове поле для вводу (напр. 9.8)...' : 'Поле для вводу учнем...';
    inputDemo.disabled = true;
    inputDemo.style.fontSize = isMobile ? '11px' : '12px';
    container.appendChild(inputDemo);
  } else {
    const opts = q.options || [];
    opts.forEach(opt => {
      const pill = document.createElement('div');
      pill.className = isMobile ? 'phone-opt-btn' : 'student-opt-pill';
      const shape = q.type === 'multiple' ? 'border-radius:4px;' : 'border-radius:50%;';
      pill.innerHTML = `<span style="width:14px; height:14px; border:2px solid var(--border-active); ${shape} display:inline-block; flex-shrink:0;"></span> <span>${escapeHtml(opt)}</span>`;
      container.appendChild(pill);
    });
  }
}

function bindMassImportModal() {
  const openBtn = document.getElementById('openImportModalBtn');
  const modal = document.getElementById('massImportModal');
  const closeBtn = document.getElementById('closeImportModalBtn');
  const textarea = document.getElementById('importRawTextarea');
  const countLabel = document.getElementById('importParsedCount');
  const appendBtn = document.getElementById('importAppendBtn');
  const replaceBtn = document.getElementById('importReplaceBtn');

  if (openBtn && modal) {
    openBtn.addEventListener('click', () => {
      modal.classList.remove('hidden');
      parseAndShowStats();
    });
  }
  const close = () => { if (modal) modal.classList.add('hidden'); };
  if (closeBtn) closeBtn.addEventListener('click', close);

  const parseAndShowStats = () => {
    if (!textarea || !countLabel) return;
    const parsed = parseRawTestText(textarea.value);
    countLabel.textContent = `Розпізнано питань: ${parsed.length}`;
  };

  if (textarea) textarea.addEventListener('input', parseAndShowStats);

  const applyImport = (replace) => {
    if (!textarea) return;
    const parsed = parseRawTestText(textarea.value);
    if (parsed.length === 0) {
      showToast('Не вдалося розпізнати питання у тексті');
      return;
    }
    recordUndoSnapshot();
    if (replace) {
      currentTest.questions = parsed;
      activeQuestionIndex = 0;
    } else {
      currentTest.questions.push(...parsed);
      activeQuestionIndex = currentTest.questions.length - parsed.length;
    }
    close();
    renderQuestionsNav();
    loadQuestionIntoEditor(activeQuestionIndex);
    updateTestAnalytics();
    saveDraftToStorage();
    showToast(`Успішно імпортовано ${parsed.length} питань!`);
  };

  if (appendBtn) appendBtn.addEventListener('click', () => applyImport(false));
  if (replaceBtn) replaceBtn.addEventListener('click', () => applyImport(true));
}

function parseRawTestText(raw) {
  if (!raw || !raw.trim()) return [];
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const questions = [];
  let currentQ = null;

  lines.forEach(line => {
    const isNewQ = /^(\d+)[\.\)]\s*(.+)/i.test(line);
    const isOpt = /^([А-ЯA-Zа-яa-z0-9])[\.\)]\s*(.+)/i.test(line);

    if (isNewQ) {
      if (currentQ && currentQ.text) {
        questions.push(currentQ);
      }
      const match = line.match(/^(\d+)[\.\)]\s*(.+)/i);
      currentQ = {
        id: 'q_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        text: match ? match[2].trim() : line,
        type: 'single',
        options: [],
        correct: 0,
        points: 1,
        timeLimit: 60,
        imageUrl: '',
        explanation: ''
      };
    } else if (isOpt && currentQ) {
      let isCorrect = line.includes('*') || line.includes('+');
      let optText = line.replace(/^([А-ЯA-Zа-яa-z0-9])[\.\)]\s*/i, '').replace(/[\*\+]/g, '').trim();
      currentQ.options.push(optText);
      if (isCorrect) {
        currentQ.correct = currentQ.options.length - 1;
      }
    } else if (currentQ) {
      currentQ.text += ' ' + line;
    }
  });

  if (currentQ && currentQ.text) {
    questions.push(currentQ);
  }

  questions.forEach(q => {
    if (q.options.length === 0) {
      q.type = 'short_answer';
      q.correct = [];
    }
  });

  return questions;
}

function bindAiGeneratorModal() {
  const openBtn = document.getElementById('openAiGenModalBtn');
  const modal = document.getElementById('aiGenModal');
  if (openBtn) openBtn.classList.remove('hidden');

  const closeBtn = document.getElementById('closeAiModalBtn');
  const cancelBtn = document.getElementById('cancelAiGenBtn');
  const startBtn = document.getElementById('startAiGenBtn');
  const stopBatchBtn = document.getElementById('stopAiBatchBtn');
  const retryBtn = document.getElementById('retryAiGenBtn');
  const topicInput = document.getElementById('aiTopicInput');
  const subjectInput = document.getElementById('aiSubjectInput');
  const countInput = document.getElementById('aiCountInput');
  const timeLimitInput = document.getElementById('aiTimeLimitInput');
  const presetsContainer = document.getElementById('aiCountPresets');
  const gradeInput = document.getElementById('aiGradeInput');
  const diffSelect = document.getElementById('aiDifficultySelect');
  const typesGrid = document.getElementById('aiTypesGrid');
  const numTolWrap = document.getElementById('aiNumericTolHintWrap');
  const numTolSelect = document.getElementById('aiNumericTolSelect');
  const sourceInput = document.getElementById('aiSourceTextInput');
  const sourceFileInput = document.getElementById('aiSourceFileInput');
  const clearSourceBtn = document.getElementById('aiClearSourceBtn');
  const sourceBadge = document.getElementById('aiSourceStatusBadge');
  const customInstInput = document.getElementById('aiCustomInstructionsInput');
  const errorBox = document.getElementById('aiGenErrorBox');
  const errorTextEl = document.getElementById('aiGenErrorText');
  const progressWrap = document.getElementById('aiGenProgressWrap');
  const progressText = document.getElementById('aiProgressText');
  const progressPercent = document.getElementById('aiProgressPercent');
  const progressFill = document.getElementById('aiProgressFill');
  const progressBatchMeta = document.getElementById('aiProgressBatchMeta');

  const configStep = document.getElementById('aiGenConfigStep');
  const previewStep = document.getElementById('aiGenPreviewStep');
  const footerConfig = document.getElementById('aiGenFooterConfig');
  const footerPreview = document.getElementById('aiGenFooterPreview');
  const previewSummaryText = document.getElementById('aiPreviewSummaryText');
  const previewSelectAll = document.getElementById('aiPreviewSelectAll');
  const previewListEl = document.getElementById('aiPreviewCardsList');
  const backToConfigBtn = document.getElementById('aiBackToConfigBtn');
  const applyAppendBtn = document.getElementById('aiApplyAppendBtn');
  const applyReplaceBtn = document.getElementById('aiApplyReplaceBtn');
  const applyNewTestBtn = document.getElementById('aiApplyNewTestBtn');

  let generatedPreviewItems = [];
  let generatedTestTitle = '';
  let lastRunParams = null;
  let batchAbortController = null;
  let stopRequested = false;

  const updateSourceBadge = () => {
    const len = sourceInput ? sourceInput.value.trim().length : 0;
    if (sourceBadge) {
      sourceBadge.textContent = len > 0 ? `${len.toLocaleString('uk-UA')} симв.` : '';
    }
    if (clearSourceBtn) {
      clearSourceBtn.classList.toggle('hidden', len === 0);
    }
  };

  const getSelectedTypes = () => {
    if (!typesGrid) return ['single'];
    const checked = Array.from(typesGrid.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
    return checked.length > 0 ? checked : ['single'];
  };

  const syncNumericHintVisibility = () => {
    const types = getSelectedTypes();
    if (numTolWrap) numTolWrap.classList.toggle('hidden', !types.includes('numeric'));
  };

  const showStep = (step) => {
    const isPreview = step === 'preview';
    if (configStep) configStep.classList.toggle('hidden', isPreview);
    if (footerConfig) footerConfig.classList.toggle('hidden', isPreview);
    if (previewStep) previewStep.classList.toggle('hidden', !isPreview);
    if (footerPreview) footerPreview.classList.toggle('hidden', !isPreview);
  };

  const setProgress = (percent, text, meta = '') => {
    const pct = Math.max(0, Math.min(100, Math.round(percent)));
    if (progressFill) progressFill.style.width = `${pct}%`;
    if (progressPercent) progressPercent.textContent = `${pct}%`;
    if (progressText && text) progressText.textContent = text;
    if (progressBatchMeta) progressBatchMeta.textContent = meta;
  };

  const showConfigError = (message) => {
    if (errorBox && errorTextEl) {
      errorTextEl.textContent = message;
      errorBox.classList.remove('hidden');
    } else {
      showToast(message);
    }
  };

  const hideConfigError = () => {
    if (errorBox) errorBox.classList.add('hidden');
  };

  const updatePreviewSummary = () => {
    const total = generatedPreviewItems.length;
    const selected = generatedPreviewItems.filter(it => it.selected).length;
    if (previewSummaryText) {
      previewSummaryText.textContent = `Обрано ${selected} з ${total} згенерованих питань`;
    }
    if (previewSelectAll) {
      previewSelectAll.checked = total > 0 && selected === total;
      previewSelectAll.indeterminate = selected > 0 && selected < total;
    }
    const disabled = selected === 0;
    if (applyAppendBtn) applyAppendBtn.disabled = disabled;
    if (applyReplaceBtn) applyReplaceBtn.disabled = disabled;
    if (applyNewTestBtn) applyNewTestBtn.disabled = disabled;
  };

  const regeneratePreviewItem = async (idx, tweak) => {
    const entry = generatedPreviewItems[idx];
    if (!entry) return;
    const card = previewListEl?.querySelector(`.ai-preview-card[data-idx="${idx}"]`);
    const btns = card ? Array.from(card.querySelectorAll('.ai-q-mini-btn')) : [];
    btns.forEach(b => { b.disabled = true; });
    try {
      const token = localStorage.getItem('admin_token') || '';
      const tolRaw = numTolSelect ? numTolSelect.value : 'auto';
      const numericToleranceHint = tolRaw === 'auto' ? undefined : Number(tolRaw);
      const excludeQuestions = generatedPreviewItems.map(it => it.question.text);
      const res = await fetch('/api/admin/ai/regenerate-question', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': token
        },
        body: JSON.stringify({
          topic: lastRunParams?.topic || (topicInput ? topicInput.value.trim() : ''),
          subject: lastRunParams?.subject || (subjectInput ? subjectInput.value.trim() : ''),
          grade: lastRunParams?.grade || (gradeInput ? gradeInput.value.trim() : ''),
          difficulty: lastRunParams?.difficulty || (diffSelect ? diffSelect.value : 'medium'),
          sourceText: lastRunParams?.sourceText || '',
          question: entry.question,
          tweak,
          allowedTypes: [entry.question.type],
          excludeQuestions,
          timeLimitSeconds: entry.question.timeLimitSeconds || 60,
          numericToleranceHint
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success || !data.question) {
        throw new Error(data.error || 'Не вдалося перегенерувати питання');
      }
      const norm = normalizeStudioQuestion(data.question, entry.question.timeLimitSeconds || 60);
      if (!norm) throw new Error('Отримано некоректний формат питання');
      generatedPreviewItems[idx] = { question: norm, selected: true };
      renderPreviewCards();
      showToast(tweak === 'replace' ? `Питання #${idx + 1} замінено!` : `Складність питання #${idx + 1} оновлено!`);
    } catch (err) {
      showToast(err.message);
      btns.forEach(b => { b.disabled = false; });
    }
  };

  const renderPreviewCards = () => {
    if (!previewListEl) return;
    previewListEl.innerHTML = '';
    generatedPreviewItems.forEach((entry, idx) => {
      const q = entry.question;
      const card = document.createElement('div');
      card.className = 'ai-preview-card' + (entry.selected ? '' : ' is-unchecked');
      card.dataset.idx = idx;

      const summaryLines = formatQuestionSummaryLines(q);
      const typeLabel = STUDIO_TYPE_LABELS[q.type] || q.type;

      card.innerHTML = `
        <div class="ai-preview-card-head">
          <label class="ai-preview-title-wrap" style="cursor:pointer;">
            <input type="checkbox" class="ai-preview-item-cb" data-idx="${idx}" ${entry.selected ? 'checked' : ''} style="margin-top:3px; accent-color:var(--accent);">
            <div style="min-width:0;">
              <div style="font-size:12.5px; font-weight:700; color:var(--text); line-height:1.4;">
                ${idx + 1}. ${escapeHtml(q.text)}
                <span class="tag-badge" style="font-size:10px; margin-left:6px; vertical-align:middle;">${escapeHtml(typeLabel)}</span>
              </div>
            </div>
          </label>
          <div class="ai-preview-q-actions">
            <button type="button" class="ai-q-mini-btn" data-action="replace" title="Замінити іншим питанням">Перегенерувати</button>
            <button type="button" class="ai-q-mini-btn" data-action="harder" title="Ускладнити це питання">Складніше</button>
            <button type="button" class="ai-q-mini-btn" data-action="easier" title="Спростити це питання">Простіше</button>
          </div>
        </div>
        <div class="ai-preview-details">
          ${summaryLines.map(line => `<div>${escapeHtml(line)}</div>`).join('')}
          ${q.explanation ? `<div style="margin-top:4px; color:var(--accent); font-size:11px;">Пояснення: ${escapeHtml(q.explanation)}</div>` : ''}
        </div>
      `;

      const cb = card.querySelector('.ai-preview-item-cb');
      if (cb) {
        cb.addEventListener('change', () => {
          generatedPreviewItems[idx].selected = cb.checked;
          card.classList.toggle('is-unchecked', !cb.checked);
          updatePreviewSummary();
        });
      }
      card.querySelectorAll('.ai-q-mini-btn').forEach(btn => {
        btn.addEventListener('click', () => regeneratePreviewItem(idx, btn.dataset.action));
      });
      previewListEl.appendChild(card);
    });
    updatePreviewSummary();
  };

  if (presetsContainer && countInput) {
    presetsContainer.addEventListener('click', e => {
      const btn = e.target.closest('.preset-chip');
      if (!btn) return;
      const cnt = btn.getAttribute('data-count');
      countInput.value = cnt;
      presetsContainer.querySelectorAll('.preset-chip').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
    });
    countInput.addEventListener('input', () => {
      const val = countInput.value;
      presetsContainer.querySelectorAll('.preset-chip').forEach(c => {
        c.classList.toggle('active', c.getAttribute('data-count') === val);
      });
    });
  }

  if (typesGrid) {
    typesGrid.addEventListener('change', syncNumericHintVisibility);
    syncNumericHintVisibility();
  }

  if (sourceInput) {
    sourceInput.addEventListener('input', updateSourceBadge);
  }
  if (clearSourceBtn && sourceInput) {
    clearSourceBtn.addEventListener('click', () => {
      sourceInput.value = '';
      if (sourceFileInput) sourceFileInput.value = '';
      updateSourceBadge();
    });
  }
  if (sourceFileInput && sourceInput) {
    sourceFileInput.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const name = (file.name || '').toLowerCase();
      hideConfigError();
      try {
        if (name.endsWith('.docx') || name.endsWith('.pdf')) {
          if (file.size > 10 * 1024 * 1024) {
            throw new Error('Файл завеликий (максимум 10 МБ)');
          }
          if (sourceBadge) sourceBadge.textContent = name.endsWith('.pdf') ? 'Читаю PDF через Gemini...' : 'Витягую текст із DOCX...';
          const base64Data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('Помилка читання файлу'));
            reader.readAsDataURL(file);
          });
          const token = localStorage.getItem('admin_token') || '';
          const res = await fetch('/api/admin/extract-document-text', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-admin-token': token
            },
            body: JSON.stringify({
              fileName: file.name,
              mimeType: file.type,
              base64Data
            })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.success) {
            throw new Error(data.error || 'Не вдалося прочитати документ');
          }
          sourceInput.value = data.text || '';
          updateSourceBadge();
          showToast(data.truncated ? `Завантажено перші ${data.charCount} символів із "${file.name}"` : `Матеріал з "${file.name}" завантажено!`);
        } else {
          const textContent = await file.text();
          sourceInput.value = String(textContent || '').slice(0, 35000);
          updateSourceBadge();
          showToast(`Файл "${file.name}" завантажено!`);
        }
      } catch (err) {
        updateSourceBadge();
        showConfigError(err.message);
      } finally {
        sourceFileInput.value = '';
      }
    });
  }

  const openModal = (prefillTopic = '') => {
    if (!modal) return;
    hideConfigError();
    showStep('config');
    if (progressWrap) progressWrap.classList.add('hidden');
    if (stopBatchBtn) stopBatchBtn.classList.add('hidden');
    if (topicInput) topicInput.value = prefillTopic || currentTest?.topic || '';
    if (subjectInput && currentTest?.subject) subjectInput.value = currentTest.subject;
    if (gradeInput && currentTest?.class) gradeInput.value = currentTest.class;
    updateSourceBadge();
    syncNumericHintVisibility();
    modal.classList.remove('hidden');
  };

  window.openStudioAiGenerator = openModal;

  if (openBtn && modal) {
    openBtn.addEventListener('click', () => openModal(''));
  }

  const close = () => {
    if (batchAbortController) {
      batchAbortController.abort();
      batchAbortController = null;
    }
    if (modal) modal.classList.add('hidden');
  };
  if (closeBtn) closeBtn.addEventListener('click', close);
  if (cancelBtn) cancelBtn.addEventListener('click', close);
  if (backToConfigBtn) {
    backToConfigBtn.addEventListener('click', () => showStep('config'));
  }
  if (previewSelectAll) {
    previewSelectAll.addEventListener('change', () => {
      const checked = previewSelectAll.checked;
      generatedPreviewItems.forEach(it => { it.selected = checked; });
      renderPreviewCards();
    });
  }
  if (stopBatchBtn) {
    stopBatchBtn.addEventListener('click', () => {
      stopRequested = true;
      if (batchAbortController) batchAbortController.abort();
    });
  }

  const runGeneration = async () => {
    const topic = topicInput ? topicInput.value.trim() : '';
    const sourceText = sourceInput ? sourceInput.value.trim() : '';
    if (!topic && !sourceText) {
      showConfigError('Вкажіть тему тесту або вставте / завантажте опорний конспект!');
      if (topicInput) topicInput.focus();
      return;
    }

    const subject = subjectInput ? subjectInput.value.trim() : '';
    const grade = gradeInput ? (gradeInput.value.trim() || '10-11 клас') : '10-11 клас';
    const difficulty = diffSelect ? diffSelect.value : 'medium';
    const count = Math.min(50, Math.max(1, parseInt(countInput ? countInput.value : '5', 10) || 5));
    const timeLimitSeconds = Math.min(600, Math.max(10, parseInt(timeLimitInput ? timeLimitInput.value : '60', 10) || 60));
    const customInstructions = customInstInput ? customInstInput.value.trim() : '';
    const questionTypes = getSelectedTypes();
    const tolRaw = numTolSelect ? numTolSelect.value : 'auto';
    const numericToleranceHint = tolRaw === 'auto' ? undefined : Number(tolRaw);

    lastRunParams = { topic, sourceText, subject, grade, difficulty, count, timeLimitSeconds, customInstructions, questionTypes, numericToleranceHint };

    hideConfigError();
    if (progressWrap) progressWrap.classList.remove('hidden');
    if (startBtn) startBtn.disabled = true;
    stopRequested = false;

    const batchSizes = [];
    let left = count;
    while (left > 0) {
      const chunk = Math.min(10, left);
      batchSizes.push(chunk);
      left -= chunk;
    }
    if (stopBatchBtn) {
      stopBatchBtn.classList.toggle('hidden', batchSizes.length < 2);
    }

    const collected = [];
    let finalTitle = topic || 'Тест за конспектом';
    const existingPool = Array.isArray(currentTest?.questions) ? currentTest.questions.map(q => q.text).filter(Boolean) : [];
    const token = localStorage.getItem('admin_token') || '';

    try {
      for (let bIdx = 0; bIdx < batchSizes.length; bIdx++) {
        if (stopRequested) break;
        const batchCount = batchSizes[bIdx];
        const basePct = (collected.length / count) * 100;
        setProgress(
          Math.max(8, basePct),
          `Партія ${bIdx + 1} з ${batchSizes.length}: генеруємо ${batchCount} пит...`,
          `Згенеровано ${collected.length} із ${count} питань`
        );

        batchAbortController = new AbortController();
        const res = await fetch('/api/admin/generate-test', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-token': token
          },
          signal: batchAbortController.signal,
          body: JSON.stringify({
            topic,
            subject,
            grade,
            difficulty,
            count: batchCount,
            timeLimitSeconds,
            customInstructions,
            sourceText,
            questionTypes,
            numericToleranceHint,
            excludeQuestions: [...existingPool, ...collected.map(q => q.text)],
            applyToTest: false
          })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success || !Array.isArray(data.questions)) {
          throw new Error(data.error || 'Помилка генерації через Gemini API');
        }
        if (bIdx === 0 && data.title) {
          finalTitle = data.title;
        }
        for (const rawQ of data.questions) {
          const norm = normalizeStudioQuestion(rawQ, timeLimitSeconds, numericToleranceHint);
          if (norm) collected.push(norm);
        }
        setProgress(
          (collected.length / count) * 100,
          bIdx + 1 < batchSizes.length
            ? `Готово ${collected.length} із ${count}. Перехід до наступної партії...`
            : `Успішно згенеровано ${collected.length} питань!`,
          `Завершено партій: ${bIdx + 1} з ${batchSizes.length}`
        );
      }
    } catch (err) {
      if (err.name === 'AbortError' && collected.length > 0) {
        showToast(`Генерацію зупинено: збережено ${collected.length} готових питань`);
      } else {
        if (progressWrap) progressWrap.classList.add('hidden');
        if (stopBatchBtn) stopBatchBtn.classList.add('hidden');
        if (startBtn) startBtn.disabled = false;
        showConfigError(err.name === 'AbortError' ? 'Генерацію скасовано' : err.message);
        return;
      }
    } finally {
      batchAbortController = null;
      if (startBtn) startBtn.disabled = false;
      if (stopBatchBtn) stopBatchBtn.classList.add('hidden');
    }

    if (progressWrap) progressWrap.classList.add('hidden');
    if (collected.length === 0) {
      showConfigError('Gemini не сформував жодного валідного питання. Спробуйте уточнити тему або формати.');
      return;
    }

    generatedTestTitle = finalTitle;
    generatedPreviewItems = collected.map(q => ({ question: q, selected: true }));
    renderPreviewCards();
    showStep('preview');
  };

  if (startBtn) startBtn.addEventListener('click', runGeneration);
  if (retryBtn) retryBtn.addEventListener('click', runGeneration);

  const getSelectedPreviewQuestions = () => generatedPreviewItems.filter(it => it.selected).map(it => JSON.parse(JSON.stringify(it.question)));

  if (applyAppendBtn) {
    applyAppendBtn.addEventListener('click', async () => {
      const selected = getSelectedPreviewQuestions();
      if (selected.length === 0) return;
      recordUndoSnapshot();
      if (!Array.isArray(currentTest.questions)) currentTest.questions = [];
      const firstAddedIdx = currentTest.questions.length;
      currentTest.questions.push(...selected);
      activeQuestionIndex = firstAddedIdx;
      close();
      syncMetaHeader();
      renderQuestionsNav();
      loadQuestionIntoEditor(activeQuestionIndex);
      updateTestAnalytics();
      await persistStudioTestToServer();
      showToast(`Додано ${selected.length} питань до тесту!`);
    });
  }

  if (applyReplaceBtn) {
    applyReplaceBtn.addEventListener('click', async () => {
      const selected = getSelectedPreviewQuestions();
      if (selected.length === 0) return;
      recordUndoSnapshot();
      currentTest.questions = selected;
      activeQuestionIndex = 0;
      close();
      syncMetaHeader();
      renderQuestionsNav();
      loadQuestionIntoEditor(0);
      updateTestAnalytics();
      await persistStudioTestToServer();
      showToast(`Питання тесту замінено (${selected.length} шт.)!`);
    });
  }

  if (applyNewTestBtn) {
    applyNewTestBtn.addEventListener('click', async () => {
      const selected = getSelectedPreviewQuestions();
      if (selected.length === 0) return;
      applyNewTestBtn.disabled = true;
      try {
        const token = localStorage.getItem('admin_token') || '';
        const res = await fetch('/api/admin/tests', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-token': token
          },
          body: JSON.stringify({
            title: generatedTestTitle || topicInput?.value.trim() || 'Новий ШІ-тест',
            subject: subjectInput?.value.trim() || currentTest?.subject || 'Загальний',
            topic: topicInput?.value.trim() || '',
            durationMinutes: Math.max(10, Math.round(selected.length * 1.5)),
            questions: selected
          })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Помилка створення тесту');
        close();
        if (typeof window.refreshAdminTestsList === 'function') {
          await window.refreshAdminTestsList();
        }
        if (typeof window.selectAndOpenAdminTest === 'function') {
          await window.selectAndOpenAdminTest(data.id);
        } else {
          loadTestIntoStudio(data);
        }
        showToast(`Створено новий тест "${data.title}" (${selected.length} пит.)!`);
      } catch (err) {
        showToast(err.message);
      } finally {
        applyNewTestBtn.disabled = false;
      }
    });
  }
}

function bindFullPreviewModal() {
  const openBtn = document.getElementById('previewWholeTestBtn');
  const modal = document.getElementById('studentPreviewModal');
  const closeBtn = document.getElementById('closeFullPreviewBtn');
  const titleEl = document.getElementById('fullPreviewTitle');
  const subEl = document.getElementById('fullPreviewSubtitle');
  const listEl = document.getElementById('fullPreviewQuestionsList');

  if (openBtn && modal) {
    openBtn.addEventListener('click', () => {
      if (titleEl) titleEl.textContent = currentTest.name || 'Тест SecureExam';
      if (subEl) subEl.textContent = `${currentTest.questions.length} питань • ${currentTest.durationMinutes || 15} хв • Тема: ${currentTest.topic || '-'}`;
      if (listEl) {
        listEl.innerHTML = '';
        currentTest.questions.forEach((q, idx) => {
          const card = document.createElement('div');
          card.className = 'card-panel';
          card.style.padding = '14px';
          card.innerHTML = `
            <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:11px;">
              <strong style="color:var(--accent);">Питання #${idx + 1}</strong>
              <span style="color:var(--text-muted);">${q.points || 1} бал. • ${q.timeLimit || 60} с</span>
            </div>
            <div style="font-weight:600; font-size:13px; margin-bottom:10px;">${escapeHtml(q.text)}</div>
            <div style="display:flex; flex-direction:column; gap:6px;">
              ${(q.options || []).map(opt => `<div class="student-opt-pill" style="cursor:default;">• ${escapeHtml(opt)}</div>`).join('')}
            </div>
          `;
          listEl.appendChild(card);
        });
      }
      modal.classList.remove('hidden');
    });
  }

  if (closeBtn && modal) {
    closeBtn.addEventListener('click', () => {
      modal.classList.add('hidden');
    });
  }
}

let cachedQrDataUrl = '';

function bindPrintExportModal() {
  const openBtn = document.getElementById('printTestModalBtn');
  const modal = document.getElementById('printExportModal');
  const closeBtn = document.getElementById('closePrintModalBtn');
  const cancelBtn = document.getElementById('cancelPrintBtn');
  const downloadWordBtn = document.getElementById('downloadWordBtn');
  const executePrintBtn = document.getElementById('executePrintBtn');
  const previewContainer = document.getElementById('printSheetPreview');

  const optStudent = document.getElementById('printOptStudentInfo');
  const optKey = document.getElementById('printOptAnswerKey');
  const optQr = document.getElementById('printOptQrCode');
  const optPoints = document.getElementById('printOptPoints');
  const optTwoCols = document.getElementById('printOptTwoCols');

  const letters = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Є', 'Ж', 'З', 'И'];

  const getOnlineUrl = () => {
    return window.location.href.split('?')[0].replace('/test-studio', '/');
  };

  const refreshQrCode = (cb) => {
    if (typeof QRCode !== 'undefined' && QRCode.toDataURL) {
      QRCode.toDataURL(getOnlineUrl(), { width: 100, margin: 1 }, (err, url) => {
        if (!err && url) cachedQrDataUrl = url;
        if (cb) cb();
      });
    } else {
      if (cb) cb();
    }
  };

  const calculateTotalScore = () => {
    return (currentTest.questions || []).reduce((acc, q) => acc + (parseInt(q.points) || 1), 0);
  };

  const generateSheetHtml = (forWord = false) => {
    const totalScore = calculateTotalScore();
    const questions = currentTest.questions || [];
    const showStudent = optStudent ? optStudent.checked : true;
    const showKey = optKey ? optKey.checked : true;
    const showQr = optQr ? optQr.checked : true;
    const showPoints = optPoints ? optPoints.checked : true;
    const twoCols = optTwoCols ? optTwoCols.checked : false;

    let html = '';

    html += `
      <div style="text-align: center; margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid #d1d5db;">
        <h2 style="font-size: 16px; font-weight: 800; margin: 0 0 4px 0; color: #111827; text-transform: uppercase; letter-spacing: 0.02em;">
          ${escapeHtml(currentTest.name || 'Тест')}
        </h2>
        <div style="font-size: 11px; color: #4b5563;">
          Предмет: <strong>${escapeHtml(currentTest.subject || 'Предмет')}</strong> • Тема: <strong>${escapeHtml(currentTest.topic || 'Загальна')}</strong> • Час: <strong>${currentTest.durationMinutes || 15} хв</strong> • Загальний бал: <strong>${totalScore} б.</strong>
        </div>
      </div>
    `;

    if (showStudent) {
      html += `
        <div style="border: 1.5px solid #1f2937; border-radius: 4px; padding: 8px 12px; margin-bottom: 16px; font-size: 11px; background: ${forWord ? '#ffffff' : '#f9fafb'};">
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <span style="flex: 2;">Прізвище та ім'я учня: _________________________________________</span>
            <span style="flex: 1; text-align: right;">Клас: ________________</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span style="flex: 1;">Дата проведення: ________________</span>
            <span style="flex: 1; text-align: right;">Оцінка / Бали: _______ / ${totalScore}</span>
          </div>
        </div>
      `;
    }

    html += `<div style="font-size: 10.5px; font-style: italic; color: #6b7280; margin-bottom: 14px;">
      Інструкція: Уважно прочитайте завдання та позначте правильну відповідь. У відкритих завданнях запишіть відповідь у відведеному рядку.
    </div>`;

    const colsClass = twoCols && !forWord ? 'print-sheet-two-cols' : '';
    html += `<div class="${colsClass}">`;

    questions.forEach((q, idx) => {
      const qNum = idx + 1;
      const pointsLabel = showPoints ? `<span style="font-size: 10px; font-weight: 700; color: #4b5563; margin-left: 6px;">[${q.points || 1} б.]</span>` : '';

      html += `
        <div class="print-question-item" style="margin-bottom: 14px; page-break-inside: avoid; break-inside: avoid;">
          <div style="font-weight: 700; font-size: 12px; margin-bottom: 6px; color: #111827;">
            ${qNum}. ${escapeHtml(q.text)}${pointsLabel}
          </div>
      `;

      if (q.imageUrl) {
        html += `<img src="${q.imageUrl}" style="max-height: 120px; max-width: 100%; border-radius: 4px; margin: 4px 0 8px 12px; display: block;" alt="">`;
      }

      if (q.type === 'single') {
        (q.options || []).forEach((opt, oIdx) => {
          const letter = letters[oIdx] || String(oIdx + 1);
          if (forWord) {
            html += `<div style="margin-left: 14pt; margin-bottom: 2pt; font-size: 10.5pt;">(  ) <strong>${letter}.</strong> ${escapeHtml(opt)}</div>`;
          } else {
            html += `
              <div class="print-option-row">
                <span class="print-circle"></span>
                <span><strong>${letter}.</strong> ${escapeHtml(opt)}</span>
              </div>
            `;
          }
        });
      } else if (q.type === 'multiple') {
        (q.options || []).forEach((opt, oIdx) => {
          const letter = letters[oIdx] || String(oIdx + 1);
          if (forWord) {
            html += `<div style="margin-left: 14pt; margin-bottom: 2pt; font-size: 10.5pt;">[  ] <strong>${letter}.</strong> ${escapeHtml(opt)}</div>`;
          } else {
            html += `
              <div class="print-option-row">
                <span class="print-box"></span>
                <span><strong>${letter}.</strong> ${escapeHtml(opt)}</span>
              </div>
            `;
          }
        });
      } else if (q.type === 'text' || q.type === 'short_answer' || q.type === 'numeric') {
        html += `
          <div style="margin: 6px 0 8px 12px; font-size: 11px; color: #374151;">
            Відповідь: __________________________________________________________________________________
          </div>
        `;
      } else if (q.type === 'ordering') {
        (q.options || []).forEach((opt, oIdx) => {
          html += `<div style="margin-left: 14px; margin-bottom: 2px; font-size: 11px;">${oIdx + 1}) ${escapeHtml(opt)}</div>`;
        });
        html += `<div style="margin-left: 14px; margin-top: 5px; font-weight: 600; font-size: 11px;">Черговість: [ 1 ] ______  [ 2 ] ______  [ 3 ] ______  [ 4 ] ______</div>`;
      } else if (q.type === 'matching') {
        (q.options || []).forEach((opt, oIdx) => {
          html += `<div style="margin-left: 14px; margin-bottom: 2px; font-size: 11px;">${oIdx + 1}. ${escapeHtml(opt)}</div>`;
        });
        html += `<div style="margin-left: 14px; margin-top: 5px; font-size: 11px;">Відповідність: 1 - ___, 2 - ___, 3 - ___, 4 - ___</div>`;
      } else {
        (q.options || []).forEach((opt, oIdx) => {
          html += `<div style="margin-left: 14px; margin-bottom: 2px; font-size: 11px;">• ${escapeHtml(opt)}</div>`;
        });
      }

      html += `</div>`;
    });

    html += `</div>`;

    if (showKey) {
      const pageBreakStyle = forWord
        ? 'page-break-before: always; mso-break-type: section-break; margin-top: 30pt; padding-top: 15pt; border-top: 2pt solid #000;'
        : 'page-break-before: always; break-before: page; margin-top: 28px; padding-top: 20px; border-top: 2px dashed #9ca3af;';

      html += `
        <div class="print-key-page" style="${pageBreakStyle}">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; flex-wrap: wrap; gap: 10px;">
            <div>
              <div style="font-size: 14px; font-weight: 800; color: #111827; text-transform: uppercase; letter-spacing: 0.04em;">
                <img src="/img/icons/key.svg" class="pixel-icon inline" alt=""> Ключ правильних відповідей та критерії (для вчителя)
              </div>
              <div style="font-size: 11px; color: #4b5563; margin-top: 2px;">
                Тест: <strong>${escapeHtml(currentTest.name || 'Тест')}</strong> • Кількість питань: <strong>${questions.length}</strong> • Макс. бал: <strong>${totalScore} б.</strong>
              </div>
            </div>
            ${showQr && cachedQrDataUrl ? `
              <div style="text-align: center; flex-shrink: 0;">
                <img src="${cachedQrDataUrl}" width="90" height="90" style="display: block; border: 1px solid #d1d5db; border-radius: 4px;" alt="QR">
                <span style="font-size: 9px; color: #6b7280; display: block; margin-top: 2px;">Онлайн-тест</span>
              </div>
            ` : ''}
          </div>

          <table class="print-key-table" style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px;">
            <thead>
              <tr style="background: #f3f4f6;">
                <th style="border: 1px solid #d1d5db; padding: 6px 8px; width: 34px; text-align: center;">№</th>
                <th style="border: 1px solid #d1d5db; padding: 6px 8px; width: 130px;">Тип питання</th>
                <th style="border: 1px solid #d1d5db; padding: 6px 8px;">Правильна відповідь</th>
                <th style="border: 1px solid #d1d5db; padding: 6px 8px; width: 50px; text-align: center;">Бали</th>
                <th style="border: 1px solid #d1d5db; padding: 6px 8px;">Пояснення / Підказка</th>
              </tr>
            </thead>
            <tbody>
      `;

      const typeTitles = {
        single: 'Один правильний',
        multiple: 'Кілька правильних',
        text: 'Відкрита відповідь',
        short_answer: 'Коротка відповідь',
        numeric: 'Числова відповідь',
        ordering: 'Черговість',
        matching: 'Логічні пари',
        blanks: 'Пропуски'
      };

      questions.forEach((q, idx) => {
        let correctStr = '';
        if (q.type === 'single') {
          const cIdx = typeof q.correct === 'number' ? q.correct : 0;
          const letter = letters[cIdx] || String(cIdx + 1);
          const optText = (q.options && q.options[cIdx]) ? ` (${escapeHtml(q.options[cIdx])})` : '';
          correctStr = `<strong>${letter}</strong>${optText}`;
        } else if (q.type === 'multiple') {
          const arr = Array.isArray(q.correct) ? q.correct : [0];
          const list = arr.map(i => letters[i] || String(i + 1)).join(', ');
          correctStr = `<strong>${list}</strong>`;
        } else if (q.type === 'numeric') {
          const tol = Number(q.numericTolerance || 0);
          correctStr = `<strong>${escapeHtml(String(q.correct ?? ''))}</strong>${tol > 0 ? ` (± ${tol})` : ''}`;
        } else if (q.type === 'text' || q.type === 'short_answer') {
          correctStr = escapeHtml(q.correctAnswer || (Array.isArray(q.correct) ? q.correct.join(', ') : q.correct) || (q.options && q.options[0]) || 'Еталон відповіді вчителя');
        } else {
          correctStr = 'За інструкцією';
        }

        html += `
          <tr>
            <td style="border: 1px solid #d1d5db; padding: 5px 8px; text-align: center; font-weight: 700;">${idx + 1}</td>
            <td style="border: 1px solid #d1d5db; padding: 5px 8px; color: #4b5563;">${typeTitles[q.type] || q.type}</td>
            <td style="border: 1px solid #d1d5db; padding: 5px 8px;">${correctStr}</td>
            <td style="border: 1px solid #d1d5db; padding: 5px 8px; text-align: center; font-weight: 700;">${q.points || 1}</td>
            <td style="border: 1px solid #d1d5db; padding: 5px 8px; color: #374151;">${escapeHtml(q.explanation || '—')}</td>
          </tr>
        `;
      });

      html += `
            </tbody>
          </table>

          <div style="margin-top: 14px; padding: 8px 12px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 4px; font-size: 10.5px;">
            <strong>Критерії оцінювання (12-бальна шкала):</strong>
            <div style="display: flex; gap: 14px; flex-wrap: wrap; margin-top: 4px;">
              <span><strong>Початковий (1-3):</strong> 1 - ${Math.max(1, Math.round(totalScore * 0.3))} б.</span>
              <span><strong>Середній (4-6):</strong> ${Math.max(1, Math.round(totalScore * 0.3)) + 1} - ${Math.max(2, Math.round(totalScore * 0.6))} б.</span>
              <span><strong>Достатній (7-9):</strong> ${Math.max(2, Math.round(totalScore * 0.6)) + 1} - ${Math.max(3, Math.round(totalScore * 0.85))} б.</span>
              <span><strong>Високий (10-12):</strong> ${Math.max(3, Math.round(totalScore * 0.85)) + 1} - ${totalScore} б.</span>
            </div>
          </div>
        </div>
      `;
    }

    return html;
  };

  const renderPreview = () => {
    if (previewContainer) {
      previewContainer.innerHTML = generateSheetHtml(false);
    }
  };

  [optStudent, optKey, optQr, optPoints, optTwoCols].forEach(chk => {
    if (chk) chk.addEventListener('change', renderPreview);
  });

  if (openBtn && modal) {
    openBtn.addEventListener('click', () => {
      refreshQrCode(() => {
        renderPreview();
        modal.classList.remove('hidden');
      });
    });
  }

  const closeModal = () => {
    if (modal) modal.classList.add('hidden');
  };

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

  if (downloadWordBtn) {
    downloadWordBtn.addEventListener('click', () => {
      const content = generateSheetHtml(true);
      const testName = currentTest.name || 'test';
      const wordDocument = `<!DOCTYPE html>
<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
<meta charset='utf-8'>
<title>${escapeHtml(testName)}</title>
<style>
@page { size: A4; margin: 1.5cm; }
body { font-family: 'Calibri', 'Arial', sans-serif; font-size: 11pt; color: #111; line-height: 1.3; }
h2 { font-size: 15pt; font-weight: bold; margin: 0 0 4pt 0; text-align: center; }
table { border-collapse: collapse; width: 100%; margin-top: 10pt; }
th, td { border: 1pt solid #888; padding: 4pt 6pt; font-size: 10pt; }
th { background-color: #f2f2f2; font-weight: bold; }
</style>
</head>
<body>
${content}
</body>
</html>`;

      const blob = new Blob(['\ufeff' + wordDocument], { type: 'application/msword;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = testName.replace(/[^a-zA-Z0-9а-яА-ЯіІїЇєЄ_]/g, '_') + '_друк.doc';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Документ Word (.doc) завантажено');
    });
  }

  if (executePrintBtn) {
    executePrintBtn.addEventListener('click', () => {
      const content = generateSheetHtml(false);
      const testName = currentTest.name || 'Тест';
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        showToast('Дозвольте спливаючі вікна для друку');
        return;
      }

      printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(testName)}</title>
<style>
@page { size: A4; margin: 14mm 14mm 14mm 14mm; }
body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 11pt;
  line-height: 1.35;
  color: #111827;
  background: #ffffff;
  padding: 0;
  margin: 0;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.print-sheet-two-cols {
  column-count: 2;
  column-gap: 24px;
}
.print-question-item {
  break-inside: avoid;
  page-break-inside: avoid;
  margin-bottom: 12px;
}
.print-option-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 3px 0 3px 12px;
}
.print-box {
  width: 13px;
  height: 13px;
  border: 1.5px solid #1f2937;
  border-radius: 2px;
  display: inline-block;
  flex-shrink: 0;
  margin-top: 2px;
}
.print-circle {
  width: 13px;
  height: 13px;
  border: 1.5px solid #1f2937;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
  margin-top: 2px;
}
.print-key-page {
  page-break-before: always;
  break-before: page;
  margin-top: 24px;
  padding-top: 18px;
}
.print-key-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 10px;
  font-size: 10pt;
}
.print-key-table th,
.print-key-table td {
  border: 1px solid #9ca3af;
  padding: 5px 8px;
  text-align: left;
}
.print-key-table th {
  background: #f3f4f6;
  font-weight: 700;
}
</style>
</head>
<body>
${content}
</body>
</html>`);

      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
        printWindow.close();
      }, 300);
      showToast('Діалог друку / PDF відкрито');
    });
  }
}

function showToast(message) {
  const toast = document.getElementById('studioToast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.classList.add('hidden');
  }, 2600);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function bindTutorialTour() {
  const btn = document.getElementById('startTutorialBtn');
  if (btn) {
    btn.addEventListener('click', () => {
      startTestEditorTutorial();
    });
  }
  window.startTestEditorTutorial = startTestEditorTutorial;
}

function startTestEditorTutorial() {
  const existing = document.getElementById('tourOverlayRoot');
  if (existing) existing.remove();

  const editorTab = document.getElementById('viewTestEditorTab');
  const isEditorVisible = editorTab && !editorTab.classList.contains('hidden');

  function launchTour() {
    const existing2 = document.getElementById('tourOverlayRoot');
    if (existing2) existing2.remove();

    const steps = [
      {
        target: '#editorTestSelector',
        title: '1. Вибір активного тесту',
        text: 'Тут відображається список усіх ваших тестів. Оберіть потрібний зі списку — і редактор завантажить його питання. Кнопка «Новий тест» поруч створює порожній тест для заповнення.'
      },
      {
        target: '#editorCreateTestBtn',
        title: '2. Створення нового тесту',
        text: 'Натисніть «Новий тест», щоб створити порожній тест. Введіть назву — і система одразу переключить редактор на нього. Всі тести зберігаються та доступні зі списку зліва.'
      },
      {
        target: '#editorDeleteTestBtn',
        title: '3. Видалення тесту',
        text: 'Червона кнопка кошика видаляє поточний тест разом із усіма його питаннями та результатами. Дія незворотна — будьте уважні перед натисканням!'
      },
      {
        target: '#editTestTitleInput',
        title: '2. Назва тесту',
        text: 'Введіть повну назву тесту прямо в це поле. Вона відображається учням під час проходження. Наприклад: «Підсумковий тест з географії, 10 клас».'
      },
      {
        target: '#editTestSubjectInput',
        title: '6. Предмет та тема тесту',
        text: 'Заповніть предмет (наприклад «Математика») і тему уроку. Ці поля впливають на фільтрацію у списку тестів та відображаються учням під час проходження.'
      },
      {
        target: '#editTestDurationInput',
        title: '7. Загальний час та клас',
        text: 'Вкажіть загальний ліміт часу на весь тест у хвилинах і клас. Таймер запускається для учня з моменту старту і відраховує до нуля — коли час спливає, тест автоматично завершується.'
      },
      {
        target: '#statTotalScore',
        title: '4. Автоматична статистика тесту',
        text: 'Система в реальному часі показує суму балів, орієнтовний час проходження, рівень складності та структуру питань. Якщо написано «Немає питань» — час додати перше завдання!'
      },
      {
        target: '#rightTabChatBtn',
        title: '5. ШІ-генератор тестів та завдань',
        text: 'У правому вікні «Gemini ШІ-Чат» напишіть будь-яке прохання (наприклад, «Створи тест про космос на 5 питань» або «Додай запитання про...»). Штучний інтелект згенерує тест прямо в чаті та запропонує створити новий тест або додати завдання в 1 клік!'
      },
      {
        target: '#openImportModalBtn',
        title: '6. Масовий імпорт з Word та PDF',
        text: 'Якщо у вас вже є файл із тестами у форматі .docx або .txt — скористайтеся імпортом. Система автоматично розбере завдання на окремі блоки.'
      },
      {
        target: '#addQuestionSideBtn',
        title: '7. Список завдань та нові питання',
        text: 'У лівій колонці відображаються всі питання тесту. Кнопка «+ Додати» створює нове завдання вручну. Ви можете перемикатися між ними одним кліком.'
      },
      {
        target: '#editorQuestionType',
        title: '8. Тип питання',
        text: 'Оберіть формат завдання: один правильний варіант, кілька правильних, Правда/Неправда, встановлення відповідності, послідовність або заповнення пропусків. Від типу залежить структура відповідей.'
      },
      {
        target: '#editorPoints',
        title: '9. Бали та ліміт часу на питання',
        text: 'Вкажіть кількість балів за правильну відповідь і персональний таймер у секундах. Ці параметри налаштовуються окремо для кожного питання — складніші завдання можна оцінити вище.'
      },
      {
        target: '#undoActionBtn',
        title: '10. Відмінити, Копіювати, Видалити',
        text: '«Відмінити» скасовує останню зміну (або Ctrl+Z). «Копіювати» дублює питання з усіма варіантами — зручно для схожих завдань. «Видалити» видаляє питання безповоротно.'
      },
      {
        target: '#editorQuestionText',
        title: '8. Текст питання, бали та ліміт часу',
        text: 'Введіть текст завдання. Зверху вкажіть кількість балів за правильну відповідь та персональний таймер у секундах для цього конкретного питання.'
      },
      {
        target: '#toggleImageSectionBtn',
        title: '9. Малюнки, карти та графіки',
        text: 'Натисніть «Додати фото», щоб завантажити малюнок, історичну карту чи схему. Під час тестування учні зможуть наближати її через зум-Lightbox.'
      },
      {
        target: '#optionsContainer',
        title: '10. Варіанти відповідей',
        text: 'Заповніть варіанти і обов\'язково позначте кружечком правильний. Кнопка «+ Варіант» додає нові пункти, а тип питання можна змінити на кілька правильних.'
      },
      {
        target: '#rightTabPreviewBtn',
        title: '11. ШІ-методист та Прев\'ю учня',
        text: 'Праворуч доступний ШІ-чат для швидкої генерації варіантів і пояснень, а у вкладці «Прев\'ю учня» ви побачите точний вигляд завдання на смартфоні чи ПК.'
      },
      {
        target: '#quickSaveBtn',
        title: '12. Збереження тесту',
        text: 'Коли всі питання готові — натисніть «Зберегти тест». Він миттєво зберігається в базу даних та готовий до проведення онлайн-іспиту!'
      }
    ];

    let currentStep = 0;

    const root = document.createElement('div');
    root.id = 'tourOverlayRoot';
    root.innerHTML = `
      <div class="tour-overlay-backdrop"></div>
      <div class="tour-spotlight" id="tourSpotlight"></div>
      <div class="tour-virtual-cursor" id="tourCursor">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
          <path d="M4.5 2.5V19.8l4.8-4.8.4-.2h6.4l-11.6-12.3z" fill="#6366f1" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>
        </svg>
        <div class="tour-cursor-ripple"></div>
      </div>
      <div class="tour-tooltip" id="tourTooltip">
        <div class="tour-tooltip-header">
          <span class="tour-step-badge" id="tourStepBadge">Крок 1 з ${steps.length}</span>
          <button type="button" class="tour-close-btn" id="tourCloseBtn" title="Закрити навчання"><img src="/img/icons/cross.svg" class="pixel-icon inline" alt=""></button>
        </div>
        <div class="tour-tooltip-title" id="tourTitle"></div>
        <div class="tour-tooltip-body" id="tourBody"></div>
        <div class="tour-tooltip-footer">
          <button type="button" class="tour-btn-skip" id="tourSkipBtn">Пропустити</button>
          <div class="tour-nav-btns">
            <button type="button" class="tour-btn tour-btn-prev" id="tourPrevBtn"><img src="/img/icons/refresh.svg" class="pixel-icon inline" alt=""> Назад</button>
            <button type="button" class="tour-btn tour-btn-next" id="tourNextBtn">Далі <img src="/img/icons/plus.svg" class="pixel-icon inline" alt=""></button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    const backdrop = root.querySelector('.tour-overlay-backdrop');
    const spotlight = root.querySelector('#tourSpotlight');
    const cursor = root.querySelector('#tourCursor');
    const tooltip = root.querySelector('#tourTooltip');
    const stepBadge = root.querySelector('#tourStepBadge');
    const titleEl = root.querySelector('#tourTitle');
    const bodyEl = root.querySelector('#tourBody');
    const prevBtn = root.querySelector('#tourPrevBtn');
    const nextBtn = root.querySelector('#tourNextBtn');
    const skipBtn = root.querySelector('#tourSkipBtn');
    const closeBtn = root.querySelector('#tourCloseBtn');

    function cleanup() {
      window.removeEventListener('resize', updatePositions);
      window.removeEventListener('scroll', updatePositions, true);
      document.removeEventListener('keydown', handleKey);
      root.remove();
    }

    function handleKey(e) {
      if (e.key === 'Escape') cleanup();
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowLeft') goPrev();
    }

    function goNext() {
      if (currentStep < steps.length - 1) {
        currentStep++;
        renderStep();
      } else {
        cleanup();
        showToast('Навчання завершено! Успішного створення тестів!');
      }
    }

    function goPrev() {
      if (currentStep > 0) {
        currentStep--;
        renderStep();
      }
    }

    function updatePositions() {
      const s = steps[currentStep];
      if (!s) return;
      const el = document.querySelector(s.target);
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const pad = 8;
      spotlight.style.top = `${Math.max(0, rect.top - pad)}px`;
      spotlight.style.left = `${Math.max(0, rect.left - pad)}px`;
      spotlight.style.width = `${rect.width + pad * 2}px`;
      spotlight.style.height = `${rect.height + pad * 2}px`;

      const targetX = rect.left + Math.min(rect.width * 0.45, 60);
      const targetY = rect.top + Math.min(rect.height * 0.45, 30);
      cursor.style.transform = `translate3d(${targetX}px, ${targetY}px, 0)`;

      const tipWidth = 360;
      const tipHeight = tooltip.offsetHeight || 220;
      const margin = 14;

      let left = rect.left + (rect.width / 2) - (tipWidth / 2);
      if (left < 16) left = 16;
      if (left + tipWidth > window.innerWidth - 16) left = window.innerWidth - tipWidth - 16;

      let top = rect.bottom + margin;
      if (top + tipHeight > window.innerHeight - 16) {
        top = rect.top - tipHeight - margin;
        if (top < 16) {
          top = Math.max(16, (window.innerHeight - tipHeight) / 2);
        }
      }

      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    }

    function renderStep() {
      const s = steps[currentStep];
      if (!s) return;
      const el = document.querySelector(s.target);

      if (!el) {
        if (currentStep < steps.length - 1) {
          currentStep++;
          renderStep();
        } else {
          cleanup();
          showToast('Навчання завершено! Успішного створення тестів!');
        }
        return;
      }

      stepBadge.textContent = `Крок ${currentStep + 1} з ${steps.length}`;
      titleEl.textContent = s.title;
      bodyEl.textContent = s.text;

      prevBtn.style.display = currentStep === 0 ? 'none' : 'inline-block';
      nextBtn.textContent = currentStep === steps.length - 1 ? 'Завершити' : 'Далі';

      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });

      cursor.classList.remove('clicking');
      tooltip.classList.remove('visible');

      setTimeout(() => {
        updatePositions();
        tooltip.classList.add('visible');
        setTimeout(() => {
          cursor.classList.add('clicking');
        }, 500);
      }, 350);
    }

    nextBtn.addEventListener('click', goNext);
    prevBtn.addEventListener('click', goPrev);
    skipBtn.addEventListener('click', cleanup);
    closeBtn.addEventListener('click', cleanup);
    backdrop.addEventListener('click', cleanup);

    window.addEventListener('resize', updatePositions);
    window.addEventListener('scroll', updatePositions, true);
    document.addEventListener('keydown', handleKey);

    renderStep();
  }

  if (!isEditorVisible) {
    if (typeof window.switchTabTo === 'function') {
      window.switchTabTo('testEditor');
    }
    setTimeout(launchTour, 700);
  } else {
    launchTour();
  }
}

document.addEventListener('DOMContentLoaded', init);
