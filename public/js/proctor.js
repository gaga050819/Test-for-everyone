export class ProctorEngine {
  constructor(options = {}) {
    this.options = {
      sessionId: options.sessionId || '',
      studentName: options.studentName || 'Student',
      studentId: options.studentId || 'ID-000',
      clientIp: options.clientIp || '127.0.0.1',
      pingIntervalMs: options.pingIntervalMs || 2000,
      onIncident: options.onIncident || (() => {}),
      onStatusChange: options.onStatusChange || (() => {}),
      onPingUpdate: options.onPingUpdate || (() => {}),
      onWarning: options.onWarning || (() => {}),
      onFatalViolation: options.onFatalViolation || (() => {}),
      onTrustScoreUpdate: options.onTrustScoreUpdate || (() => {}),
      ...options
    };

    const ua = navigator.userAgent;
    this.isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    this.isIPhone = /iPhone|iPod/.test(ua);
    this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua) || ('ontouchstart' in window);
    this.deviceType = this.detectDeviceType();
    this.isBypassed = !!options.proctorBypassed;

    this.isRunning = false;
    this.isCompleted = false;
    this.isOnline = navigator.onLine;
    this.lastSuccessfulPing = Date.now();
    this.currentLatency = 0;
    this.pingHistory = [];
    this.inactiveStartTime = null;
    this.fullscreenGraceTimer = null;
    this.fullscreenGraceRemaining = 9;
    this.isInsideFullscreenGrace = false;
    this.offlineQueue = [];
    this.pingTimer = null;
    this.splitScreenCheckTimer = null;
    this.splitScreenGraceTimer = null;
    this.splitScreenGraceRemaining = 10;
    this.isInsideSplitScreenGrace = false;
    this.splitScreenOverlay = null;
    this.splitScreenTimerEl = null;
    this.watermarkCanvas = null;
    this.watermarkInterval = null;
    this.ws = null;
    this.initialScreenHeight = window.screen.height || window.innerHeight;
    this.isInputFocused = false;
  }

  detectDeviceType() {
    const ua = navigator.userAgent;
    if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) return 'tablet';
    if (/Mobile|iP(hone|od)|Android|BlackBerry|IEMobile|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/i.test(ua)) return 'mobile';
    return 'desktop';
  }

  async start() {
    this.isRunning = true;
    this.initWebSocket();
    this.initNetworkMonitoring();
    this.initVisibilityMonitoring();
    this.initHardwareAndDevtoolsMonitoring();
    this.initInputGuards();
    this.initMobileGuards();
    this.initAdvancedGuards();
    this.initSplitScreenMonitor();
    this.initWatermark();
  }

  initWebSocket() {
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.ws.send(JSON.stringify({
          type: 'register',
          sessionId: this.options.sessionId,
          role: 'student',
          deviceType: this.deviceType
        }));
        this.flushOfflineQueue();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'pong') {
            const now = Date.now();
            const latency = Math.max(1, now - data.clientTimestamp);
            this.handlePingSuccess(latency);
          } else if (data.type === 'admin_override_unlock') {
            this._adminOverrideUnlock(data.trustScore || 70);
          } else if (data.type === 'admin_override_bypass') {
            this._adminOverrideBypass(data.trustScore || 70);
          }
        } catch (e) {
          console.error(e);
        }
      };

      this.ws.onclose = () => {
        if (this.isRunning) {
          setTimeout(() => this.initWebSocket(), 3000);
        }
      };
    } catch (err) {
      console.error(err);
    }
  }

  initNetworkMonitoring() {
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.options.onStatusChange({
        status: 'online',
        message: 'З\'єднання з інтернетом відновлено'
      });
      this.recordIncident({
        category: 'network_issue',
        type: 'connection_restored',
        message: 'Зв\'язок відновлено',
        penalty: 0,
        severity: 'info',
        networkState: { online: true, latency: this.currentLatency }
      });
      this.flushOfflineQueue();
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.options.onStatusChange({
        status: 'offline',
        message: 'Втрачено інтернет-з\'єднання'
      });
      this.recordIncident({
        category: 'network_issue',
        type: 'connection_lost',
        message: 'Зник зв\'язок з мережею',
        penalty: 0,
        severity: 'warning',
        networkState: { online: false, latency: 0 }
      });
    });

    this.pingTimer = setInterval(() => {
      this.measurePing();
    }, this.options.pingIntervalMs);
    this.measurePing();
  }

  async measurePing() {
    if (!this.isRunning) return;
    const sendTime = Date.now();

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'ping',
        clientTimestamp: sendTime,
        latency: this.currentLatency
      }));
    } else {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2500);

        const response = await fetch('/api/ping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientTimestamp: sendTime }),
          signal: controller.signal
        });
        clearTimeout(timeout);

        if (response.ok) {
          const latency = Math.max(1, Date.now() - sendTime);
          this.handlePingSuccess(latency);
        } else {
          this.handlePingFailure();
        }
      } catch {
        this.handlePingFailure();
      }
    }
  }

  handlePingSuccess(latency) {
    this.lastSuccessfulPing = Date.now();
    this.currentLatency = latency;
    this.isOnline = true;

    this.pingHistory.push(latency);
    if (this.pingHistory.length > 20) this.pingHistory.shift();

    this.options.onPingUpdate({
      latency,
      status: latency > 250 ? 'high_latency' : 'optimal',
      isOnline: true
    });
  }

  handlePingFailure() {
    const elapsedSinceLastPing = Date.now() - this.lastSuccessfulPing;
    if (elapsedSinceLastPing > 4000) {
      this.isOnline = false;
      this.options.onPingUpdate({
        latency: 0,
        status: 'disconnected',
        isOnline: false
      });
    }
  }

  initVisibilityMonitoring() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.handleFocusLoss('tab_visibility_hidden');
      } else if (document.visibilityState === 'visible') {
        this.handleFocusRestored('tab_visibility_visible');
      }
    });

    window.addEventListener('blur', () => {
      this.handleFocusLoss('window_blur');
    });

    window.addEventListener('focus', () => {
      this.handleFocusRestored('window_focus');
    });

    document.documentElement.addEventListener('mouseleave', () => {
      this.options.onStatusChange({
        status: 'warning',
        message: 'Курсор миші залишив межі тестового вікна'
      });
    });
  }

  handleFocusLoss(triggerSource) {
    if (!this.isRunning || this.isCompleted) return;
    if (this.inactiveStartTime !== null) return;

    this.inactiveStartTime = Date.now();
    const networkIsActive = this.isOnline && (Date.now() - this.lastSuccessfulPing < 3500);

    if (networkIsActive) {
      const isMobileAction = this.isMobile ? 'шторки сповіщень чи іншого додатку' : 'іншого вікна чи вкладки';
      this.recordIncident({
        category: 'cheating_attempt',
        type: 'tab_or_window_switch',
        message: `Спроба списування: Відкриття ${isMobileAction} при активному інтернеті`,
        penalty: 10,
        severity: 'danger',
        triggerSource,
        networkState: {
          online: true,
          latency: this.currentLatency,
          lastPingAgoMs: Date.now() - this.lastSuccessfulPing
        }
      });

      this.options.onWarning({
        title: 'Увага! Зафіксовано вихід з вікна тесту',
        message: this.isMobile
          ? 'Ви перемкнулися на інший додаток або відкрили шторку повідомлень. Це фіксується як порушення!'
          : 'Ви перемкнулися на іншу програму чи вкладку. Це зафіксовано в системі!',
        severity: 'danger'
      });
    } else {
      this.recordIncident({
        category: 'network_issue',
        type: 'inactive_due_to_network',
        message: 'Неактивність через перебої в інтернет-з\'єднанні або втрату сигналу',
        penalty: 0,
        severity: 'warning',
        triggerSource,
        networkState: {
          online: false,
          latency: this.currentLatency,
          lastPingAgoMs: Date.now() - this.lastSuccessfulPing
        }
      });

      this.options.onWarning({
        title: 'Мережевий збій',
        message: 'Зафіксовано втрату зв\'язку з сервером. Таймер тесту призупинено до стабілізації інтернету.',
        severity: 'warning'
      });
    }
  }

  handleFocusRestored(triggerSource) {
    if (!this.isRunning) return;
    if (this.inactiveStartTime === null) return;

    const durationSeconds = Math.round((Date.now() - this.inactiveStartTime) / 1000);
    this.inactiveStartTime = null;

    this.recordIncident({
      category: 'focus_restored',
      type: 'focus_regained',
      message: `Повернення до тесту після неактивності тривалістю ${durationSeconds} сек`,
      penalty: 0,
      severity: 'info',
      durationSeconds,
      triggerSource
    });
  }

  isFullscreenSupported() {
    if (this.isIPhone) return false;
    const doc = document;
    return !!(
      doc.fullscreenEnabled ||
      doc.webkitFullscreenEnabled ||
      doc.documentElement.requestFullscreen ||
      doc.documentElement.webkitRequestFullscreen
    );
  }

  initHardwareAndDevtoolsMonitoring() {
    if (this.isFullscreenSupported()) {
      document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
          this.handleFullscreenExit();
        } else {
          this.handleFullscreenRestored();
        }
      });
      document.addEventListener('webkitfullscreenchange', () => {
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
          this.handleFullscreenExit();
        } else {
          this.handleFullscreenRestored();
        }
      });
    }

    setInterval(() => {
      this.detectDevTools();
    }, 1500);
  }

  async enterFullscreen() {
    if (!this.isFullscreenSupported()) return true;
    try {
      const el = document.documentElement;
      if (el.requestFullscreen) {
        await el.requestFullscreen();
      } else if (el.webkitRequestFullscreen) {
        await el.webkitRequestFullscreen();
      }
      return true;
    } catch {
      return false;
    }
  }

  handleFullscreenExit() {
    if (!this.isRunning || this.isCompleted || this.isBypassed) return;
    if (!this.isFullscreenSupported()) return;
    this.isInsideFullscreenGrace = true;
    this.fullscreenGraceRemaining = 9;

    this.recordIncident({
      category: 'cheating_attempt',
      type: 'fullscreen_exit',
      message: 'Вихід з повноекранного режиму',
      penalty: 7,
      severity: 'danger',
      networkState: { online: this.isOnline, latency: this.currentLatency }
    });

    this.options.onWarning({
      title: 'Повноекранний режим порушено!',
      message: 'Поверніться у повноекранний режим протягом 9 секунд, інакше тест буде анульовано.',
      isCountdown: true,
      countdownSeconds: 9,
      severity: 'danger',
      onRestore: () => this.enterFullscreen()
    });

    if (this.fullscreenGraceTimer) clearInterval(this.fullscreenGraceTimer);
    this.fullscreenGraceTimer = setInterval(() => {
      this.fullscreenGraceRemaining--;
      if (this.fullscreenGraceRemaining <= 0) {
        clearInterval(this.fullscreenGraceTimer);
        this.options.onFatalViolation({
          reason: 'Тест анульовано через неповернення в повноекранний режим.'
        });
      }
    }, 1000);
  }

  handleFullscreenRestored() {
    if (this.isInsideFullscreenGrace) {
      this.isInsideFullscreenGrace = false;
      if (this.fullscreenGraceTimer) {
        clearInterval(this.fullscreenGraceTimer);
        this.fullscreenGraceTimer = null;
      }
      this.options.onWarning(null);
    }
  }

  detectDevTools() {
    if (!this.isRunning || this.isCompleted) return;
    const widthDiff = window.outerWidth - window.innerWidth;
    const heightDiff = window.outerHeight - window.innerHeight;

    if (widthDiff > 160 || heightDiff > 160) {
      this.recordIncident({
        category: 'devtools_opened',
        type: 'devtools_detected_size',
        message: 'Спроба відкриття консолі розробника / інспектора елементів',
        penalty: 15,
        severity: 'danger'
      });
      this.options.onWarning({
        title: 'Заборонена дія!',
        message: 'Використання інструментів розробника суворо заборонено.',
        severity: 'danger'
      });
    }
  }

  initMobileGuards() {
    if (!this.isMobile) return;

    this.lockOrientation();

    window.addEventListener('touchstart', (e) => {
      if (!this.isRunning || this.isCompleted) return;
      if (e.touches && e.touches.length >= 3) {
        e.preventDefault();
        this.recordIncident({
          category: 'cheating_attempt',
          type: 'multi_finger_screenshot_gesture',
          message: 'Спроба знімка екрана трипальцевим жестом',
          penalty: 10,
          severity: 'danger'
        });
        this.options.onWarning({
          title: 'Спроба скріншота заблокована!',
          message: 'Жести знімка екрана суворо заборонені.',
          severity: 'danger'
        });
      }

      const t = e.touches[0];
      const edgeThreshold = 22;
      const fromTop = t.clientY < edgeThreshold;
      const fromLeft = t.clientX < edgeThreshold;
      const fromRight = t.clientX > window.innerWidth - edgeThreshold;
      if (fromTop || fromLeft || fromRight) {
        this._edgeSwipeStart = { x: t.clientX, y: t.clientY, fromTop, time: Date.now() };
      }
    }, { passive: false });

    window.addEventListener('touchend', (e) => {
      if (!this.isRunning || this.isCompleted || !this._edgeSwipeStart) return;
      const t = e.changedTouches[0];
      const dy = t.clientY - this._edgeSwipeStart.y;
      const dt = Date.now() - this._edgeSwipeStart.time;
      if (dt < 600 && this._edgeSwipeStart.fromTop && dy > 50) {
        this.recordIncident({
          category: 'cheating_attempt',
          type: 'notification_panel_swipe',
          message: 'Свайп зверху — можлива спроба відкрити шторку сповіщень або Quick Settings',
          penalty: 7,
          severity: 'danger'
        });
        this.options.onWarning({
          title: 'Заборонений жест!',
          message: 'Відкриття шторки сповіщень під час тесту фіксується як порушення.',
          severity: 'danger'
        });
      }
      this._edgeSwipeStart = null;
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (e.touches && e.touches.length > 1) {
        e.preventDefault();
      }
    }, { passive: false });

    window.addEventListener('orientationchange', () => {
      if (!this.isRunning || this.isCompleted) return;
      this.recordIncident({
        category: 'device_state',
        type: 'orientation_change',
        message: 'Зміна орієнтації екрана',
        penalty: 0,
        severity: 'info'
      });
      setTimeout(() => this.lockOrientation(), 300);
    });
  }

  lockOrientation() {
    try {
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('portrait').catch(() => {});
      }
    } catch (_) {}
  }

  initSplitScreenMonitor() {
    if (this.splitScreenCheckTimer) clearInterval(this.splitScreenCheckTimer);
    this.splitScreenCheckTimer = setInterval(() => {
      this.checkSplitScreen();
    }, 300);

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => {
        this.checkSplitScreen(true);
      });
    }
    window.addEventListener('resize', () => {
      this.checkSplitScreen(true);
    });
  }

  showSplitScreenBlackout() {
    if (this.splitScreenOverlay) return;

    this.splitScreenOverlay = document.createElement('div');
    this.splitScreenOverlay.id = 'splitScreenBlackoutOverlay';
    this.splitScreenOverlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:2147483646',
      'background:#000000',
      'color:#ffffff',
      'display:flex',
      'flex-direction:column',
      'align-items:center',
      'justify-content:center',
      'padding:24px',
      'text-align:center',
      'box-sizing:border-box',
      'user-select:none'
    ].join(';');

    const icon = document.createElement('div');
    icon.style.cssText = 'margin-bottom:12px;display:flex;align-items:center;justify-content:center;';
    icon.innerHTML = '<img src="/img/icons/warning.svg" class="pixel-icon large" alt="" style="width:48px;height:48px;">';

    const title = document.createElement('div');
    title.style.cssText = 'font-size:18px;font-weight:800;color:#ef4444;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px;';
    title.textContent = 'РОЗДІЛЕННЯ ЕКРАНА ЗАБОРОНЕНО!';

    this.splitScreenTimerEl = document.createElement('div');
    this.splitScreenTimerEl.style.cssText = 'font-size:56px;font-weight:900;font-family:monospace;color:#ffffff;line-height:1;margin-bottom:14px;';
    this.splitScreenTimerEl.textContent = `${this.splitScreenGraceRemaining}`;

    const desc = document.createElement('div');
    desc.style.cssText = 'font-size:14px;color:#e2e8f0;max-width:380px;line-height:1.5;margin-bottom:8px;font-weight:600;';
    desc.textContent = 'Вимкніть спліт-скрін та розгорніть браузер на повний екран!';

    const warning = document.createElement('div');
    warning.style.cssText = 'font-size:12px;color:#94a3b8;max-width:340px;line-height:1.4;';
    warning.textContent = 'Якщо розділення екрана не буде вимкнено до завершення таймера — тест буде повністю анульовано за недоброчесність.';

    this.splitScreenOverlay.appendChild(icon);
    this.splitScreenOverlay.appendChild(title);
    this.splitScreenOverlay.appendChild(this.splitScreenTimerEl);
    this.splitScreenOverlay.appendChild(desc);
    this.splitScreenOverlay.appendChild(warning);
    document.body.appendChild(this.splitScreenOverlay);
  }

  hideSplitScreenBlackout() {
    if (this.splitScreenOverlay) {
      this.splitScreenOverlay.remove();
      this.splitScreenOverlay = null;
      this.splitScreenTimerEl = null;
    }
  }

  checkSplitScreen(isImmediate = false) {
    if (!this.isRunning || this.isCompleted || this.isBypassed) return;
    if (this.isInputFocused) return;
    if (this.isIPhone) return; // iPhones do not support split-screen; avoid false positives on Safari toolbars

    const isLandscape = window.innerWidth > window.innerHeight;
    const screenH = isLandscape
      ? Math.min(window.screen.width, window.screen.height)
      : Math.max(window.screen.width, window.screen.height);
    const screenW = isLandscape
      ? Math.max(window.screen.width, window.screen.height)
      : Math.min(window.screen.width, window.screen.height);

    const currentH = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    const currentW = window.visualViewport ? window.visualViewport.width : window.innerWidth;

    const heightRatio = currentH / (screenH || 1);
    const widthRatio = currentW / (screenW || 1);

    const isSplit = this.isMobile
      ? (heightRatio < 0.68 || widthRatio < 0.68)
      : (!document.fullscreenElement && (heightRatio < 0.68 || widthRatio < 0.68));

    if (isSplit) {
      if (!this.isInsideSplitScreenGrace) {
        this.isInsideSplitScreenGrace = true;
        this.splitScreenGraceRemaining = 10;
        this.showSplitScreenBlackout();

        this.recordIncident({
          category: 'cheating_attempt',
          type: 'split_screen_warning',
          message: 'Зафіксовано розділення екрана (Split Screen). Екран заблоковано на 10 сек',
          penalty: 0,
          severity: 'danger',
          metrics: {
            screenH,
            screenW,
            currentH,
            currentW,
            heightRatio: Math.round(heightRatio * 100),
            widthRatio: Math.round(widthRatio * 100)
          }
        });

        if (this.splitScreenGraceTimer) clearInterval(this.splitScreenGraceTimer);
        this.splitScreenGraceTimer = setInterval(() => {
          this.splitScreenGraceRemaining--;
          if (this.splitScreenTimerEl) {
            this.splitScreenTimerEl.textContent = `${this.splitScreenGraceRemaining}`;
          }

          if (this.splitScreenGraceRemaining <= 0) {
            clearInterval(this.splitScreenGraceTimer);
            this.splitScreenGraceTimer = null;
            this.hideSplitScreenBlackout();
            this.isCompleted = true;

            this.recordIncident({
              category: 'cheating_attempt',
              type: 'split_screen_fatal_violation',
              message: 'Тест анульовано: розділення екрана не вимкнено протягом 10 секунд',
              penalty: 100,
              severity: 'danger'
            });

            this.options.onFatalViolation({
              reason: 'Тест анульовано за недоброчесність: розділення екрана не було вимкнено протягом 10 секунд!'
            });
          }
        }, 1000);
      }
    } else {
      if (this.isInsideSplitScreenGrace) {
        this.isInsideSplitScreenGrace = false;
        if (this.splitScreenGraceTimer) {
          clearInterval(this.splitScreenGraceTimer);
          this.splitScreenGraceTimer = null;
        }
        this.hideSplitScreenBlackout();

        this.recordIncident({
          category: 'device_state',
          type: 'split_screen_restored',
          message: 'Розділення екрана вимкнено, повний екран відновлено',
          penalty: 0,
          severity: 'info'
        });
      }
    }
  }

  initInputGuards() {
    document.addEventListener('contextmenu', (e) => {
      if (this.isBypassed) return true;
      e.preventDefault();
      this.recordIncident({
        category: 'input_restriction',
        type: 'context_menu_blocked',
        message: 'Спроба виклику контекстного меню',
        penalty: 1,
        severity: 'warning'
      });
      return false;
    });

    document.addEventListener('copy', (e) => {
      if (this.isBypassed) return true;
      e.preventDefault();
      this.recordIncident({
        category: 'cheating_attempt',
        type: 'clipboard_copy',
        message: 'Спроба скопіювати текст завдання',
        penalty: 5,
        severity: 'danger'
      });
      return false;
    });

    document.addEventListener('paste', (e) => {
      if (this.isBypassed) return true;
      e.preventDefault();
      this.recordIncident({
        category: 'cheating_attempt',
        type: 'clipboard_paste',
        message: 'Спроба вставки стороннього тексту',
        penalty: 5,
        severity: 'danger'
      });
      return false;
    });

    document.addEventListener('selectstart', (e) => {
      if (this.isBypassed) return true;
      e.preventDefault();
      return false;
    });

    window.addEventListener('keydown', (e) => {
      if (this.isCompleted || this.isBypassed) return;
      const key = e.key ? e.key.toUpperCase() : '';
      const isCtrlOrMeta = e.ctrlKey || e.metaKey;

      if (e.key === 'F12' || (isCtrlOrMeta && e.shiftKey && ['I', 'J', 'C'].includes(key)) || (isCtrlOrMeta && key === 'U')) {
        e.preventDefault();
        this.recordIncident({
          category: 'devtools_opened',
          type: 'devtools_shortcut_blocked',
          message: `Спроба відкриття DevTools: ${e.key}`,
          penalty: 12,
          severity: 'danger'
        });
        return false;
      }

      if (e.key === 'PrintScreen' || (isCtrlOrMeta && e.shiftKey && key === 'S')) {
        e.preventDefault();
        this.flashScreen();
        this.recordIncident({
          category: 'cheating_attempt',
          type: 'print_screen_attempt',
          message: 'Спроба зробити знімок екрана — екран заблоковано',
          penalty: 7,
          severity: 'danger'
        });
        return false;
      }

      if (e.altKey && e.key === 'Tab') {
        this.recordIncident({
          category: 'cheating_attempt',
          type: 'alt_tab_key',
          message: 'Натиснуто Alt+Tab для перемикання вікон',
          penalty: 7,
          severity: 'danger'
        });
      }

      if (e.key === 'Meta' || e.key === 'OS' || e.key === 'Super') {
        e.preventDefault();
        this.recordIncident({
          category: 'cheating_attempt',
          type: 'system_key_blocked',
          message: 'Натискання Win/Meta клавіші — можливий виклик системного ШІ або меню',
          penalty: 5,
          severity: 'warning'
        });
        this.options.onWarning({
          title: 'Системна клавіша заблокована',
          message: 'Виклик системного меню або асистента під час тесту є порушенням.',
          severity: 'warning'
        });
        return false;
      }

      if (isCtrlOrMeta && ['G', 'R', 'F'].includes(key)) {
        e.preventDefault();
      }
    });
  }

  initAdvancedGuards() {
    this._trapBackButton();
    this._watchPictureInPicture();
    this._watchScreenShare();
    this._watchClipboardRead();
    this._initBeforeUnloadTrap();
    this._initDragBlocker();
    this._initShakeDetector();
    this._initCameraMonitor();
    this._injectScreenshotPoisonLayer();
  }

  flashScreen(durationMs = 1500) {
    if (this._flashActive) return;
    this._flashActive = true;
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483647',
      'background:rgba(255,255,255,0.9)', 'pointer-events:none',
      'transition:opacity 0.25s ease'
    ].join(';');
    document.body.appendChild(overlay);
    setTimeout(() => {
      overlay.style.opacity = '0';
      setTimeout(() => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        this._flashActive = false;
      }, 300);
    }, durationMs);
  }

  blackoutScreen(durationMs = 5000) {
    if (this._blackoutActive) return;
    this._blackoutActive = true;
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483646',
      'background:#000000', 'pointer-events:all',
      'display:flex', 'align-items:center', 'justify-content:center',
      'flex-direction:column', 'gap:10px',
      'transition:opacity 0.25s ease'
    ].join(';');

    const remaining = document.createElement('div');
    remaining.style.cssText = 'color:#ffffff;font-size:22px;font-family:monospace;font-weight:700;';
    remaining.textContent = `${Math.round(durationMs / 1000)}`;

    const hint = document.createElement('div');
    hint.style.cssText = 'color:#555555;font-size:11px;font-family:sans-serif;';
    hint.textContent = 'Зачекайте...';

    overlay.appendChild(remaining);
    overlay.appendChild(hint);
    document.body.appendChild(overlay);

    let left = Math.round(durationMs / 1000);
    const tick = setInterval(() => {
      left--;
      remaining.textContent = `${left}`;
      if (left <= 0) clearInterval(tick);
    }, 1000);

    setTimeout(() => {
      overlay.style.opacity = '0';
      setTimeout(() => {
        overlay.remove();
        this._blackoutActive = false;
      }, 280);
    }, durationMs);
  }

  _initBeforeUnloadTrap() {
    window.addEventListener('beforeunload', (e) => {
      if (!this.isRunning || this.isCompleted) return;
      e.preventDefault();
      e.returnValue = 'Тест буде зупинено. Ви впевнені?';
      this.recordIncident({
        category: 'cheating_attempt',
        type: 'page_unload_attempt',
        message: 'Спроба закрити або перезавантажити сторінку тесту',
        penalty: 5,
        severity: 'warning'
      });
      return e.returnValue;
    });
  }

  _initDragBlocker() {
    document.addEventListener('dragstart', (e) => {
      e.preventDefault();
      return false;
    });
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      return false;
    });
  }

  _initShakeDetector() {
    if (!window.DeviceMotionEvent) return;
    let lastX = null, lastY = null, lastZ = null;
    let lastShakeTime = 0;

    const onMotion = (event) => {
      if (!this.isRunning || this.isCompleted) return;
      const a = event.accelerationIncludingGravity;
      if (!a || a.x == null) return;

      if (lastX !== null) {
        const dx = Math.abs(a.x - lastX);
        const dy = Math.abs(a.y - lastY);
        const dz = Math.abs(a.z - lastZ);
        const delta = dx + dy + dz;

        if (delta > 60 && Date.now() - lastShakeTime > 2000) {
          lastShakeTime = Date.now();
          this.recordIncident({
            category: 'device_state',
            type: 'device_shake',
            message: 'Різкий рух пристрою — можлива спроба фотографування іншим пристроєм',
            penalty: 0,
            severity: 'info'
          });
        }
      }
      lastX = a.x; lastY = a.y; lastZ = a.z;
    };

    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      DeviceMotionEvent.requestPermission()
        .then(p => { if (p === 'granted') window.addEventListener('devicemotion', onMotion); })
        .catch(() => {});
    } else {
      window.addEventListener('devicemotion', onMotion);
    }
  }

  _injectScreenshotPoisonLayer() {
    const style = document.createElement('style');
    style.textContent = `
      @media print {
        body > * { display: none !important; }
        body::after {
          content: 'ЗНІМОК ЕКРАНА ЗАФІКСОВАНО. ID: ${this.options.sessionId}';
          display: block;
          font-size: 32px;
          color: red;
          text-align: center;
          margin-top: 40vh;
        }
      }
    `;
    document.head.appendChild(style);

    window.addEventListener('keyup', (e) => {
      if (e.key === 'PrintScreen') {
        this.flashScreen(1500);
      }
    });
  }



  _initCameraMonitor() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;

    this._cameraStream = null;
    this._cameraActive = false;

    const attachStream = (stream) => {
      this._cameraStream = stream;
      this._cameraActive = true;
      const overlay = document.getElementById('cameraBlockedOverlay');
      if (overlay) overlay.remove();

      stream.getTracks().forEach(track => {
        track.onended = () => {
          this._cameraActive = false;
          showOverlay();
        };
      });

      this._showCameraIndicator();
    };

    const showOverlay = () => {
      this._cameraActive = false;
      this.recordIncident({
        category: 'device_state',
        type: 'camera_access_denied',
        message: 'Доступ до камери відсутній або відкликаний під час тесту',
        penalty: 0,
        severity: 'warning'
      });
      this._showCameraBlockedOverlay(() => {
        navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 } },
          audio: false
        }).then(attachStream).catch(() => {});
      });
    };

    if (this.options.cameraStream && this.options.cameraStream.active) {
      attachStream(this.options.cameraStream);
    } else {
      this.recordIncident({
        category: 'device_state',
        type: 'camera_not_active',
        message: 'Тест розпочато без увімкненої камери (необов\'язково)',
        penalty: 0,
        severity: 'info'
      });
    }
  }

  _showCameraBlockedOverlay(onRetry) {
    if (document.getElementById('cameraBlockedOverlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'cameraBlockedOverlay';
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483645',
      'background:#0f172a', 'color:#fff',
      'display:flex', 'flex-direction:column',
      'align-items:center', 'justify-content:center',
      'padding:24px', 'text-align:center', 'box-sizing:border-box'
    ].join(';');

    const icon = document.createElement('div');
    icon.style.cssText = 'margin-bottom:12px;display:flex;align-items:center;justify-content:center;';
    icon.innerHTML = '<img src="/img/icons/blocked.svg" class="pixel-icon large" alt="" style="width:48px;height:48px;">';

    const title = document.createElement('h2');
    title.style.cssText = 'font-size:18px;font-weight:700;margin:0 0 8px;color:#ef4444;';
    title.textContent = 'Камеру вимкнено або відключено';

    const desc = document.createElement('p');
    desc.style.cssText = 'font-size:13px;color:#94a3b8;max-width:380px;line-height:1.5;margin:0 0 18px;';
    desc.textContent = 'Зв\'язок з камерою перервано. Ви можете спробувати увімкнути її знову або продовжити складання тесту без камери.';

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;flex-direction:column;gap:10px;align-items:center;';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = [
      'padding:10px 20px', 'font-size:13px', 'font-weight:600',
      'background:#6366f1', 'color:#fff', 'border:none',
      'border-radius:6px', 'cursor:pointer'
    ].join(';');
    btn.innerHTML = '<img src="/img/icons/refresh.svg" class="pixel-icon inline" alt="" style="margin-right:6px;vertical-align:-2px;">Увімкнути камеру';
    btn.onclick = () => {
      if (typeof onRetry === 'function') onRetry();
    };

    const skipBtn = document.createElement('button');
    skipBtn.type = 'button';
    skipBtn.style.cssText = [
      'padding:8px 18px', 'font-size:12px', 'font-weight:600',
      'background:transparent', 'color:#94a3b8', 'border:1px solid rgba(148,163,184,0.3)',
      'border-radius:6px', 'cursor:pointer'
    ].join(';');
    skipBtn.textContent = 'Продовжити тест без камери';
    skipBtn.onclick = () => {
      overlay.remove();
    };

    btnRow.appendChild(btn);
    btnRow.appendChild(skipBtn);

    overlay.appendChild(icon);
    overlay.appendChild(title);
    overlay.appendChild(desc);
    overlay.appendChild(btnRow);
    document.body.appendChild(overlay);
  }

  _showCameraIndicator() {
    const dot = document.createElement('div');
    dot.id = 'cameraIndicator';
    dot.style.cssText = [
      'position:fixed',
      'top:max(calc(env(safe-area-inset-top, 0px) + 12px), 20px)',
      'right:max(calc(env(safe-area-inset-right, 0px) + 12px), 16px)',
      'z-index:9998',
      'width:8px', 'height:8px', 'border-radius:50%',
      'background:#ef4444', 'pointer-events:none',
      'box-shadow:0 0 0 0 rgba(239,68,68,0.6)',
      'animation:camPulse 1.8s infinite'
    ].join(';');

    const style = document.createElement('style');
    style.textContent = `
      @keyframes camPulse {
        0%   { box-shadow: 0 0 0 0 rgba(239,68,68,0.6); }
        70%  { box-shadow: 0 0 0 6px rgba(239,68,68,0); }
        100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); }
      }
    `;
    document.head.appendChild(style);
    document.body.appendChild(dot);
  }



  sendProgress(questionIndex, totalQuestions) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'student_progress',
        sessionId: this.options.sessionId,
        questionIndex,
        totalQuestions
      }));
    }
  }

  _adminOverrideUnlock(trustScore = 70) {
    if (this.splitScreenGraceTimer) {
      clearInterval(this.splitScreenGraceTimer);
      this.splitScreenGraceTimer = null;
    }
    this.isInsideSplitScreenGrace = false;
    this.splitScreenGraceRemaining = 10;
    this.hideSplitScreenBlackout();

    const splitEl = document.getElementById('splitScreenBlackout');
    if (splitEl) splitEl.remove();

    const blackoutEl = document.getElementById('screenBlackout');
    if (blackoutEl) blackoutEl.remove();

    const camOverlay = document.getElementById('cameraBlockedOverlay');
    if (camOverlay) camOverlay.remove();

    const fatalEl = document.getElementById('fatalViolationOverlay');
    if (fatalEl) fatalEl.remove();

    if (this.fullscreenGraceTimer) {
      clearInterval(this.fullscreenGraceTimer);
      this.fullscreenGraceTimer = null;
    }
    this.isInsideFullscreenGrace = false;
    this.isCompleted = false;

    this.options.onWarning(null);
    if (typeof this.options.onTrustScoreUpdate === 'function') {
      this.options.onTrustScoreUpdate(trustScore);
    }
    if (typeof this.options.onAdminUnlock === 'function') {
      this.options.onAdminUnlock({ trustScore });
    }

    const banner = document.createElement('div');
    banner.style.cssText = [
      'position:fixed',
      'bottom:calc(env(safe-area-inset-bottom, 0px) + 16px)',
      'left:50%', 'transform:translateX(-50%)',
      'z-index:2147483647', 'background:#10b981', 'color:#fff',
      'padding:10px 20px', 'border-radius:8px', 'font-size:13px',
      'font-weight:600', 'box-shadow:0 4px 20px rgba(0,0,0,0.3)',
      'display:flex', 'align-items:center', 'gap:8px'
    ].join(';');
    banner.innerHTML = `<img src="/img/icons/check.svg" class="pixel-icon inline" alt=""> Доступ відновлено адміністратором (довіра: ${trustScore}%)`;
    document.body.appendChild(banner);
    setTimeout(() => { if (banner.parentNode) banner.parentNode.removeChild(banner); }, 5000);
  }

  _adminOverrideBypass(trustScore = 70) {
    this.isBypassed = true;
    this.isCompleted = false;

    this.checkSplitScreen = () => {};
    this.detectDevTools = () => {};
    this.handleFullscreenExit = () => {};

    if (this.splitScreenCheckTimer) {
      clearInterval(this.splitScreenCheckTimer);
      this.splitScreenCheckTimer = null;
    }
    if (this.splitScreenGraceTimer) {
      clearInterval(this.splitScreenGraceTimer);
      this.splitScreenGraceTimer = null;
    }
    if (this.fullscreenGraceTimer) {
      clearInterval(this.fullscreenGraceTimer);
      this.fullscreenGraceTimer = null;
    }

    this.hideSplitScreenBlackout();
    const splitEl = document.getElementById('splitScreenBlackout');
    if (splitEl) splitEl.remove();
    const blackoutEl = document.getElementById('screenBlackout');
    if (blackoutEl) blackoutEl.remove();
    const camOverlay = document.getElementById('cameraBlockedOverlay');
    if (camOverlay) camOverlay.remove();
    const fatalEl = document.getElementById('fatalViolationOverlay');
    if (fatalEl) fatalEl.remove();

    this.options.onWarning(null);
    if (typeof this.options.onTrustScoreUpdate === 'function') {
      this.options.onTrustScoreUpdate(trustScore);
    }
    if (typeof this.options.onAdminBypass === 'function') {
      this.options.onAdminBypass({ trustScore });
    }

    const banner = document.createElement('div');
    banner.style.cssText = [
      'position:fixed',
      'bottom:calc(env(safe-area-inset-bottom, 0px) + 16px)',
      'left:50%', 'transform:translateX(-50%)',
      'z-index:2147483647', 'background:#6366f1', 'color:#fff',
      'padding:10px 20px', 'border-radius:8px', 'font-size:13px',
      'font-weight:600', 'box-shadow:0 4px 20px rgba(0,0,0,0.3)',
      'display:flex', 'align-items:center', 'gap:8px'
    ].join(';');
    banner.innerHTML = '<img src="/img/icons/key.svg" class="pixel-icon inline" alt=""> Режим перевірки відключено адміністратором. Продовжуйте тест.';
    document.body.appendChild(banner);
    setTimeout(() => { if (banner.parentNode) banner.parentNode.removeChild(banner); }, 7000);
  }


  _trapBackButton() {
    history.pushState(null, '', location.href);
    window.addEventListener('popstate', () => {
      if (!this.isRunning || this.isCompleted) return;
      history.pushState(null, '', location.href);
      this.recordIncident({
        category: 'cheating_attempt',
        type: 'back_button_pressed',
        message: 'Натискання кнопки "Назад" під час тесту',
        penalty: 7,
        severity: 'danger'
      });
      this.options.onWarning({
        title: 'Кнопку "Назад" заблоковано!',
        message: 'Навігація назад під час тесту фіксується як порушення.',
        severity: 'danger'
      });
    });
  }

  _watchPictureInPicture() {
    document.addEventListener('enterpictureinpicture', () => {
      if (!this.isRunning || this.isCompleted) return;
      this.recordIncident({
        category: 'cheating_attempt',
        type: 'picture_in_picture',
        message: 'Активовано режим Picture-in-Picture (плаваюче вікно)',
        penalty: 12,
        severity: 'danger'
      });
      this.options.onWarning({
        title: 'Picture-in-Picture заборонено!',
        message: 'Режим плаваючого вікна під час тесту є грубим порушенням.',
        severity: 'danger'
      });
      try { document.exitPictureInPicture(); } catch (_) {}
    });
  }

  _watchScreenShare() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) return;
    const orig = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getDisplayMedia = async (...args) => {
      this.recordIncident({
        category: 'cheating_attempt',
        type: 'screen_share_attempt',
        message: 'Спроба запустити трансляцію або запис екрана',
        penalty: 15,
        severity: 'danger'
      });
      this.options.onWarning({
        title: 'Запис екрана заборонено!',
        message: 'Трансляція або запис екрана під час тесту є грубим порушенням.',
        severity: 'danger'
      });
      throw new DOMException('Screen capture blocked by proctor', 'NotAllowedError');
    };
  }

  _watchClipboardRead() {
    if (!navigator.clipboard) return;
    const blocker = async () => {
      this.recordIncident({
        category: 'cheating_attempt',
        type: 'clipboard_read_api',
        message: 'Спроба читання буфера обміну через Clipboard API',
        penalty: 10,
        severity: 'danger'
      });
      throw new DOMException('Clipboard read blocked', 'NotAllowedError');
    };
    if (navigator.clipboard.readText) navigator.clipboard.readText = blocker;
    if (navigator.clipboard.read) navigator.clipboard.read = blocker;
  }



  initWatermark() {
    this.watermarkCanvas = document.createElement('canvas');
    this.watermarkCanvas.className = 'watermark-layer';
    document.body.appendChild(this.watermarkCanvas);

    const render = () => {
      if (!this.watermarkCanvas) return;
      this.watermarkCanvas.width = window.innerWidth;
      this.watermarkCanvas.height = window.innerHeight;
      const ctx = this.watermarkCanvas.getContext('2d');
      ctx.clearRect(0, 0, this.watermarkCanvas.width, this.watermarkCanvas.height);

      ctx.font = this.isMobile ? '11px monospace' : '13px monospace';
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      ctx.fillStyle = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.055)';
      ctx.rotate((-22 * Math.PI) / 180);

      const timestamp = new Date().toLocaleTimeString();
      const text = `${this.options.studentName} | ${this.options.studentId} | ${this.deviceType} | ${timestamp}`;

      const stepY = this.isMobile ? 100 : 120;
      const stepX = this.isMobile ? 300 : 380;

      for (let y = -window.innerHeight; y < window.innerHeight * 2; y += stepY) {
        for (let x = -window.innerWidth; x < window.innerWidth * 2; x += stepX) {
          ctx.fillText(text, x, y);
        }
      }
    };

    render();
    window.addEventListener('resize', render);
    this.watermarkInterval = setInterval(render, 1000);
  }

  recordIncident(incident) {
    if (this.isBypassed && (incident.penalty || incident.severity === 'danger')) {
      return;
    }

    const enrichedIncident = {
      ...incident,
      timestamp: Date.now(),
      studentName: this.options.studentName,
      studentId: this.options.studentId,
      deviceType: this.deviceType
    };

    this.options.onIncident(enrichedIncident);

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'incident',
        sessionId: this.options.sessionId,
        incident: enrichedIncident
      }));
    } else {
      this.offlineQueue.push(enrichedIncident);
      fetch('/api/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: this.options.sessionId,
          incident: enrichedIncident
        })
      }).catch(() => {});
    }
  }

  async flushOfflineQueue() {
    if (this.offlineQueue.length === 0) return;
    const items = [...this.offlineQueue];
    this.offlineQueue = [];

    for (const item of items) {
      try {
        await fetch('/api/incidents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: this.options.sessionId,
            incident: item
          })
        });
      } catch {
        this.offlineQueue.push(item);
      }
    }
  }

  destroy() {
    this.isRunning = false;
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.splitScreenCheckTimer) clearInterval(this.splitScreenCheckTimer);
    if (this.splitScreenGraceTimer) clearInterval(this.splitScreenGraceTimer);
    this.hideSplitScreenBlackout();
    if (this.fullscreenGraceTimer) clearInterval(this.fullscreenGraceTimer);
    if (this.watermarkInterval) clearInterval(this.watermarkInterval);
    if (this._cameraStream) {
      this._cameraStream.getTracks().forEach(t => t.stop());
      this._cameraStream = null;
    }
    const camDot = document.getElementById('cameraIndicator');
    if (camDot) camDot.remove();
    const camOverlay = document.getElementById('cameraBlockedOverlay');
    if (camOverlay) camOverlay.remove();
    if (this.watermarkCanvas && this.watermarkCanvas.parentNode) {
      this.watermarkCanvas.parentNode.removeChild(this.watermarkCanvas);
    }
    if (this.ws) {
      this.ws.close();
    }
  }
}
