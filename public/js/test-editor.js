const GEMINI_API_KEY = localStorage.getItem('gemini_api_key') || '';
const GEMINI_MODELS = ['gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'];

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

function loadTestIntoStudio(testData) {
  if (!testData) return;
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
      saveCurrentEditorQuestion();
      saveDraftToStorage();
      if (!currentTest || !currentTest.id) {
        showToast('Тест збережено локально');
        return;
      }
      const payload = {
        title: currentTest.name || currentTest.title,
        subject: currentTest.subject || 'Географія',
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
        quickSave.disabled = true;
        const token = localStorage.getItem('admin_token') || '05081988';
        const res = await fetch(`/api/admin/tests/${encodeURIComponent(currentTest.id)}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-token': token
          },
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          showToast('Тест успішно збережено на сервері!');
          if (typeof window.refreshAdminTestsList === 'function') {
            window.refreshAdminTestsList();
          }
        } else {
          showToast('Збережено локально');
        }
      } catch {
        showToast('Збережено локально');
      } finally {
        quickSave.disabled = false;
      }
    });
  }
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
  let typeCounts = { single: 0, multiple: 0, true_false: 0, matching: 0, ordering: 0, fill_blanks: 0, short_answer: 0 };
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
  });

  if (totalScoreEl) totalScoreEl.textContent = `${totalScore} б.`;
  const estMinutes = (estSeconds / 60).toFixed(1);
  if (estTimeEl) estTimeEl.textContent = `${estMinutes} хв.`;

  const complexCount = typeCounts.matching + typeCounts.ordering + typeCounts.fill_blanks;
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
      short_answer: 'Коротка відповідь'
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

function renderTypeSpecificControls(q) {
  const optionsSection = document.getElementById('optionsBuilderSection');
  const matchingSection = document.getElementById('matchingBuilderSection');
  const blanksSection = document.getElementById('fillBlanksHelperSection');
  const shortSection = document.getElementById('shortAnswerSection');

  if (optionsSection) optionsSection.classList.add('hidden');
  if (matchingSection) matchingSection.classList.add('hidden');
  if (blanksSection) blanksSection.classList.add('hidden');
  if (shortSection) shortSection.classList.add('hidden');

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
      aiToggle.checked = !!q.useAiGrading;
      aiToggle.onchange = (e) => {
        q.useAiGrading = e.target.checked;
        saveDraftToStorage();
      };
    }
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
      renderTypeSpecificControls(q);
      renderQuestionsNav();
      updateTestAnalytics();
      updateLivePreview();
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
}

async function callGeminiApi(promptText, expectJson = true) {
  try {
    const token = localStorage.getItem('admin_token') || '05081988';
    const sRes = await fetch('/api/admin/gemini/prompt', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': token
      },
      body: JSON.stringify({
        prompt: promptText,
        expectJson,
        apiKey: localStorage.getItem('gemini_api_key') || ''
      })
    });
    if (sRes.ok) {
      const sData = await sRes.json();
      if (sData.success && sData.result !== undefined) {
        return sData.result;
      }
    }
  } catch {}

  if (GEMINI_API_KEY) {
    for (const model of GEMINI_MODELS) {
      try {
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
        const reqBody = {
          contents: [{ parts: [{ text: promptText }] }]
        };
        if (expectJson) {
          reqBody.generationConfig = { responseMimeType: 'application/json' };
        }
        const res = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reqBody)
        });
        if (!res.ok) continue;
        const data = await res.json();
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (rawText) {
          if (expectJson) {
            try {
              return JSON.parse(rawText);
            } catch {
              const m = rawText.match(/\{[\s\S]*\}/);
              if (m) return JSON.parse(m[0]);
            }
          } else {
            return rawText;
          }
        }
      } catch {}
    }
  }
  return null;
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
    genOptionsBtn.addEventListener('click', async () => {
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

      let result = await callGeminiApi(prompt, true);
      removeTypingIndicator(typingId);

      if (!result || !result.options || result.options.length < 2) {
        result = getIntelligentFallbackOptions(q);
      }

      recordUndoSnapshot();
      q.options = result.options;
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
          return `${isCorr ? '[+]' : '•'} ${opt}`;
        }),
        explanation: q.explanation,
        onApply: () => {
          showToast('Варіанти вже застосовано до питання!');
        }
      });
      showToast('Gemini згенерував варіанти!');
    });
  }

  if (improveTextBtn) {
    improveTextBtn.addEventListener('click', async () => {
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

      let result = await callGeminiApi(prompt, true);
      removeTypingIndicator(typingId);

      let improvedText = result?.improved;
      if (!improvedText) {
        improvedText = q.text.trim();
        if (!improvedText.endsWith('?') && !improvedText.endsWith(':')) improvedText += '?';
        if (!improvedText.startsWith('Укажіть') && !improvedText.startsWith('Визначте') && !improvedText.startsWith('Оберіть')) {
          improvedText = 'Визначте правильну відповідь: ' + improvedText;
        }
      }

      recordUndoSnapshot();
      q.text = improvedText;
      const textInput = document.getElementById('editorQuestionText');
      if (textInput) textInput.value = improvedText;
      renderQuestionsNav();
      updateLivePreview();
      saveDraftToStorage();

      appendChatMessage('assistant', `Текст завдання оновлено відповідно до стандартів тестування:`, {
        title: 'Покращене формулювання:',
        items: [improvedText],
        onApply: () => {
          showToast('Текст уже оновлено в редакторі!');
        }
      });
      showToast('Формулювання покращено!');
    });
  }

  if (explainBtn) {
    explainBtn.addEventListener('click', async () => {
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
Варіанти: ${JSON.stringify(q.options || [])}.
Правильна відповідь індекс: ${JSON.stringify(q.correct)}.
Поверни строго JSON: { "explanation": "текст пояснення з фактами" }`;

      let result = await callGeminiApi(prompt, true);
      removeTypingIndicator(typingId);

      let explanation = result?.explanation;
      if (!explanation) {
        explanation = `Правильна відповідь обґрунтована положеннями навчальної програми з курсу «${currentTest.subject || 'Загальний'}».`;
      }

      recordUndoSnapshot();
      q.explanation = explanation;
      const expBox = document.getElementById('aiExplanationBox');
      const expText = document.getElementById('editorExplanationText');
      if (expText) expText.value = explanation;
      if (expBox) expBox.classList.remove('hidden');
      saveDraftToStorage();

      appendChatMessage('assistant', `Методичне пояснення для учнів готове:`, {
        title: 'Пояснення:',
        items: [explanation],
        onApply: () => {
          showToast('Пояснення прикріплено до питання!');
        }
      });
      showToast('Пояснення створено!');
    });
  }
}

