const API_BASE = '/api';
import { FloatingAvatars } from './floating-avatars.js';

const App = {
    floatingAvatars: null,
    balance: 0,
    lastLeaderboard: [],
    leaderboardLoaded: false,
    freeSpins: 15,
    userData: null,
    spinHistory: [],
    pendingPayment: null,
    resultTimeout: null,
    verifyState: { step: 1, nickname: '', code: '' }, // verification flow state
    appMode: 'active',

    openThreadsUrl(url) {
        if (!url) return;

        // Extract username from URL if it's a profile link (e.g. https://www.threads.com/@username)
        const profileMatch = url.match(/threads\.(?:com|net)\/@([^/?#]+)/);
        const intentMatch = url.match(/threads\.(?:com|net)\/intent/);

        if (profileMatch && !intentMatch) {
            const username = profileMatch[1];
            const webUrl = `https://www.threads.com/@${username}`;

            // We use Telegram.WebApp.openLink for everything. 
            // It safely opens the URL in the in-app browser or native app if associated.
            // Direct window.location.href = 'threads://...' causes ERR_UNKNOWN_URL_SCHEME on Android WebViews.
            if (window.Telegram?.WebApp?.openLink) {
                window.Telegram.WebApp.openLink(webUrl);
            } else {
                window.open(webUrl, '_blank');
            }
        } else {
            // For non-profile links (e.g. intent/post), open normally
            const finalUrl = url.replace('threads.net', 'threads.com');
            if (window.Telegram?.WebApp?.openLink) {
                window.Telegram.WebApp.openLink(finalUrl);
            } else {
                window.open(finalUrl, '_blank');
            }
        }
    },

    async init() {
        if (!TelegramApp.init()) console.warn('Telegram not available');
        I18n.init();
        this.updateLangButtons();
        document.documentElement.setAttribute('data-theme', 'dark');

        // Init background engine immediately
        this.floatingAvatars = new FloatingAvatars('bg-canvas');

        this.currentTab = 'wheel';
        this.bindEvents();
        this.setupKeyboardDetection();

        // Update button text to correct localized string instead of "..." ASAP
        this.updateSpinButton();

        await this.loadInitialData();
        if (this.userData && this.userData.app_mode) {
            this.setAppMode(this.userData.app_mode);
        }

        // Handle deep links
        const startParam = TelegramApp.webapp?.initDataUnsafe?.start_param;
        if (startParam === 'leaderboard') {
            this.switchTab('leaderboard');
        }

        // Small delay to ensure spheres are visible then hide splash
        setTimeout(() => this.hideSplashScreen(), 500);

        setInterval(() => this.loadLeaderboard(true), 30000);
    },

    hideSplashScreen() {
        const splash = document.getElementById('splash-screen');
        const app = document.getElementById('app');
        if (splash) {
            splash.classList.add('fade-out');
            app?.classList.remove('app-loading');
            setTimeout(() => splash.remove(), 800);
        }
    },

    setAppMode(mode) {
        this.appMode = mode;
        document.getElementById('maintenance-stub').classList.toggle('hidden', mode !== 'maintenance');
        document.getElementById('verification-stub').classList.toggle('hidden', mode !== 'verify_only');

        const blockedStub = document.getElementById('blocked-stub');
        if (blockedStub) blockedStub.classList.toggle('hidden', mode !== 'blocked');

        document.getElementById('main-app-content')?.classList.toggle('hidden', mode !== 'active');

        if (mode === 'maintenance' || mode === 'verify_only' || mode === 'blocked') {
            document.querySelector('.clay-nav')?.classList.add('hidden');
            // If verify_only and already verified, we might want to show a success message instead of the form
            if (mode === 'verify_only' && this.userData?.threads_verified) {
                this.showVerificationOnlySuccess();
            } else if (mode === 'verify_only') {
                this.initStandaloneVerify();
            }
        } else {
            document.querySelector('.clay-nav')?.classList.remove('hidden');
        }
    },

    showVerificationOnlySuccess() {
        const stub = document.getElementById('verification-stub');
        if (stub) {
            stub.innerHTML = `
                <div class="stub-content clay-card" style="padding-bottom: 30px;">
                    <div class="stub-icon">
                        <svg viewBox="0 0 24 24" width="60" height="60" fill="none" stroke="#10b981" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 0 15px rgba(16, 185, 129, 0.4));">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                            <polyline points="22 4 12 14.01 9 11.01"></polyline>
                        </svg>
                    </div>
                    <h1 data-i18n="verify_success" style="margin-bottom: 10px;">${I18n.t('verify_success')}</h1>
                    <p style="line-height: 1.4; font-size: 15px;">${I18n.t('verify_only_success')}</p>
                </div>
            `;
            // Use event delegation so click works even if link is inside i18n HTML
            stub.addEventListener('click', (e) => {
                const link = e.target.closest('.threads-link');
                if (link) {
                    e.preventDefault();
                    this.openThreadsUrl('https://www.threads.com/@usemikehelp');
                }
            });
        }
    },

    showToast(message, type = 'info') {
        message = I18n.t(message);
        let container = document.querySelector('.toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'toast-container';
            document.body.appendChild(container);
        }
        const toast = document.createElement('div');
        toast.className = `toast`;
        let icon = type === 'success' ?
            '<svg class="clay-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>' :
            type === 'error' ?
                '<svg class="clay-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>' :
                type === 'warning' ?
                    '<svg class="clay-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="8" y1="12" x2="16" y2="12"></line></svg>' :
                    '<svg class="clay-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
        toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
        container.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('show'));
        TelegramApp.haptic(type === 'error' ? 'error' : 'success');
        setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3000);
    },

    setupKeyboardDetection() {
        if (window.visualViewport) {
            let initialHeight = window.visualViewport.height;
            window.visualViewport.addEventListener('resize', () => {
                const isKeyboard = initialHeight - window.visualViewport.height > 100;
                document.body.classList.toggle('keyboard-open', isKeyboard);
                if (this.floatingAvatars) {
                    this.floatingAvatars.setKeyboardVisible(isKeyboard);
                }
            });
        }
        const inputs = ['INPUT', 'TEXTAREA'];
        const update = (visible) => {
            document.body.classList.toggle('keyboard-open', visible);
            if (this.floatingAvatars) this.floatingAvatars.setKeyboardVisible(visible);
        };
        document.addEventListener('focusin', (e) => {
            if (inputs.includes(e.target.tagName)) update(true);
        });
        document.addEventListener('focusout', (e) => {
            if (inputs.includes(e.target.tagName)) update(false);
        });
    },

    setupArcSlider() {
        this.selectedSpinCost = 1;

        const svgCoords = { cx: 100, cy: 100, r: 85 };
        const startAngle = Math.PI; // Left (180 deg)
        const endAngle = 0;         // Right (0 deg)
        // SVG paths are drawn from (x1,y1) to (x2,y2).
        // A 180 to 0 sweep goes from x=15 to x=185 matching our M 15,100 A 85,85 0 0,1 185,100 path logic.

        const slider = document.querySelector('.cost-slider-svg');
        const activePath = document.getElementById('cost-slider-path');
        const thumb = document.getElementById('cost-slider-thumb');
        const costDisplayBox = document.getElementById('selected-cost-display');
        const costValueStr = document.getElementById('selected-cost-value');
        const spinControls = document.getElementById('spin-controls');

        if (!slider || !activePath || !thumb || !spinControls) return;

        // Path length for dasharray (half circumference)
        const pathLength = Math.PI * svgCoords.r;
        activePath.style.strokeDasharray = `${pathLength}`;
        activePath.style.strokeDashoffset = `${pathLength}`; // Initially empty (cost=1)

        let isDragging = false;

        const updateSliderFromEvent = (e) => {
            const rect = slider.getBoundingClientRect();
            // Get center relative to viewport
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;

            // Extract clientX/Y from mouse or touch event
            let clientX, clientY;
            if (e.touches && e.touches.length > 0) {
                clientX = e.touches[0].clientX;
                clientY = e.touches[0].clientY;
            } else {
                clientX = e.clientX;
                clientY = e.clientY;
            }

            // Calculate angle
            const dx = clientX - centerX;
            const dy = clientY - centerY;
            let angle = Math.atan2(dy, dx);
            // Normalize angle to [0, 2PI)
            if (angle < 0) angle += 2 * Math.PI;

            // We want angles between Math.PI (left) and 2*Math.PI (right for top-half arc).
            // Actually, atan2 gives positive y going DOWN.
            // SVG coordinate system has y going DOWN.
            // So top-half arc goes from PI (left) to 0 or 2PI (right), passing through 3PI/2 (top).

            // Constrain angle to the top half
            let normalizedAngle = angle;
            if (normalizedAngle >= 0 && normalizedAngle <= Math.PI / 2) {
                // right bottom quadrant -> map to right (0)
                normalizedAngle = 0;
            } else if (normalizedAngle > Math.PI / 2 && normalizedAngle < Math.PI) {
                // left bottom quadrant -> map to left (PI)
                normalizedAngle = Math.PI;
            }

            // Map angle back to a percentage (0 = left (PI), 1 = right (2*PI/0))
            // The angle goes from PI to 2PI. Subtract PI to get 0 to PI. Divide by PI to get 0 to 1.
            let percent;
            if (normalizedAngle === 0) percent = 1;
            else percent = (normalizedAngle - Math.PI) / Math.PI;

            percent = Math.max(0, Math.min(1, percent));
            this.setSliderPercent(percent);
        };

        this.setSliderPercent = (percent) => {
            const minCost = 1;
            const maxCost = 25;

            const rawCost = minCost + percent * (maxCost - minCost);
            const newCost = Math.round(rawCost);

            if (this.selectedSpinCost !== newCost) {
                this.selectedSpinCost = newCost;
                TelegramApp.haptic('selection');
                this.updateSpinButtonText(); // We will define this next
            }

            // Update visuals
            const exactPercent = (newCost - minCost) / (maxCost - minCost);

            // SVG arc starts at (40, 160) and sweeps to (160, 160). Center is (100, 160), R=60.
            // Wait, CSS says M 40,160 A 85,85. Wait, 40+85*2 = 210? No. 
            // In CSS: M 40,160 A 85,85 0 1,1 160,160
            // This means center is (100, 160), radius=60? No, distance from 40 to 160 is 120. Radius=60. 
            // Ah, A rx,ry x-axis-rotation large-arc-flag sweep-flag x,y.
            // For r=85, distance=120, it's not a full semicircle.
            // Let's use exact percentage stroke-dashoffset for simplicity and just move thumb mathematically.

            const dashOffset = pathLength * (1 - exactPercent);
            activePath.style.strokeDashoffset = `${dashOffset}`;

            // Calculate thumb position
            // The arc is from x=40 to x=160, y=160. Radius=85.
            // The chord length is 120 (from 40 to 160).
            // Center of circle must be satisfying (x-xc)^2 + (y-yc)^2 = R^2
            // Let's ignore complex SVG math and just calculate an approximate path position!
            const totalLength = activePath.getTotalLength();
            // Fallback for missing getTotalLength (e.g. standard tests)
            const resolvedLength = totalLength || pathLength;

            const point = activePath.getPointAtLength(resolvedLength * exactPercent);
            if (point) {
                thumb.setAttribute('cx', point.x);
                thumb.setAttribute('cy', point.y);
            }

            if (costValueStr) costValueStr.textContent = newCost;
        };

        const startDrag = (e) => {
            isDragging = true;
            if (costDisplayBox) costDisplayBox.classList.remove('hidden');
            updateSliderFromEvent(e);
            e.preventDefault(); // Stop scrolling on mobile
        };

        const drag = (e) => {
            if (!isDragging) return;
            updateSliderFromEvent(e);
            e.preventDefault();
        };

        const stopDrag = () => {
            if (isDragging) {
                isDragging = false;
                if (costDisplayBox) costDisplayBox.classList.add('hidden');
                TelegramApp.haptic('impact'); // Finalize selection
            }
        };

        thumb.addEventListener('mousedown', startDrag);
        thumb.addEventListener('touchstart', startDrag, { passive: false });
        spinControls.addEventListener('mousedown', (e) => {
            // Also allow clicking on the track itself
            if (e.target === thumb || e.target === slider || e.target.classList.contains('cost-slider-bg')) {
                startDrag(e);
            }
        });
        spinControls.addEventListener('touchstart', (e) => {
            if (e.target === thumb || e.target === slider || e.target.classList.contains('cost-slider-bg')) {
                startDrag(e);
            }
        }, { passive: false });

        document.addEventListener('mousemove', drag);
        document.addEventListener('touchmove', drag, { passive: false });
        document.addEventListener('mouseup', stopDrag);
        document.addEventListener('touchend', stopDrag);

        // Init
        this.setSliderPercent(0); // Sets cost to 1
    },

    bindEvents() {
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.addEventListener('click', (e) => { e.preventDefault(); this.switchTab(btn.dataset.tab); });
        });

        document.getElementById('spin-btn')?.addEventListener('click', () => this.spin());

        // Arc Slider Logic
        this.setupArcSlider();

        // Star Sparkle
        document.querySelector('.clay-header .clay-badge')?.addEventListener('click', () => {
            const star = document.querySelector('.clay-header .clay-star');
            if (star) {
                star.classList.remove('sparkle-active');
                void star.offsetWidth; // Trigger reflow
                star.classList.add('sparkle-active');
                TelegramApp.haptic('impact');
            }
        });

        document.getElementById('deposit-btn')?.addEventListener('click', () => this.showDepositModal());

        document.querySelectorAll('.deposit-btn').forEach(btn => {
            btn.addEventListener('click', () => this.createDeposit(parseInt(btn.dataset.amount)));
        });

        document.getElementById('custom-deposit-btn')?.addEventListener('click', () => {
            const amount = parseInt(document.getElementById('custom-deposit').value);
            if (amount > 0 && amount <= 10000) this.createDeposit(amount);
            else this.showToast(I18n.t('deposit_amount_error'), 'error');
        });

        const searchBtn = document.getElementById('search-btn');
        searchBtn?.addEventListener('click', () => {
            if (searchBtn.textContent === 'X') {
                document.getElementById('search-input').value = '';
                document.getElementById('search-result').classList.add('hidden');
                document.getElementById('search-result').innerHTML = '';
                searchBtn.textContent = 'Go';
            } else {
                this.searchUser();
            }
        });
        document.getElementById('search-input')?.addEventListener('input', (e) => {
            const val = e.target.value.trim();
            if (val === '') {
                document.getElementById('search-result').classList.add('hidden');
                document.getElementById('search-result').innerHTML = '';
            }
            if (searchBtn && searchBtn.textContent === 'X' && val !== '') {
                searchBtn.textContent = 'Go';
            }
        });
        document.getElementById('search-input')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') { e.target.blur(); this.searchUser(); }
        });

        document.getElementById('link-threads-btn')?.addEventListener('click', () => this.openVerifyModal());
        document.getElementById('verify-only-start-btn')?.addEventListener('click', () => this.openVerifyModal());
        document.getElementById('verify-modal-close')?.addEventListener('click', () => this.closeVerifyModal());
        document.getElementById('verify-modal-overlay')?.addEventListener('click', () => this.closeVerifyModal());
        document.getElementById('verify-search-btn')?.addEventListener('click', () => this.searchThreadsForVerify());
        document.getElementById('verify-nick-input')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') { e.target.blur(); this.searchThreadsForVerify(); }
        });
        document.getElementById('verify-publish-btn')?.addEventListener('click', () => this.openThreadsPublish());
        document.getElementById('verify-check-btn')?.addEventListener('click', () => this.checkVerification());

        // Standalone Verification Stub Bindings
        document.getElementById('vo-search-btn')?.addEventListener('click', () => this.searchThreadsForVerify(true));
        document.getElementById('vo-nick-input')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') { e.target.blur(); this.searchThreadsForVerify(true); }
        });
        document.getElementById('vo-copy-btn')?.addEventListener('click', () => {
            const code = this.verifyState.code;
            if (code) {
                const text = I18n.t('verify_post_text', { code });
                this.copyToClipboard(text);
            }
        });
        document.getElementById('vo-publish-btn')?.addEventListener('click', () => this.openThreadsPublish(true));
        document.getElementById('vo-check-btn')?.addEventListener('click', () => this.checkVerification(true));

        document.querySelectorAll('.modal-close').forEach(btn => {
            if (btn.id !== 'verify-modal-close') {
                btn.addEventListener('click', () => this.closeModals());
            }
        });
        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            if (overlay.id !== 'verify-modal-overlay') {
                overlay.addEventListener('click', () => this.closeModals());
            }
        });

        document.querySelectorAll('.lang-option').forEach(opt => {
            opt.addEventListener('click', () => {
                I18n.setLanguage(opt.dataset.lang);
                this.updateSpinButton();
                if (this.userData) this.updateProfileUI(this.userData);
                // Re-render search result if visible
                if (this.lastSearchResult) {
                    const container = document.getElementById('search-result');
                    if (container && !container.classList.contains('hidden')) {
                        this.showSearchFound(this.lastSearchResult, container);
                    }
                }
                TelegramApp.haptic('impact');
            });
        });

        document.getElementById('disconnect-threads-btn')?.addEventListener('click', () => this.disconnectThreads());
        document.getElementById('copy-verify-text-btn')?.addEventListener('click', () => {
            const code = this.verifyState.code;
            if (code) {
                const text = I18n.t('verify_post_text', { code });
                this.copyToClipboard(text);
            }
        });

        // iOS Active State Fix
        // Replaces CSS :active to prevent Safari from tap-highlighting the whole body
        document.body.addEventListener('touchstart', (e) => {
            const btn = e.target.closest('button, .clay-btn, .clay-icon-btn, .nav-item, .clay-list-item, .modal-close');
            if (btn && !btn.disabled) {
                btn.classList.add('is-active');
            }
        }, { passive: true });

        document.body.addEventListener('touchend', (e) => {
            const btn = e.target.closest('button, .clay-btn, .clay-icon-btn, .nav-item, .clay-list-item, .modal-close');
            if (btn) {
                btn.classList.remove('is-active');
            }

            // Dismiss keyboard on tap outside inputs, but NOT if tapping a button/link/nav
            const isInput = e.target.closest('input, textarea');
            const isInteractive = e.target.closest('button, .clay-btn, .clay-icon-btn, .nav-item, [onclick], a');

            if (!isInput && !isInteractive && document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
                document.activeElement.blur();
            }
        }, { passive: true });

        document.body.addEventListener('touchcancel', (e) => {
            document.querySelectorAll('.is-active').forEach(el => el.classList.remove('is-active'));
        }, { passive: true });
    },


    openSettings() {
        TelegramApp.haptic('impact');
        const page = document.getElementById('settings-page');
        if (page) {
            page.style.display = 'flex';
            setTimeout(() => page.classList.add('active'), 10);
            TelegramApp.showBackButton(() => this.closeSettings());
        }
    },

    closeSettings() {
        const page = document.getElementById('settings-page');
        if (page) {
            page.classList.remove('active');
            setTimeout(() => page.style.display = 'none', 400);
        }
        TelegramApp.hideBackButton();
    },

    switchTab(tabId) {
        TelegramApp.haptic('impact');
        document.activeElement?.blur();
        document.body.classList.remove('keyboard-open');
        document.querySelectorAll('.nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabId));
        document.querySelectorAll('.tab-content').forEach(tab => tab.classList.toggle('active', tab.id === `${tabId}-tab`));
        if (tabId === 'leaderboard' && !this.leaderboardLoaded) this.loadLeaderboard();
        else if (tabId === 'leaderboard') this.loadLeaderboard(true);
    },

    updateSpinButtonText() {
        const btnText = document.getElementById('spin-btn-text');
        const costText = document.getElementById('spin-cost');
        const costIcon = document.getElementById('spin-cost-stars-icon');

        if (!btnText || !costText || !costIcon) return;
        btnText.textContent = I18n.t('spin_button');

        if (this.freeSpins >= this.selectedSpinCost) {
            costIcon.classList.add('hidden');
            costText.textContent = I18n.t('spin_free', { n: this.freeSpins });
            // Optionally, if we want to show "Free (cost X)" we could, but let's stick to showing X stars on arc and "Free" on button.
        } else {
            // It's a paid spin
            costIcon.classList.remove('hidden');
            costText.textContent = this.selectedSpinCost;
        }
    },

    updateSpinButton() {
        this.updateSpinButtonText();
    },

    updateBalance(balance, freeSpins) {
        if (balance !== undefined) this.balance = balance;
        if (freeSpins !== undefined) this.freeSpins = freeSpins;
        const hb = document.getElementById('header-balance');
        if (hb) hb.textContent = this.balance;
        const sf = document.getElementById('stat-free');
        if (sf) sf.textContent = this.freeSpins;
        this.updateSpinButton();
    },

    async apiRequest(action, data = {}, retries = 3) {
        try {
            const response = await fetch('/api/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ initData: TelegramApp.getInitData(), action, ...data })
            });

            const result = await response.json();

            // Handle Unauthorized by waiting and retrying (maybe initData was refreshing)
            if (response.status === 401 && retries > 0) {
                await new Promise(r => setTimeout(r, 1000));
                return this.apiRequest(action, data, retries - 1);
            }

            if (!response.ok) {
                throw new Error(result.error || I18n.t('Request failed'));
            }

            return result;
        } catch (error) {
            const msg = error.message.toLowerCase();
            // "Failed to fetch" is Chrome/Firefox, "Load failed" is Safari/iOS WebKit
            const isNetworkError = msg.includes('fetch') || msg.includes('load failed') || msg.includes('network');

            if (isNetworkError && retries > 0) {
                // Wait longer between retries for network issues (e.g. user walked into elevator)
                await new Promise(r => setTimeout(r, 1500));
                return this.apiRequest(action, data, retries - 1);
            }

            // Provide a localized fallback for raw browser network errors
            if (isNetworkError) {
                throw new Error(I18n.t('Request failed'));
            }

            throw error;
        }
    },

    async loadInitialData() {
        try {
            const data = await this.apiRequest('init-app');
            if (data.success) {
                // User & Balance
                this.userData = data.user;
                this.updateBalance(data.user.balance, data.user.free_spins);
                this.updateProfileUI(data.user);

                // History
                if (data.history) {
                    this.spinHistory = data.history;
                    this.updateHistoryUI();
                }

                // Leaderboard pre-cache
                if (data.leaderboard) {
                    this.renderLeaderboard(data.leaderboard);
                }
            }
        } catch (error) {
            console.error('Failed to load initial data:', error);
        }
    },

    updateProfileUI(user) {
        const un = document.getElementById('user-name');
        if (un) un.textContent = user.first_name + (user.last_name ? ' ' + user.last_name : '');
        const av = document.getElementById('user-avatar');
        if (av && TelegramApp.user?.photo_url) {
            av.innerHTML = '';
            const img = document.createElement('img');
            img.src = TelegramApp.user.photo_url;
            img.referrerPolicy = "no-referrer";
            img.onerror = () => { av.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>'; };
            av.appendChild(img);
        } else if (av) {
            av.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>';
        }

        const sid = document.getElementById('stat-id');
        if (sid) sid.textContent = user.id;

        const ss = document.getElementById('stat-spins');
        const sd = document.getElementById('stat-deposited');
        if (ss) ss.textContent = user.total_spins || 0;
        if (sd) sd.textContent = user.total_deposited || 0;
        const se = document.getElementById('stat-earned');
        if (se) se.textContent = user.threads_star_balance || 0;

        this.updateProfileVerificationUI(user);
    },

    updateHistoryUI() {
        const list = document.getElementById('history-list');
        if (!list) return;
        list.innerHTML = '';

        this.spinHistory.slice(0, 15).forEach(spin => {
            const item = document.createElement('div');
            item.className = 'clay-list-item';

            const info = document.createElement('div');
            info.className = 'item-info';
            const nick = document.createElement('div');
            nick.className = 'item-nick';
            nick.textContent = `@${spin.participant_nickname}`;

            info.appendChild(nick);

            const score = document.createElement('div');
            score.className = 'item-score';
            score.style.fontSize = '14px';
            const starSvg = '<svg class="inline-star clay-star" viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
            score.innerHTML = spin.was_free ? I18n.t('profile_free_label') : `1 ${starSvg}`;

            item.appendChild(info);
            item.appendChild(score);
            list.appendChild(item);
        });

        if (this.spinHistory.length === 0) {
            list.innerHTML = `<div style="text-align:center;color:var(--text-mutted);padding:20px;">${I18n.t('profile_no_spins')}</div>`;
        }
    },

    async spin() {
        if (!this.floatingAvatars || this.floatingAvatars.isRolling) return;
        TelegramApp.haptic('impact');

        const spinBtn = document.getElementById('spin-btn');
        const btnText = document.getElementById('spin-btn-text');
        spinBtn.disabled = true;
        btnText.textContent = I18n.t('spin_spinning');

        const resultEl = document.getElementById('roll-result');
        if (resultEl) resultEl.classList.add('hidden');

        try {
            const data = await this.apiRequest('spin-wheel', { cost: this.selectedSpinCost });
            if (data.success) { this.animateAndShowResult(data, spinBtn, btnText); return; }
            if (data.need_payment) { await this.handlePaidSpin(spinBtn, btnText); return; }
            throw new Error(data.error || 'Spin failed');
        } catch (error) {
            this.showToast(error.message, 'error');
            this.showRetryAlert(error.message, () => {
                spinBtn.disabled = false;
                btnText.textContent = I18n.t('spin_button');
            });
            spinBtn.disabled = false;
            btnText.textContent = I18n.t('spin_button');
        }
    },

    async handlePaidSpin(spinBtn, btnText) {
        try {
            const invoiceData = await this.apiRequest('spin-paid', { cost: this.selectedSpinCost });
            if (!invoiceData.success) throw new Error(invoiceData.error);

            TelegramApp.openInvoice(invoiceData.invoiceUrl, async (status) => {
                if (status === 'paid') {
                    this.showToast('Success!', 'success');
                    btnText.textContent = I18n.t('spin_spinning');
                    await new Promise(r => setTimeout(r, 2000));
                    await this.loadInitialData();

                    if (this.spinHistory.length > 0) {
                        const last = this.spinHistory[0];
                        this.floatingAvatars.roll(() => {
                            this.showSpinResult({ nickname: last.participant_nickname, avatar_url: null, new_score: '?' });
                            spinBtn.disabled = false;
                            btnText.textContent = I18n.t('spin_button');
                        });
                    } else {
                        spinBtn.disabled = false;
                        btnText.textContent = I18n.t('spin_button');
                    }
                } else {
                    spinBtn.disabled = false;
                    btnText.textContent = I18n.t('spin_button');
                }
            });
        } catch (error) {
            this.showToast(error.message, 'error');
            spinBtn.disabled = false;
            btnText.textContent = I18n.t('spin_button');
        }
    },

    animateAndShowResult(data, spinBtn, btnText) {
        this.floatingAvatars.roll(() => {
            this.updateBalance(data.balance, data.free_spins_left);
            this.showSpinResult(data.participant);
            if (this.userData) {
                this.userData.balance = data.balance;
                this.userData.free_spins = data.free_spins_left;
                this.userData.total_spins = data.total_spins;
                if (data.threads_star_balance !== undefined) {
                    this.userData.threads_star_balance = data.threads_star_balance;
                }
                this.updateProfileUI(this.userData);
            }
            spinBtn.disabled = false;
            btnText.textContent = I18n.t('spin_button');
        });
    },


    async showSpinResult(participant) {
        TelegramApp.haptic('success');
        const resultEl = document.getElementById('roll-result');
        const avatarEl = document.getElementById('result-avatar');
        const nickEl = document.getElementById('result-nick');
        const scoreEl = document.getElementById('result-score');

        // Spawn Floating Avatars
        this.spawnPostSpinAvatars();

        if (resultEl && avatarEl && nickEl && scoreEl) {
            if (this.resultTimeout) clearTimeout(this.resultTimeout);

            avatarEl.innerHTML = '';
            if (participant.avatar_url) {
                const img = document.createElement('img');
                img.src = participant.avatar_url;
                img.referrerPolicy = "no-referrer";
                img.onerror = () => { avatarEl.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>'; };
                avatarEl.appendChild(img);
            } else {
                avatarEl.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>';
            }

            const url = `https://www.threads.com/@${participant.nickname}`;
            nickEl.innerHTML = `<a href="${url}" target="_blank" rel="noopener noreferrer" class="result-nick-link">@${participant.nickname}</a>`;
            nickEl.querySelector('a')?.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.openThreadsUrl(url);
            });
            scoreEl.textContent = I18n.t('score_plus', { score: 1 });

            let rankEl = document.getElementById('result-rank');
            if (!rankEl) {
                rankEl = document.createElement('div');
                rankEl.id = 'result-rank';
                rankEl.className = 'result-rank';
                document.querySelector('.result-info').appendChild(rankEl);
            }
            rankEl.textContent = `Rank: ...`;
            resultEl.classList.remove('hidden');

            try {
                const lbData = await this.apiRequest('leaderboard');
                let rankText = '?';
                if (lbData.success && lbData.leaderboard) {
                    this.lastLeaderboard = lbData.leaderboard;
                    const lbItem = lbData.leaderboard.find(i => i.nickname === participant.nickname);
                    if (lbItem) {
                        if (lbItem.rank === 1) rankText = '<span class="rank-badge rank-1">#1</span>';
                        else if (lbItem.rank === 2) rankText = '<span class="rank-badge rank-2">#2</span>';
                        else if (lbItem.rank === 3) rankText = '<span class="rank-badge rank-3">#3</span>';
                        else rankText = `#${lbItem.rank}`;
                    } else rankText = '>50';
                }
                rankEl.innerHTML = `Rank: ${rankText}`;
            } catch (e) { }

            this.resultTimeout = setTimeout(() => {
                resultEl.classList.add('hidden');
            }, 5000);
        }
    },

    spawnPostSpinAvatars() {
        const container = document.getElementById('post-spin-avatars');
        if (!container) return;

        // Use leaderboard or history as source of avatars
        let sources = [];
        if (this.lastLeaderboard && this.lastLeaderboard.length > 0) {
            sources = this.lastLeaderboard.filter(u => u.avatar_url).map(u => u.avatar_url);
        }

        // Add defaults if missing
        if (sources.length === 0) {
            sources = [
                'https://ui-avatars.com/api/?name=U1&background=random',
                'https://ui-avatars.com/api/?name=U2&background=random',
                'https://ui-avatars.com/api/?name=U3&background=random'
            ];
        }

        const count = Math.min(10, sources.length * 2); // 10 avatars max

        for (let i = 0; i < count; i++) {
            const img = document.createElement('img');
            img.className = 'floating-post-avatar';
            img.src = sources[Math.floor(Math.random() * sources.length)];
            img.referrerPolicy = "no-referrer";

            // Randomize position across the screen width, avoiding very edges
            const leftPerc = 10 + Math.random() * 80;
            // Randomize starting Y position between 30% and 70% of screen height
            const topPerc = 30 + Math.random() * 40;

            // Apply slight random delay and scale
            const delay = Math.random() * 0.5;
            const size = 30 + Math.random() * 20;

            img.style.left = `${leftPerc}%`;
            img.style.top = `${topPerc}%`;
            img.style.width = `${size}px`;
            img.style.height = `${size}px`;
            img.style.animationDelay = `${delay}s`;

            container.appendChild(img);

            // Clean up after animation (4s) + delay
            setTimeout(() => {
                img.remove();
            }, (4 + delay) * 1000);
        }
    },

    showRetryAlert(message, onDismiss) {
        message = I18n.t(message);
        if (TelegramApp.webapp?.showPopup) {
            TelegramApp.webapp.showPopup({
                title: I18n.t('error_title'),
                message: message,
                buttons: [{ id: 'close', type: 'cancel' }]
            }, () => { if (onDismiss) onDismiss(); });
        } else {
            if (onDismiss) onDismiss();
        }
    },

    async loadLeaderboard(silent = false) {
        if (!silent && !this.leaderboardLoaded) {
            const list = document.getElementById('leaderboard-list');
            if (list) list.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-mutted);">${I18n.t('leaderboard_loading')}</div>`;
        }

        try {
            const data = await this.apiRequest('leaderboard');
            if (data.success && data.leaderboard) {
                this.renderLeaderboard(data.leaderboard, silent);
            }
        } catch (error) {
            console.error('Failed to load leaderboard:', error);
        }
    },

    renderLeaderboard(leaderboard, silent = false) {
        const list = document.getElementById('leaderboard-list');
        if (!list) return;

        try {
            if (!leaderboard || leaderboard.length === 0) {
                if (!silent || this.lastLeaderboard.length > 0) {
                    list.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-mutted);">${I18n.t('leaderboard_empty')}</div>`;
                }
                this.lastLeaderboard = [];
                this.leaderboardLoaded = true;
                return;
            }

            // Сравниваем с кэшем — перерисовываем только если данные изменились
            // Или если в списке всё еще висит лоадер (нужно отрисовать первый раз)
            const newDataStr = JSON.stringify(leaderboard);
            const oldDataStr = JSON.stringify(this.lastLeaderboard);
            const isLoaderVisible = list.innerHTML.includes('loading-state') || list.innerHTML.includes(I18n.t('leaderboard_loading'));
            if (newDataStr === oldDataStr && this.leaderboardLoaded && !isLoaderVisible) return;

            list.innerHTML = '';
            this.lastLeaderboard = leaderboard;
            this.leaderboardLoaded = true;
            const fragment = document.createDocumentFragment();
            leaderboard.forEach(item => {
                const el = document.createElement('div');
                el.className = 'clay-list-item';
                el.style.cursor = 'pointer';
                const url = `https://www.threads.com/@${item.nickname}`;
                el.innerHTML = `<a href="${url}" target="_blank" rel="noopener noreferrer" class="leaderboard-item-link"></a>`;
                const linkWrap = el.querySelector('a');

                linkWrap.onclick = (e) => {
                    e.preventDefault();
                    this.openThreadsUrl(url);
                };

                const rank = document.createElement('div');
                rank.className = 'item-rank';
                if (item.rank === 1) rank.innerHTML = '<span class="rank-badge rank-1">#1</span>';
                else if (item.rank === 2) rank.innerHTML = '<span class="rank-badge rank-2">#2</span>';
                else if (item.rank === 3) rank.innerHTML = '<span class="rank-badge rank-3">#3</span>';
                else rank.textContent = `#${item.rank}`;

                const avatar = document.createElement('div');
                avatar.className = 'item-avatar';
                if (item.avatar_url) {
                    const img = document.createElement('img');
                    img.src = item.avatar_url;
                    img.referrerPolicy = "no-referrer";
                    img.onerror = () => { avatar.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>'; };
                    avatar.appendChild(img);
                } else avatar.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>';

                const info = document.createElement('div');
                info.className = 'item-info';
                const nick = document.createElement('div');
                nick.className = 'item-nick';
                nick.textContent = `@${item.nickname}`;
                info.appendChild(nick);

                const score = document.createElement('div');
                score.className = 'item-score';
                score.innerHTML = `${item.score} <svg class="inline-star clay-star" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;

                linkWrap.appendChild(rank); linkWrap.appendChild(avatar); linkWrap.appendChild(info); linkWrap.appendChild(score);
                fragment.appendChild(el);
            });
            list.appendChild(fragment);
        } catch (error) {
            console.error('Render leaderboard error:', error);
        }
    },

    async searchUser() {
        const input = document.getElementById('search-input');
        const resultEl = document.getElementById('search-result');
        const searchBtn = document.getElementById('search-btn');
        const nickname = input?.value?.trim();
        if (!nickname) { this.showToast(I18n.t('add_enter_username'), 'info'); return; }

        input.blur();
        document.body.classList.remove('keyboard-open');
        TelegramApp.haptic('impact');

        resultEl.innerHTML = `<div style="text-align:center;color:var(--text-mutted);padding: 20px;">${I18n.t('add_searching')}</div>`;
        resultEl.classList.remove('hidden');

        try {
            const data = await this.apiRequest('search-threads', { nickname });
            if (data.found) {
                if (searchBtn) searchBtn.textContent = 'X';
                this.showSearchFound(data, resultEl);
            } else {
                if (searchBtn) searchBtn.textContent = 'X';
                resultEl.innerHTML = `<div style="text-align:center;color:var(--text-mutted);padding: 20px;">${I18n.t('add_not_found', { nick: nickname })}</div>`;
            }
        } catch (error) {
            if (searchBtn) searchBtn.textContent = 'X';
            resultEl.innerHTML = `<div style="text-align:center;color:#ef4444;padding: 20px;">${I18n.t('error_search_failed')}</div>`;
        }
    },

    async showSearchFound(data, container) {
        this.lastSearchResult = data;
        container.innerHTML = '';

        let isSubscribed = false;
        if (data.already_exists) {
            try {
                const subData = await this.apiRequest('check-subscription', { username: data.nickname });
                isSubscribed = subData.subscribed;
            } catch (e) { }
        }

        const av = document.createElement('div');
        av.className = 'result-avatar';
        // Explicitly width & height, letting flex center it
        av.style.width = '60px';
        av.style.height = '60px';
        av.style.flexShrink = '0';

        if (data.avatar_url) {
            const img = document.createElement('img');
            img.src = data.avatar_url;
            img.referrerPolicy = "no-referrer";
            img.onerror = () => { av.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>'; };
            av.appendChild(img);
        } else av.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>';

        const url = `https://www.threads.com/@${data.nickname}`;
        const nick = document.createElement('div');
        nick.className = 'result-nick';
        nick.innerHTML = `<a href="${url}" target="_blank" rel="noopener noreferrer" class="result-nick-link">@${data.nickname}</a>`;
        nick.style.fontWeight = 'bold';
        nick.style.fontSize = '18px';

        nick.querySelector('a')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.openThreadsUrl(url);
        });

        const status = document.createElement('div');
        status.style.fontSize = '14px';

        if (data.already_exists) {
            let userRankText = '>50';
            if (this.lastLeaderboard) {
                const lbItem = this.lastLeaderboard.find(i => i.nickname === data.nickname);
                if (lbItem) userRankText = lbItem.rank;
            }
            status.innerHTML = I18n.t('add_already_score', { score: data.score || 0, rank: userRankText });
            status.style.color = 'var(--text-mutted)';
        } else {
            status.textContent = I18n.t('add_found');
            status.style.color = 'var(--accent)';
        }

        const btn = document.createElement('button');

        if (!data.already_exists) {
            btn.className = 'clay-btn clay-primary';
            btn.textContent = I18n.t('add_button');

            btn.style.marginTop = '10px';
            btn.onclick = async () => {
                btn.disabled = true;
                btn.textContent = '...';
                try {
                    const res = await this.apiRequest('add-participant', { nickname: data.nickname });
                    if (res.success) {
                        this.showToast(I18n.t('add_success', { nick: data.nickname }), 'success');
                        data.already_exists = true;
                        data.score = 0;
                        this.showSearchFound(data, container);
                    } else if (res.error === 'no_threads_profile') {
                        this.showToast(I18n.t('error_not_on_threads', { nick: data.nickname }), 'error');
                        btn.disabled = false;
                        btn.textContent = I18n.t('add_button');
                    } else throw new Error(res.error);
                } catch (e) {
                    this.showToast(e.message, 'error');
                    btn.disabled = false;
                    btn.textContent = I18n.t('add_button');
                }

            };
        } else {
            btn.className = `clay-btn ${isSubscribed ? 'clay-secondary' : 'clay-primary'}`;
            btn.textContent = isSubscribed ? I18n.t('sub_btn_unsubscribe') : I18n.t('sub_btn_subscribe');
            btn.style.marginTop = '10px';
            btn.onclick = async () => {
                TelegramApp.haptic('impact');
                btn.disabled = true;
                try {
                    const res = await this.apiRequest('toggle-subscription', { username: data.nickname });
                    if (res.success) {
                        isSubscribed = res.subscribed;
                        btn.className = `clay-btn ${isSubscribed ? 'clay-secondary' : 'clay-primary'}`;
                        btn.textContent = isSubscribed ? I18n.t('sub_btn_unsubscribe') : I18n.t('sub_btn_subscribe');
                        this.showToast(isSubscribed ? I18n.t('sub_subscribed') : I18n.t('sub_unsubscribed'), isSubscribed ? 'success' : 'warning');
                    }
                } catch (e) { }
                btn.disabled = false;
            };
        }

        container.appendChild(av);
        container.appendChild(nick);
        container.appendChild(status);
        container.appendChild(btn);
        container.classList.remove('hidden');
    },

    showDepositModal() {
        TelegramApp.haptic('impact');
        const modal = document.getElementById('deposit-modal');
        const input = document.getElementById('custom-deposit');
        if (modal && input) {
            input.value = '';
            modal.classList.add('active');
            document.body.style.overflow = 'hidden';
            input.focus();
            setTimeout(() => input.focus(), 50);
        }
    },

    closeModals() {
        document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
        document.body.style.overflow = '';
    },

    async createDeposit(amount) {
        TelegramApp.haptic('impact');
        this.closeModals();
        this.showLoading(true);
        try {
            const invoiceData = await this.apiRequest('create-invoice', { amount });
            if (!invoiceData.success) throw new Error(invoiceData.error);
            this.showLoading(false);
            this.pendingPayment = { transactionId: invoiceData.transactionId, amount };
            TelegramApp.openInvoice(invoiceData.invoiceUrl, async (status) => {
                if (status === 'paid') {
                    TelegramApp.haptic('success');
                    await this.checkPaymentAndUpdate();
                } else {
                    this.pendingPayment = null;
                    if (status === 'failed') { this.showToast(I18n.t('deposit_failed'), 'error'); }
                }
            });
        } catch (error) {
            this.showLoading(false);
            this.showToast(error.message, 'error');
        }
    },

    async checkPaymentAndUpdate() {
        if (!this.pendingPayment) return;
        this.showLoading(true);
        await new Promise(r => setTimeout(r, 1500));
        let attempts = 0;
        const poll = async () => {
            attempts++;
            try {
                const result = await this.apiRequest('check-payment', { transactionId: this.pendingPayment.transactionId });
                if (result.success && result.status === 'completed') {
                    this.showLoading(false);
                    this.updateBalance(result.balance);
                    const amt = this.pendingPayment.amount;
                    this.showToast(I18n.t('deposit_success', { amount: amt }), 'success');
                    this.pendingPayment = null;
                    if (this.userData) { this.userData.total_deposited = (this.userData.total_deposited || 0) + amt; this.updateProfileUI(this.userData); }
                    return;
                }
            } catch (e) { }
            if (attempts < 10) setTimeout(poll, 2000);
            else {
                this.showLoading(false);
                this.showToast(I18n.t('deposit_processing'), 'info');
                this.pendingPayment = null;
                setTimeout(() => this.loadInitialData(), 5000);
            }
        };
        poll();
    },

    showLoading(show) {
        const l = document.getElementById('loading');
        if (l) l.classList.toggle('active', show);
    },

    // ============================================
    // THREADS VERIFICATION
    // ============================================
    updateProfileVerificationUI(userData) {
        const linkBtn = document.getElementById('link-threads-btn');
        const verifiedSection = document.getElementById('threads-verified-section');
        const verifiedNick = document.getElementById('verified-threads-nick');
        const starBalance = document.getElementById('threads-star-balance');

        if (userData?.threads_verified && userData?.threads_username) {
            linkBtn?.classList.add('hidden');
            verifiedSection?.classList.remove('hidden');
            if (starBalance) starBalance.textContent = userData.threads_star_balance || 0;

            // Update profile badge and settings
            const pthreads = document.getElementById('profile-threads-info');
            const pnick = document.getElementById('profile-threads-nick');
            if (pthreads && pnick) {
                pthreads.classList.remove('hidden');
                pnick.textContent = userData.threads_username;
            }
            const ssection = document.getElementById('settings-threads-section');
            const sstatus = document.getElementById('settings-threads-status');
            if (ssection && sstatus) {
                ssection.classList.remove('hidden');
                sstatus.textContent = I18n.t('threads_settings_connected', { nick: userData.threads_username });
            }
        } else {
            linkBtn?.classList.remove('hidden');
            verifiedSection?.classList.add('hidden');
            document.getElementById('profile-threads-info')?.classList.add('hidden');
            document.getElementById('settings-threads-section')?.classList.add('hidden');
        }
    },

    updateLangButtons() {
        // Handled by I18n.apply() called within I18n.setLanguage()
    },

    async disconnectThreads() {
        if (!confirm(I18n.t('threads_disconnect_confirm'))) return;
        TelegramApp.haptic('impact');
        this.showLoading(true);
        try {
            const res = await this.apiRequest('disconnect-threads');
            if (res.success) {
                this.showToast(I18n.t('threads_disconnected_toast'), 'warning');
                if (this.userData) {
                    this.userData.threads_verified = false;
                    this.userData.threads_username = null;
                    this.updateProfileVerificationUI(this.userData);
                }
                this.closeSettings();
            }
        } catch (e) {
            this.showToast(e.message, 'error');
        } finally {
            this.showLoading(false);
        }
    },

    copyToClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                this.showToast(I18n.t('copy_success'), 'success');
            }).catch(() => {
                this.fallbackCopyTextToClipboard(text);
            });
        } else {
            this.fallbackCopyTextToClipboard(text);
        }
    },

    fallbackCopyTextToClipboard(text) {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            document.execCommand('copy');
            this.showToast(I18n.t('copy_success'), 'success');
        } catch (err) {
            this.showToast(I18n.t('copy_error'), 'error');
        }
        document.body.removeChild(textArea);
    },

    openVerifyModal() {
        TelegramApp.haptic('impact');
        const modal = document.getElementById('verify-modal');
        if (!modal) return;

        // Reset to step 1
        this.verifyState = { step: 1, nickname: '', code: '' };
        document.getElementById('verify-step-1').classList.remove('hidden');
        document.getElementById('verify-step-2').classList.add('hidden');
        document.getElementById('verify-step-3').classList.add('hidden');
        document.getElementById('verify-nick-input').value = '';
        document.getElementById('verify-search-result').textContent = '';
        document.getElementById('verify-check-result').textContent = '';

        // Pre-fill if user already has a pending threads_username
        if (this.userData?.threads_username && !this.userData?.threads_verified) {
            document.getElementById('verify-nick-input').value = this.userData.threads_username;
        }

        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    },

    initStandaloneVerify() {
        const container = document.getElementById('verify-only-standalone-container');
        if (!container) return;

        // Reset steps
        document.getElementById('vo-step-1').classList.remove('hidden');
        document.getElementById('vo-step-2').classList.add('hidden');
        document.getElementById('vo-nick-input').value = this.userData?.threads_username || '';
        document.getElementById('vo-search-result').textContent = '';
        document.getElementById('vo-check-result').textContent = '';
        document.getElementById('vo-publish-btn')?.classList.remove('hidden');
        document.getElementById('vo-check-btn')?.classList.add('hidden');
    },

    closeVerifyModal() {
        document.getElementById('verify-modal')?.classList.remove('active');
        document.body.style.overflow = '';
    },

    async searchThreadsForVerify(isStandalone = false) {
        const prefix = isStandalone ? 'vo-' : 'verify-';
        const input = document.getElementById(`${prefix}nick-input`);
        const btn = document.getElementById(`${prefix}search-btn`);
        const resultEl = document.getElementById(`${prefix}search-result`);
        const nickname = input.value.trim().toLowerCase();

        if (!nickname) {
            this.showToast(I18n.t('error_enter_nickname'), 'info');
            return;
        }

        resultEl.textContent = I18n.t('verify_searching');
        resultEl.style.color = 'var(--text-mutted)';

        try {
            const data = await this.apiRequest('start-verification', { nickname });
            if (data.success) {
                // Move to step 2
                this.verifyState = { step: 2, nickname: data.threads_username, code: data.code };
                resultEl.textContent = '';
                const nickLabel = document.getElementById(`${prefix}found-nick-label`);
                if (nickLabel) nickLabel.textContent = I18n.t('verify_step_2_found', { nick: data.threads_username });
                document.getElementById(`${prefix}code-display`).textContent = data.code;

                // Show post preview if it exists in the UI (modal only)
                const preview = document.getElementById(`${prefix}post-preview`);
                if (preview) {
                    const postText = I18n.t('verify_post_text', { code: data.code });
                    preview.textContent = postText;
                }

                document.getElementById(`${prefix}step-1`).classList.add('hidden');
                document.getElementById(`${prefix}step-2`).classList.remove('hidden');
            } else if (data.error === 'already_claimed') {
                resultEl.textContent = I18n.t('verify_error_claimed');
                resultEl.style.color = '#ef4444';
            } else if (data.error === 'no_threads_profile') {
                resultEl.textContent = I18n.t('verify_error_not_found');
                resultEl.style.color = '#ef4444';
            } else {
                resultEl.textContent = I18n.t('verify_error_generic');
                resultEl.style.color = '#ef4444';
            }
        } catch (e) {
            resultEl.textContent = I18n.t('verify_error_connection');
            resultEl.style.color = '#ef4444';
        }
    },

    openThreadsPublish(isStandalone = false) {
        TelegramApp.haptic('impact');
        const code = this.verifyState.code;
        if (!code) return;

        const postText = encodeURIComponent(I18n.t('verify_post_text', { code }));
        const threadsUrl = `https://www.threads.com/intent/post?text=${postText}`;

        this.openThreadsUrl(threadsUrl);

        // After a short delay, show check button (either move to step 3 in modal or swap buttons in standalone)
        setTimeout(() => {
            if (isStandalone) {
                document.getElementById('vo-publish-btn')?.classList.add('hidden');
                document.getElementById('vo-check-btn')?.classList.remove('hidden');
            } else {
                document.getElementById('verify-step-2')?.classList.add('hidden');
                document.getElementById('verify-step-3')?.classList.remove('hidden');
            }
            this.verifyState.step = 3;
        }, 1500);
    },

    async checkVerification(isStandalone = false) {
        const prefix = isStandalone ? 'vo-' : 'verify-';
        const btn = document.getElementById(`${prefix}check-btn`);
        const resultEl = document.getElementById(`${prefix}check-result`);
        if (!btn) return;

        btn.disabled = true;
        btn.innerHTML = `
            <svg class="clay-spinner" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"></path></svg>
            <span>${I18n.t('verify_checking')}</span>
        `;
        resultEl.textContent = '';

        try {
            const data = await this.apiRequest('check-verification', {});
            if (data.success && data.verified) {
                TelegramApp.haptic('success');
                resultEl.innerHTML = `
                    <div style="display: flex; align-items: center; justify-content: center; gap: 8px;">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#10b981" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                        <span>${I18n.t('verify_success')}</span>
                    </div>
                `;
                resultEl.style.color = '#10b981';

                // Update local user data
                if (this.userData) {
                    this.userData.threads_verified = true;
                    this.userData.threads_username = this.verifyState.nickname;
                    this.userData.threads_star_balance = this.userData.threads_star_balance || 0;
                    this.updateProfileVerificationUI(this.userData);
                }

                if (this.appMode === 'verify_only') {
                    // Re-fetch user data — backend now returns app_mode='active' for verified users
                    setTimeout(async () => {
                        await this.loadInitialData();
                        if (this.userData?.app_mode === 'active') {
                            this.setAppMode('active');
                        } else {
                            this.showVerificationOnlySuccess();
                        }
                    }, 1500);
                }

                setTimeout(() => this.closeVerifyModal(), 2000);
            } else {
                resultEl.innerHTML = `
                    <div style="display: flex; align-items: center; justify-content: center; gap: 8px;">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#ef4444" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        <span>${I18n.t('verify_error_no_code')}</span>
                    </div>
                `;
                resultEl.style.color = '#ef4444';
                btn.disabled = false;
                btn.textContent = I18n.t('verify_step_3_check_btn');
            }
        } catch (e) {
            resultEl.textContent = I18n.t('verify_error_connection');
            resultEl.style.color = '#ef4444';
            btn.disabled = false;
            btn.textContent = I18n.t('verify_step_3_check_btn');
        }
    },
};

window.App = App;
document.addEventListener('DOMContentLoaded', () => App.init());