function getIntelligentFallbackOptions(q) {
  const text = (q.text || '').toLowerCase();
  if (text.includes('східн') && text.includes('азі')) {
    return {
      options: ['Японія, Китай, Південна Корея', 'Індія, Пакистан, Бангладеш', 'Монголія, Північна Корея, Китай', 'В\'єтнам, Таїланд, Філіппіни'],
      correct: q.type === 'multiple' ? [0, 2] : 0,
      explanation: 'До Східної Азії належать Китай, Японія, Південна Корея, КНДР та Монголія.'
    };
  }
  if (text.includes('столиц') || text.includes('місто')) {
    return {
      options: ['Токіо', 'Пекін', 'Сеул', 'Астана'],
      correct: q.type === 'multiple' ? [0, 1] : 0,
      explanation: 'Токіо та Пекін є найбільшими мегаполісами та столицями провідних держав Азії.'
    };
  }
  if (text.includes('населен') || text.includes('лідер')) {
    return {
      options: ['Індія (1.43 млрд)', 'Китай (1.41 млрд)', 'США (340 млн)', 'Індонезія (278 млн)'],
      correct: q.type === 'multiple' ? [0, 1] : 0,
      explanation: 'Індія та Китай займають перші дві сходинки у світовому рейтингу населення.'
    };
  }
  return {
    options: ['Китай, Японія, Монголія', 'Німеччина, Франція, Польща', 'Бразилія, Аргентина, Перу', 'Єгипет, Нігерія, Кенія'],
    correct: q.type === 'multiple' ? [0] : 0,
    explanation: 'Дані варіанти відповідають географічній класифікації регіонів.'
  };
}

function bindAiChatSidebar() {
  const tabChatBtn = document.getElementById('rightTabChatBtn');
  const tabPreviewBtn = document.getElementById('rightTabPreviewBtn');
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

  const handleSend = async (customPrompt) => {
    const text = customPrompt || (input ? input.value.trim() : '');
    if (!text) return;
    if (input) input.value = '';

    appendChatMessage('user', text);
    const typingId = appendTypingIndicator();

    const q = currentTest.questions[activeQuestionIndex] || {};
    const prompt = `Ти — інтелектуальний помічник викладача Gemini у системі створення тестів SecureExam.
Поточний тест: "${currentTest.name || ''}", предмет: "${currentTest.subject || ''}", тема: "${currentTest.topic || ''}".
Поточне активне запитання (#${activeQuestionIndex + 1}): "${q.text || ''}", тип: "${q.type || 'single'}", варіанти: ${JSON.stringify(q.options || [])}.

Запит викладача: "${text}".

ІНСТРУКЦІЯ:
1. Якщо викладач просить СТВОРИТИ ЦІЛИЙ ТЕСТ або КІЛЬКА ПИТАНЬ (наприклад: "створи тест про...", "зроби 5 питань...", "згенеруй тест на тему..."):
Напиши короткий опис тесту і ОБОВ'ЯЗКОВО додай JSON-блок:
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

2. Якщо викладач просить створити ОДНЕ питання чи змінити варіанти/поточне питання:
\`\`\`json
{
  "action": "add_new_question",
  "text": "Текст запитання",
  "type": "single",
  "options": ["Варіант 1", "Варіант 2", "Варіант 3", "Варіант 4"],
  "correct": 0,
  "explanation": "Пояснення"
}
\`\`\`

3. Якщо це порада чи відповідь — відповідай грамотною українською мовою.`;

    let reply = await callGeminiApi(prompt, false);
    removeTypingIndicator(typingId);

    if (!reply) {
      reply = 'Вибачте, не вдалося зв\'язатися з Gemini API. Перевірте з\'єднання з інтернетом або ключ у файлі .env.';
    }

    let parsedAction = null;
    const jsonMatch = reply.match(/```json\s*([\s\S]*?)\s*```/) || reply.match(/\{[\s\S]*"(?:questions|options)"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsedAction = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      } catch {}
    }

    const cleanReply = reply.replace(/```json[\s\S]*?```/g, '').trim();

    let cardData = null;
    const questionsList = Array.isArray(parsedAction?.questions) ? parsedAction.questions : null;

    if (questionsList && questionsList.length > 0) {
      const qCount = questionsList.length;
      const testTitle = parsedAction.testTitle || parsedAction.topic || (currentTest.subject + ': Новий тест');
      cardData = {
        title: `Згенеровано ${qCount} завдань для тесту:`,
        items: questionsList.map((qItem, idx) => {
          const optCount = Array.isArray(qItem.options) ? qItem.options.length : 0;
          return `${idx + 1}. ${qItem.text || 'Завдання #' + (idx + 1)} (${optCount} вар.)`;
        }),
        explanation: parsedAction.explanation || '',
        onCreateNewTest: async () => {
          try {
            const token = localStorage.getItem('admin_token') || '05081988';
            const res = await fetch('/api/admin/tests', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-admin-token': token
              },
              body: JSON.stringify({
                title: testTitle,
                durationMinutes: parsedAction.durationMinutes || 15,
                topic: parsedAction.topic || '',
                subject: parsedAction.subject || currentTest.subject || 'Загальний',
                questions: questionsList.map((item, i) => ({
                  id: 'q_ai_' + Date.now() + '_' + i,
                  text: item.text || 'Питання #' + (i + 1),
                  type: item.type || 'single',
                  options: Array.isArray(item.options) ? item.options : ['Варіант 1', 'Варіант 2'],
                  correct: item.correct !== undefined ? item.correct : 0,
                  points: item.points || 1,
                  timeLimit: item.timeLimit || 60,
                  imageUrl: '',
                  explanation: item.explanation || ''
                }))
              })
            });
            if (res.ok) {
              const created = await res.json();
              showToast(`Створено новий тест "${created.title}"!`);
              if (typeof window.loadAdminTestsList === 'function') await window.loadAdminTestsList();
              const edSel = document.getElementById('editorTestSelector');
              if (edSel) edSel.value = created.id;
              if (typeof window.loadAdminTest === 'function') {
                window.selectedAdminTestId = created.id;
                await window.loadAdminTest();
              }
            } else {
              const err = await res.json().catch(() => ({}));
              showToast('Помилка: ' + (err.error || 'Не вдалося створити тест'));
            }
          } catch (e) {
            showToast('Помилка: ' + e.message);
          }
        },
        onReplaceTest: () => {
          recordUndoSnapshot();
          currentTest.questions = questionsList.map((item, i) => ({
            id: 'q_ai_' + Date.now() + '_' + i,
            text: item.text || 'Питання #' + (i + 1),
            type: item.type || 'single',
            options: Array.isArray(item.options) ? item.options : ['Варіант 1', 'Варіант 2'],
            correct: item.correct !== undefined ? item.correct : 0,
            points: item.points || 1,
            timeLimit: item.timeLimit || 60,
            imageUrl: '',
            explanation: item.explanation || ''
          }));
          if (parsedAction.testTitle) {
            currentTest.name = currentTest.title = parsedAction.testTitle;
          }
          if (parsedAction.subject) currentTest.subject = parsedAction.subject;
          if (parsedAction.topic) currentTest.topic = parsedAction.topic;
          activeQuestionIndex = 0;
          syncMetaHeader();
          renderQuestionsNav();
          loadQuestionIntoEditor(0);
          updateTestAnalytics();
          saveDraftToStorage();
          showToast(`Питання тесту замінено на ${qCount} нових завдань!`);
        },
        onAppendQuestions: () => {
          recordUndoSnapshot();
          const toAdd = questionsList.map((item, i) => ({
            id: 'q_ai_' + Date.now() + '_' + i,
            text: item.text || 'Питання #' + (i + 1),
            type: item.type || 'single',
            options: Array.isArray(item.options) ? item.options : ['Варіант 1', 'Варіант 2'],
            correct: item.correct !== undefined ? item.correct : 0,
            points: item.points || 1,
            timeLimit: item.timeLimit || 60,
            imageUrl: '',
            explanation: item.explanation || ''
          }));
          currentTest.questions.push(...toAdd);
          activeQuestionIndex = currentTest.questions.length - toAdd.length;
          renderQuestionsNav();
          loadQuestionIntoEditor(activeQuestionIndex);
          updateTestAnalytics();
          saveDraftToStorage();
          showToast(`Додано ${toAdd.length} завдань до тесту!`);
        }
      };
    } else if (parsedAction && parsedAction.options && parsedAction.options.length > 0) {
      cardData = {
        title: parsedAction.text || 'Згенероване запитання:',
        items: parsedAction.options.map((opt, idx) => {
          const isC = Array.isArray(parsedAction.correct) ? parsedAction.correct.includes(idx) : parsedAction.correct === idx;
          return `${isC ? '[+]' : '•'} ${opt}`;
        }),
        explanation: parsedAction.explanation,
        onApply: () => {
          recordUndoSnapshot();
          if (parsedAction.text) q.text = parsedAction.text;
          if (parsedAction.type) q.type = parsedAction.type;
          q.options = parsedAction.options;
          q.correct = parsedAction.correct !== undefined ? parsedAction.correct : 0;
          if (parsedAction.explanation) q.explanation = parsedAction.explanation;
          loadQuestionIntoEditor(activeQuestionIndex);
          renderQuestionsNav();
          updateTestAnalytics();
          saveDraftToStorage();
          showToast('Зміни успішно вставлено в поточне запитання!');
        },
        onAddNew: () => {
          recordUndoSnapshot();
          const newQ = {
            id: 'q_' + Date.now(),
            text: parsedAction.text || 'Нове запитання від Gemini',
            type: parsedAction.type || 'single',
            options: parsedAction.options,
            correct: parsedAction.correct !== undefined ? parsedAction.correct : 0,
            points: 1,
            timeLimit: 60,
            imageUrl: '',
            explanation: parsedAction.explanation || ''
          };
          currentTest.questions.push(newQ);
          activeQuestionIndex = currentTest.questions.length - 1;
          renderQuestionsNav();
          loadQuestionIntoEditor(activeQuestionIndex);
          updateTestAnalytics();
          saveDraftToStorage();
          showToast('Створено нове запитання в тесті!');
        }
      };
    }

    appendChatMessage('assistant', cleanReply || 'Ось результат від Gemini:', cardData);
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
    inner += `
      <div class="chat-action-card">
        <div class="chat-action-title">${escapeHtml(cardData.title)}</div>
        <ul class="chat-action-list">
          ${cardData.items.map(it => `<li>${escapeHtml(it)}</li>`).join('')}
        </ul>
        ${cardData.explanation ? `<div style="font-size:10px; color:var(--text-muted); margin-top:4px;"><img src="/img/icons/bulb.svg" class="pixel-icon inline" alt=""> ${escapeHtml(cardData.explanation)}</div>` : ''}
        <div class="chat-action-btns" style="display:flex; flex-wrap:wrap; gap:6px; margin-top:8px;">
          ${cardData.onCreateNewTest ? `<button type="button" class="btn-chat-create-test" style="background:linear-gradient(135deg,#6366f1,#8b5cf6); color:#fff; border:none; padding:6px 12px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:5px;"><img src="/img/icons/plus.svg" class="pixel-icon inline" alt="" style="filter:brightness(0) invert(1);"> Створити новий тест</button>` : ''}
          ${cardData.onReplaceTest ? `<button type="button" class="btn-chat-replace-test" style="background:rgba(99,102,241,0.12); color:var(--accent,#6366f1); border:1px solid rgba(99,102,241,0.35); padding:6px 10px; border-radius:6px; font-size:11px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:5px;"><img src="/img/icons/refresh.svg" class="pixel-icon inline" alt=""> Замінити цей тест</button>` : ''}
          ${cardData.onAppendQuestions ? `<button type="button" class="btn-chat-append-test" style="background:rgba(16,185,129,0.12); color:#10b981; border:1px solid rgba(16,185,129,0.35); padding:6px 10px; border-radius:6px; font-size:11px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:5px;"><img src="/img/icons/download.svg" class="pixel-icon inline" alt=""> Додати до тесту</button>` : ''}
          ${cardData.onApply ? `<button type="button" class="btn-chat-apply"><img src="/img/icons/download.svg" class="pixel-icon inline" alt=""> Застосувати до цього питання</button>` : ''}
          ${cardData.onAddNew ? `<button type="button" class="btn-chat-new"><img src="/img/icons/plus.svg" class="pixel-icon inline" alt=""> Додати як нове</button>` : ''}
        </div>
      </div>
    `;
  }

  inner += `</div>`;
  msg.innerHTML = inner;

  if (cardData) {
    const createTestBtn = msg.querySelector('.btn-chat-create-test');
    const replaceTestBtn = msg.querySelector('.btn-chat-replace-test');
    const appendTestBtn = msg.querySelector('.btn-chat-append-test');
    const applyBtn = msg.querySelector('.btn-chat-apply');
    const addBtn = msg.querySelector('.btn-chat-new');

    if (createTestBtn && cardData.onCreateNewTest) createTestBtn.addEventListener('click', cardData.onCreateNewTest);
    if (replaceTestBtn && cardData.onReplaceTest) replaceTestBtn.addEventListener('click', cardData.onReplaceTest);
    if (appendTestBtn && cardData.onAppendQuestions) appendTestBtn.addEventListener('click', cardData.onAppendQuestions);
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
  } else if (q.type === 'short_answer') {
    const inputDemo = document.createElement('input');
    inputDemo.className = 'form-input';
    inputDemo.placeholder = 'Поле для вводу учнем...';
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
  const closeBtn = document.getElementById('closeAiModalBtn');
  const cancelBtn = document.getElementById('cancelAiGenBtn');
  const startBtn = document.getElementById('startAiGenBtn');
  const topicInput = document.getElementById('aiTopicInput');
  const subjectInput = document.getElementById('aiSubjectInput');
  const countInput = document.getElementById('aiCountInput');
  const countSelect = document.getElementById('aiCountSelect');
  const presetsContainer = document.getElementById('aiCountPresets');
  const gradeInput = document.getElementById('aiGradeInput');
  const diffSelect = document.getElementById('aiDifficultySelect');
  const progressWrap = document.getElementById('aiGenProgressWrap');

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
        if (c.getAttribute('data-count') === val) c.classList.add('active');
        else c.classList.remove('active');
      });
    });
  }

  if (openBtn && modal) {
    openBtn.addEventListener('click', () => {
      if (topicInput && currentTest.topic) topicInput.value = currentTest.topic;
      if (subjectInput && currentTest.subject) subjectInput.value = currentTest.subject;
      if (gradeInput && currentTest.class) gradeInput.value = currentTest.class;
      if (progressWrap) progressWrap.classList.add('hidden');
      modal.classList.remove('hidden');
    });
  }
  const close = () => { if (modal) modal.classList.add('hidden'); };
  if (closeBtn) closeBtn.addEventListener('click', close);
  if (cancelBtn) cancelBtn.addEventListener('click', close);

  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      const topic = topicInput ? topicInput.value.trim() : 'Загальна тема';
      const subject = subjectInput ? subjectInput.value.trim() : 'Предмет';
      let count = 5;
      if (countInput) {
        count = parseInt(countInput.value) || 5;
      } else if (countSelect) {
        count = parseInt(countSelect.value) || 5;
      }
      count = Math.min(50, Math.max(1, count));

      const grade = gradeInput ? (gradeInput.value.trim() || '10-11 клас') : '10-11 клас';
      const difficulty = diffSelect ? diffSelect.value : 'Середній рівень';

      if (progressWrap) progressWrap.classList.remove('hidden');
      startBtn.disabled = true;

      const prompt = `Ти — експерт зі створення тестів українською мовою.
Предмет: "${subject}". Тема: "${topic}".
Клас / Аудиторія: "${grade}".
Рівень складності: "${difficulty}".
Кількість завдань: ${count}.
Склади рівно ${count} якісних тестових завдань (single та multiple), що суворо відповідають рівню складності (${difficulty}) та класу (${grade}). Всі варіанти мають бути реальними назвами, фактами чи датами (жодних "Варіант А").
Поверни строго JSON у форматі:
{
  "questions": [
    {
      "text": "текст запитання",
      "type": "single",
      "options": ["варіант 1", "варіант 2", "варіант 3", "варіант 4"],
      "correct": 0,
      "points": 1,
      "timeLimit": 60,
      "explanation": "пояснення чому це правильно"
    }
  ]
}`;

      let aiResult = await callGeminiApi(prompt, true);
      let generated = aiResult?.questions;

      if (!generated || !Array.isArray(generated) || generated.length === 0) {
        generated = [];
        for (let i = 1; i <= count; i++) {
          generated.push({
            id: 'q_ai_' + Date.now() + '_' + i,
            text: `Яке з наведених тверджень найкраще характеризує тему «${topic}» (${difficulty}, ${grade}) (завдання #${i})?`,
            type: i === 2 ? 'multiple' : 'single',
            options: [
              `Основна закономірність та ключове положення теми #${i}`,
              `Другорядний взаємопов'язаний фактор`,
              `Хибне альтернативне твердження`,
              `Застаріле визначення або термін`
            ],
            correct: i === 2 ? [0, 1] : 0,
            points: i === 2 ? 2 : 1,
            timeLimit: 60,
            imageUrl: '',
            explanation: `Завдання згенеровано за навчальною програмою курсу «${subject}» для ${grade} (${difficulty}).`
          });
        }
      } else {
        generated.forEach((q, idx) => {
          q.id = 'q_ai_' + Date.now() + '_' + idx;
          q.points = q.points || 1;
          q.timeLimit = q.timeLimit || 60;
          q.imageUrl = '';
        });
      }

      recordUndoSnapshot();
      currentTest.questions.push(...generated);
      activeQuestionIndex = currentTest.questions.length - generated.length;
      if (progressWrap) progressWrap.classList.add('hidden');
      startBtn.disabled = false;
      close();
      renderQuestionsNav();
      loadQuestionIntoEditor(activeQuestionIndex);
      updateTestAnalytics();
      saveDraftToStorage();
      showToast(`Gemini згенерував ${generated.length} завдань!`);
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
      } else if (q.type === 'text') {
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
        } else if (q.type === 'text') {
          correctStr = escapeHtml(q.correctAnswer || (q.options && q.options[0]) || 'Еталон відповіді вчителя');
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