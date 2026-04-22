function parseAppState() {
    try {
        return JSON.parse(document.body.dataset.appState || "{}");
    } catch (error) {
        return {};
    }
}

const appState = Object.assign({
    dbAvailable: false,
    user: null,
    leaderboard: [],
    analytics: null,
    routes: [],
    dbError: null
}, parseAppState());
let csrfToken = document.body.dataset.csrfToken || "";

const gameArea = document.getElementById("gameArea");
const hud = document.querySelector(".hud");
const scoreEl = document.getElementById("score");
const timeEl = document.getElementById("time");
const ammoEl = document.getElementById("ammo");
const clickCountEl = document.getElementById("clickCount");
const hitsEl = document.getElementById("hits");
const accuracyEl = document.getElementById("accuracy");
const pointsPerShotEl = document.getElementById("pointsPerShot");
const bestEl = document.getElementById("best");
const overlay = document.getElementById("overlay");
const reloadOverlay = document.getElementById("reloadOverlay");
const statusText = document.getElementById("statusText");
const tutorialBanner = document.getElementById("tutorialBanner");
const tutorialText = document.getElementById("tutorialText");
const levelBanner = document.getElementById("levelBanner");
const crosshair = document.getElementById("crosshair");
const menuControl = document.getElementById("menuControl");
const restartControl = document.getElementById("restartControl");
const playerNameEl = document.getElementById("playerName");
const cookieConsent = document.getElementById("cookieConsent");
const cookieAcceptButton = document.getElementById("cookieAcceptButton");
const cookieEssentialButton = document.getElementById("cookieEssentialButton");
const cookieSettingsButton = document.getElementById("cookieSettingsButton");

const totalTime = 45;
const magSize = 6;
const bestScoreStorageKey = "chicken-shooting-best";
const levelUnlockStorageKey = "chicken-shooting-unlocked-level";
const cookieConsentStorageKey = "chicken-shooting-cookie-consent";
const cookieConsentMaxAge = 60 * 60 * 24 * 180;
const functionalStorageKeys = [bestScoreStorageKey, levelUnlockStorageKey];
const racingComboWindowMs = 1400;
const racingComboBonusPoints = 12;
const reloadSequenceLength = 4;
const reloadDirections = ["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"];
const reloadSymbols = {
    ArrowUp: "\u2191",
    ArrowRight: "\u2192",
    ArrowDown: "\u2193",
    ArrowLeft: "\u2190"
};
const chickens = new Map();
const chickenTypes = [
    { label: "Cream Chicken", colors: ["#fff7e8", "#f4e0bb", "#ef9b29"], speedMin: 140, speedMax: 190, pointsMin: 22, pointsMax: 30 },
    { label: "Golden Chicken", colors: ["#ffe3a6", "#ffc54d", "#ea7f1c"], speedMin: 185, speedMax: 235, pointsMin: 30, pointsMax: 38 },
    { label: "Rose Chicken", colors: ["#f2a49b", "#e88374", "#f3b74e"], speedMin: 230, speedMax: 280, pointsMin: 38, pointsMax: 46 },
    { label: "Blue Chicken", colors: ["#d9eef9", "#afdae9", "#ef9b29"], speedMin: 275, speedMax: 340, pointsMin: 46, pointsMax: 56 }
];
let levelConfigs = {};
let maxLevel = 1;
const mapPins = [
    { label: 2, x: 180, y: 160, targetLevel: 2, primary: true },
    { label: 3, x: 280, y: 150, targetLevel: 3, primary: true },
    { label: 1, x: 480, y: 130, targetLevel: 1, primary: true },
    { label: 5, x: 430, y: 125, targetLevel: 5, primary: true },
    { label: 4, x: 320, y: 350, targetLevel: 4, primary: true },
    { label: 6, x: 330, y: 420, targetLevel: 6, primary: true },
    { label: 7, x: 425, y: 315, targetLevel: 7, primary: true },
    { label: 8, x: 585, y: 145, targetLevel: 8, primary: true },
    { label: 9, x: 650, y: 250, targetLevel: 3, primary: false },
    { label: 10, x: 820, y: 380, targetLevel: 3, primary: false },
    { label: 11, x: 880, y: 360, targetLevel: 3, primary: false },
    { label: 13, x: 850, y: 150, targetLevel: 2, primary: false }
];
const viewport = {
    width: window.innerWidth,
    height: window.innerHeight,
    topInset: 96,
    bottomInset: 110
};

let score = 0;
let timeLeft = totalTime;
let ammo = magSize;
let clickCount = 0;
let hitCount = 0;
let cookieConsentState = getCookieConsentState();
let bestScore = Number(readFunctionalStorage(bestScoreStorageKey) || 0);
let gameRunning = false;
let gamePaused = false;
let reloadTimeout = null;
let reloadActive = false;
let reloadSequence = [];
let reloadStep = 0;
let rafId = null;
let chickenId = 0;
let lastFrameTime = 0;
let spawnAccumulator = 0;
let secondAccumulator = 0;
let pointerX = window.innerWidth / 2;
let pointerY = window.innerHeight / 2;
let crosshairQueued = false;
let tutorialMode = false;
let tutorialStep = 0;
let tutorialTargetId = null;
let currentLevel = 1;
let maxUnlockedLevel = 1;
let selectedStartLevel = 1;
let levelTransitionTimeout = null;
let racingComboCount = 0;
let lastRacingHitAt = 0;

const audioCtx = (() => {
    try { return new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
})();

function playSound(type) {
    if (!audioCtx) return;
    if (audioCtx.state === "suspended") audioCtx.resume();
    const t = audioCtx.currentTime;

    const noise = (dur, vol, off = 0) => {
        const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * dur, audioCtx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(vol, t + off);
        g.gain.exponentialRampToValueAtTime(0.001, t + off + dur);
        src.connect(g); g.connect(audioCtx.destination);
        src.start(t + off);
    };

    const tone = (freq, endFreq, dur, vol, wave = "triangle", off = 0) => {
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.type = wave;
        osc.frequency.setValueAtTime(freq, t + off);
        if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + off + dur);
        g.gain.setValueAtTime(vol, t + off);
        g.gain.exponentialRampToValueAtTime(0.001, t + off + dur);
        osc.connect(g); g.connect(audioCtx.destination);
        osc.start(t + off); osc.stop(t + off + dur);
    };

    if (type === "shot")       { noise(0.14, 0.38); tone(90, 40, 0.14, 0.28, "sine"); }
    if (type === "hit")        { tone(520, 180, 0.18, 0.38); }
    if (type === "miss")       { tone(220, 80, 0.2, 0.18, "sawtooth"); }
    if (type === "reload")     { [0, 0.13, 0.24].forEach((off) => noise(0.06, 0.22, off)); }
    if (type === "reloadDone") { tone(400, null, 0.08, 0.18, "square"); tone(600, null, 0.14, 0.18, "square", 0.08); }
    if (type === "levelUp")    { [440, 550, 660].forEach((f, i) => tone(f, null, 0.15, 0.2, "sine", i * 0.1)); }
    if (type === "gameOver")   { [320, 240, 160, 100].forEach((f, i) => tone(f, f * 0.6, 0.2, 0.18, "sawtooth", i * 0.18)); }
}

const tutorialSteps = [
    "Click on the clearly marked chicken. This first target is larger and slower to help you get into the game.",
    "Great. Hit another slower chicken without rushing.",
    "Nice work. Hit one more and you'll be ready for the real game.",
    "Well done! The tutorial is complete. The next round is the standard game."
];

bestEl.textContent = bestScore;
playerNameEl.textContent = appState.user?.nickname || "Guest";

function getOrderedLevelConfigs() {
    return Object.values(levelConfigs).sort((first, second) => first.id - second.id);
}

function mapRouteToLevelConfig(route) {
    return {
        id: Number(route.id),
        name: String(route.name || `Level ${route.id}`),
        mapTitle: String(route.map_title || route.mapTitle || ""),
        mapCopy: String(route.map_copy || route.mapCopy || ""),
        lockedCopy: String(route.locked_copy || route.lockedCopy || ""),
        status: String(route.status_text || route.status || ""),
        bannerTitle: String(route.banner_title || route.bannerTitle || ""),
        bannerCopy: String(route.banner_copy || route.bannerCopy || ""),
        startCount: Number(route.start_count || route.startCount || 0),
        spawnLimit: Number(route.spawn_limit || route.spawnLimit || 0),
        spawnEveryMs: Number(route.spawn_every_ms || route.spawnEveryMs || 0),
        speedMultiplier: Number(route.speed_multiplier || route.speedMultiplier || 1),
        chickenClass: String(route.chicken_class || route.chickenClass || ""),
        accessory: String(route.accessory || "none"),
        unlockScore: Number(route.unlock_score || route.unlockScore || 0)
    };
}

function setRouteConfigs(routes) {
    const nextConfigs = {};

    routes
        .map(mapRouteToLevelConfig)
        .sort((first, second) => first.id - second.id)
        .forEach((route) => {
            nextConfigs[route.id] = route;
        });

    levelConfigs = nextConfigs;
    appState.routes = getOrderedLevelConfigs();
    maxLevel = Math.max(1, ...appState.routes.map((route) => route.id));
}

function getDefaultLevelConfig() {
    return levelConfigs[1] || getOrderedLevelConfigs()[0] || null;
}

function calculateAccuracy(clicksValue, hitsValue) {
    if (clicksValue <= 0) {
        return 0;
    }

    return (hitsValue / clicksValue) * 100;
}

function calculatePointsPerShot(scoreValue, clicksValue) {
    if (clicksValue <= 0) {
        return 0;
    }

    return scoreValue / clicksValue;
}

function classifyPlayerLevel(scoreValue, accuracyValue, pointsPerShotValue, hitsValue) {
    if (hitsValue <= 0 || scoreValue < 20) {
        return {
            level: "Pocetnik",
            summary: "Tek hvatas ritam igre i upoznajes tempo meta."
        };
    }

    if (scoreValue >= 260 && accuracyValue >= 62 && pointsPerShotValue >= 7) {
        return {
            level: "Elite Snajper",
            summary: "Vrhunska preciznost i odlican izbor meta tokom cele partije."
        };
    }

    if (scoreValue >= 180 && accuracyValue >= 48 && pointsPerShotValue >= 5) {
        return {
            level: "Napredni Lovac",
            summary: "Igras stabilno, precizno i vrlo efikasno skupljas poene."
        };
    }

    if (scoreValue >= 90 && accuracyValue >= 32 && pointsPerShotValue >= 3) {
        return {
            level: "Srednji Nivo",
            summary: "Imas dobru osnovu i vec kontrolises veci deo partije."
        };
    }

    return {
        level: "Pocetnik",
        summary: "Dobar pocetak. Jos malo vezbe i preciznosti za visi rang."
    };
}

function getRoundCoachTips(scoreValue, clicksValue, hitsValue, accuracyValue, pointsPerShotValue) {
    const missedShots = Math.max(0, clicksValue - hitsValue);
    const tips = [];

    if (clicksValue === 0) {
        tips.push("Kreni odmah sa najsporijim metama da uhvatis ritam pre brzih kokosaka.");
    } else if (accuracyValue < 25) {
        tips.push(`Preciznost je ${formatMetric(accuracyValue, 1)}%. Sacekaj da meta udje u sredinu ekrana pre pucnja.`);
    } else if (accuracyValue < 45) {
        tips.push(`Imao si ${missedShots} promasaja. Probaj krace serije pucanja i ostavi brze mete za kraj.`);
    } else {
        tips.push(`Preciznost od ${formatMetric(accuracyValue, 1)}% je dobra osnova. Sada juri skuplje mete za veci skor.`);
    }

    if (pointsPerShotValue < 3 && hitsValue > 0) {
        tips.push("Poeni po pucnju su niski. Biraj zlatne i plave kokoske kada imas cist ugao.");
    } else if (pointsPerShotValue >= 6) {
        tips.push("Odlicna efikasnost po pucnju. Nastavi da cuvas municiju za mete koje vrede vise.");
    } else {
        tips.push("Efikasnost je stabilna. Sledeci napredak dolazi iz manje panicnih klikova.");
    }

    if (scoreValue < 800) {
        tips.push("Cilj za sledecu rundu: predji 800 poena i otkljucaj sledecu rutu.");
    } else if (scoreValue < 1500) {
        tips.push("Sledeci izazov je 1500 poena. Kombinuj preciznost i brze mete.");
    } else if (scoreValue < 2300) {
        tips.push("Blizu si trkacke rute. Guraj preko 2300 poena za najbrzi tempo igre.");
    } else if (scoreValue < 3200) {
        tips.push("Sledeci veliki skok je Pariz. Predji 3200 poena i otkljucaj peti nivo.");
    } else if (scoreValue < 4100) {
        tips.push("Piza ceka na 4100 poena. Cuvaj municiju za brze mete i drzi tempo.");
    } else if (scoreValue < 5000) {
        tips.push("Rio se otkljucava preko 5000 poena. Gadjaj plave kokoske kad imaju cist prolaz.");
    } else if (scoreValue < 6200) {
        tips.push("Istanbul i Aja Sofija se otkljucavaju preko 6200 poena. Odrzi preciznost i ne rasipaj municiju.");
    } else {
        tips.push("Imas skor za sve rute. Na nivou u Istanbulu biraj ciste uglove jer je tempo najbrzi.");
    }

    return tips;
}

function buildRoundCoachMarkup(scoreValue, clicksValue, hitsValue, accuracyValue, pointsPerShotValue) {
    const tips = getRoundCoachTips(scoreValue, clicksValue, hitsValue, accuracyValue, pointsPerShotValue);

    return `
        <div class="card-section">
            <h3>Coach Notes</h3>
            <ul class="menu-list">
                ${tips.map((tip) => `<li>${escapeHtml(tip)}</li>`).join("")}
            </ul>
        </div>
    `;
}

function formatMetric(value, digits = 1) {
    return Number(value || 0).toFixed(digits);
}

function getCookieValue(name) {
    const encodedName = `${encodeURIComponent(name)}=`;
    const match = document.cookie
        .split(";")
        .map((value) => value.trim())
        .find((value) => value.startsWith(encodedName));

    return match ? decodeURIComponent(match.slice(encodedName.length)) : "";
}

function getCookieConsentState() {
    const storedValue = getCookieValue(cookieConsentStorageKey);

    if (storedValue === "all") {
        return {
            essential: true,
            functional: true
        };
    }

    if (storedValue === "essential") {
        return {
            essential: true,
            functional: false
        };
    }

    return null;
}

function canUseFunctionalStorage() {
    return Boolean(cookieConsentState?.functional);
}

function readFunctionalStorage(key) {
    if (!canUseFunctionalStorage()) {
        return null;
    }

    try {
        return localStorage.getItem(key);
    } catch (error) {
        return null;
    }
}

function writeFunctionalStorage(key, value) {
    if (!canUseFunctionalStorage()) {
        return;
    }

    try {
        localStorage.setItem(key, value);
    } catch (error) {
        // Ignore browser storage failures and continue without persistence.
    }
}

function removeFunctionalStorage(key) {
    try {
        localStorage.removeItem(key);
    } catch (error) {
        // Ignore browser storage failures and continue without persistence.
    }
}

function clearFunctionalStorage() {
    functionalStorageKeys.forEach((key) => removeFunctionalStorage(key));
}

function persistCookieConsent(functionalEnabled) {
    const nextValue = functionalEnabled ? "all" : "essential";
    const securePart = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${encodeURIComponent(cookieConsentStorageKey)}=${encodeURIComponent(nextValue)}; Max-Age=${cookieConsentMaxAge}; Path=/; SameSite=Lax${securePart}`;
    cookieConsentState = {
        essential: true,
        functional: functionalEnabled
    };
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function syncSecurityState(response) {
    if (!response || typeof response.csrfToken !== "string" || !response.csrfToken) {
        return;
    }

    csrfToken = response.csrfToken;
    document.body.dataset.csrfToken = csrfToken;
}

function computeUnlockedLevelFromScore(scoreValue) {
    return getOrderedLevelConfigs().reduce((highestUnlocked, config) => (
        scoreValue > config.unlockScore ? Math.max(highestUnlocked, config.id) : highestUnlocked
    ), 1);
}

function bootstrapLevelProgress() {
    const storedLevel = Number(readFunctionalStorage(levelUnlockStorageKey) || 1);
    maxUnlockedLevel = Math.min(maxLevel, Math.max(1, storedLevel, computeUnlockedLevelFromScore(bestScore)));
    selectedStartLevel = maxUnlockedLevel;
    currentLevel = selectedStartLevel;
    writeFunctionalStorage(levelUnlockStorageKey, String(maxUnlockedLevel));
}

function persistUnlockedLevel() {
    writeFunctionalStorage(levelUnlockStorageKey, String(maxUnlockedLevel));
}

function persistBestScore() {
    writeFunctionalStorage(bestScoreStorageKey, String(bestScore));
}

function refreshOverlayAfterCookieChange() {
    if (overlay.classList.contains("hidden")) {
        return;
    }

    if (!gameRunning && !gamePaused) {
        showIntroOverlay();
        return;
    }

    if (gamePaused) {
        openPauseMenu();
    }
}

function applyCookiePreferenceState({ clearStoredData = false, refreshOverlay = true } = {}) {
    if (clearStoredData) {
        clearFunctionalStorage();
    }

    if (canUseFunctionalStorage()) {
        if (gameRunning || gamePaused) {
            persistBestScore();
            persistUnlockedLevel();
        } else {
            bestScore = Number(readFunctionalStorage(bestScoreStorageKey) || 0);
            maxUnlockedLevel = Math.min(maxLevel, Math.max(1, Number(readFunctionalStorage(levelUnlockStorageKey) || 1), computeUnlockedLevelFromScore(bestScore)));
            selectedStartLevel = Math.min(maxUnlockedLevel, Math.max(1, selectedStartLevel));
            currentLevel = selectedStartLevel;
            persistUnlockedLevel();
        }
    } else if (!gameRunning && !gamePaused) {
        bestScore = 0;
        maxUnlockedLevel = 1;
        selectedStartLevel = 1;
        currentLevel = 1;
    }

    applyLevelTheme();
    updateHud();
    if (refreshOverlay) {
        refreshOverlayAfterCookieChange();
    }
}

function updateCookieUi() {
    const consentResolved = cookieConsentState !== null;
    cookieConsent.classList.toggle("hidden", consentResolved);
    document.body.classList.toggle("cookie-banner-visible", !consentResolved);
}

function saveCookiePreferences(functionalEnabled, options = {}) {
    const { refreshOverlay = true } = options;
    persistCookieConsent(functionalEnabled);
    applyCookiePreferenceState({
        clearStoredData: !functionalEnabled,
        refreshOverlay
    });
    updateCookieUi();
}

function getLevelConfig(level = currentLevel) {
    return levelConfigs[level] || getDefaultLevelConfig();
}

function unlockLevel(level) {
    const nextLevel = Math.min(maxLevel, Math.max(1, level));
    if (nextLevel <= maxUnlockedLevel) {
        return false;
    }

    maxUnlockedLevel = nextLevel;
    selectedStartLevel = nextLevel;
    persistUnlockedLevel();
    return true;
}

function selectStartLevel(level, options = {}) {
    const { render = true, force = false } = options;
    const levelCap = force ? maxLevel : maxUnlockedLevel;
    const nextLevel = Math.min(levelCap, Math.max(1, level));
    selectedStartLevel = nextLevel;
    currentLevel = nextLevel;
    applyLevelTheme();
    if (render) {
        showIntroOverlay();
    }
}

function normalizeLevelNumber(level) {
    return Math.min(maxLevel, Math.max(1, Number(level) || 1));
}

function buildLevelLaunchHref(level) {
    const url = new URL(window.location.href);
    url.searchParams.set("level", String(normalizeLevelNumber(level)));
    url.hash = "";
    return `${url.pathname}${url.search}`;
}

function getRequestedLevelFromUrl() {
    const requestedLevel = new URLSearchParams(window.location.search).get("level");
    if (!requestedLevel) {
        return null;
    }

    return normalizeLevelNumber(requestedLevel);
}

function clearRequestedLevelFromUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete("level");
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;

    window.history.replaceState({}, document.title, nextUrl);
}

function buildMapPinHref(pin) {
    if (!pin.href) {
        return buildLevelLaunchHref(pin.targetLevel);
    }

    if (pin.external) {
        return pin.href;
    }

    if (pin.href.startsWith("?")) {
        return pin.href;
    }

    if (pin.href.startsWith("level=")) {
        return `?${pin.href}`;
    }

    return buildLevelLaunchHref(pin.targetLevel);
}

function buildMapPinExtraAttributes(pin) {
    if (!pin.external) {
        return "";
    }

    return ' target="_blank" rel="noopener noreferrer"';
}

function setOverlayMode(mode = "default") {
    overlay.classList.toggle("intro-overlay", mode === "intro");
}

function applyLevelTheme() {
    document.body.classList.toggle("level-two", currentLevel === 2);
    document.body.classList.toggle("level-three", currentLevel === 3);
    document.body.classList.toggle("level-four", currentLevel === 4);
    document.body.classList.toggle("level-five", currentLevel === 5);
    document.body.classList.toggle("level-six", currentLevel === 6);
    document.body.classList.toggle("level-seven", currentLevel === 7);
    document.body.classList.toggle("level-eight", currentLevel === 8);
}

function getActiveSpawnLimit() {
    return getLevelConfig().spawnLimit;
}

function getActiveSpawnEveryMs() {
    return getLevelConfig().spawnEveryMs;
}

function getActiveSpeedMultiplier() {
    return getLevelConfig().speedMultiplier;
}

function resetRacingCombo() {
    racingComboCount = 0;
    lastRacingHitAt = 0;
}

function isRacingLevel() {
    return currentLevel === 4 && !tutorialMode;
}

function getRacingHitBonus() {
    if (!isRacingLevel()) {
        resetRacingCombo();
        return 0;
    }

    const now = Date.now();
    racingComboCount = now - lastRacingHitAt <= racingComboWindowMs
        ? racingComboCount + 1
        : 1;
    lastRacingHitAt = now;

    if (racingComboCount < 2) {
        return 0;
    }

    return Math.min(48, racingComboCount * racingComboBonusPoints);
}

function describeRacingCombo(bonusPoints) {
    if (bonusPoints <= 0) {
        return "";
    }

    return ` Racing combo x${racingComboCount}: +${bonusPoints} bonus.`;
}

function hideLevelBanner() {
    clearTimeout(levelTransitionTimeout);
    levelTransitionTimeout = null;
    levelBanner.classList.remove("show");
    levelBanner.classList.add("hidden");
}

function showLevelBanner(title, message) {
    clearTimeout(levelTransitionTimeout);
    levelBanner.innerHTML = `
        <span class="tutorial-banner-title">${escapeHtml(title)}</span>
        <p class="tutorial-banner-copy">${escapeHtml(message)}</p>
    `;
    levelBanner.classList.remove("hidden");
    requestAnimationFrame(() => levelBanner.classList.add("show"));
    levelTransitionTimeout = setTimeout(() => {
        levelBanner.classList.remove("show");
        levelBanner.classList.add("hidden");
        levelTransitionTimeout = null;
    }, 2600);
}

function clearAllChickens() {
    chickens.forEach((chicken) => chicken.el.remove());
    chickens.clear();
    clearTutorialTarget();
}

function activateLevel(level, options = {}) {
    const config = getLevelConfig(level);
    const {
        showBanner = level > 1,
        preserveScore = true
    } = options;

    currentLevel = config.id;
    if (!preserveScore) {
        score = 0;
    }
    timeLeft = totalTime;
    ammo = magSize;
    spawnAccumulator = 0;
    secondAccumulator = 0;
    lastFrameTime = 0;
    resetRacingCombo();
    cancelReloadChallenge();
    clearAllChickens();
    applyLevelTheme();
    updateHud();

    if (showBanner) {
        showLevelBanner(config.bannerTitle, config.bannerCopy);
    } else {
        hideLevelBanner();
    }

    setStatus(config.status);

    for (let i = 0; i < config.startCount; i += 1) {
        spawnChicken();
    }
}

function maybeAdvanceToNextLevel() {
    if (tutorialMode) {
        return false;
    }

    const nextLevelConfig = getLevelConfig(currentLevel + 1);
    if (nextLevelConfig && nextLevelConfig.id !== currentLevel && score > nextLevelConfig.unlockScore) {
        unlockLevel(nextLevelConfig.id);
        activateLevel(nextLevelConfig.id);
        return true;
    }

    return false;
}

function updateViewport() {
    viewport.width = gameArea.clientWidth || window.innerWidth;
    viewport.height = gameArea.clientHeight || window.innerHeight;
    const hudRect = hud.getBoundingClientRect();
    const statusRect = statusText.getBoundingClientRect();
    const isMobileViewport = window.matchMedia("(max-width: 700px)").matches;

    viewport.topInset = Math.max(
        isMobileViewport ? 82 : 104,
        Math.round(hudRect.bottom + (isMobileViewport ? 14 : 22))
    );
    viewport.bottomInset = Math.max(
        isMobileViewport ? 68 : 92,
        Math.round(viewport.height - statusRect.top + (isMobileViewport ? 14 : 20))
    );
}

function updateHud() {
    scoreEl.textContent = score;
    timeEl.textContent = timeLeft;
    ammoEl.textContent = `${ammo} / ${magSize}`;
    clickCountEl.textContent = clickCount;
    hitsEl.textContent = hitCount;
    accuracyEl.textContent = `${formatMetric(calculateAccuracy(clickCount, hitCount), 1)}%`;
    pointsPerShotEl.textContent = formatMetric(calculatePointsPerShot(score, clickCount), 2);
    ammoEl.classList.toggle("warning", ammo <= 1);
    bestEl.textContent = bestScore;
    playerNameEl.textContent = appState.user?.nickname || "Guest";
}

function setStatus(message) {
    statusText.textContent = message;
}

function setTutorialMessage(message = "") {
    tutorialText.textContent = message;
    tutorialBanner.classList.toggle("hidden", !tutorialMode || !message);
}

function clearTutorialTarget() {
    if (tutorialTargetId === null) {
        return;
    }
    const previousTarget = chickens.get(tutorialTargetId);
    if (previousTarget) {
        previousTarget.el.classList.remove("tutorial-target");
    }
    tutorialTargetId = null;
}

function highlightTutorialTarget() {
    clearTutorialTarget();
    if (!tutorialMode) {
        return;
    }
    const nextTarget = [...chickens.values()].find((entry) => entry.alive);
    if (!nextTarget) {
        return;
    }
    tutorialTargetId = nextTarget.id;
    nextTarget.el.classList.add("tutorial-target");
}

function spawnTutorialChicken() {
    if (!tutorialMode || !gameRunning) {
        return;
    }

    const tutorialType = chickenTypes[0];
    const size = Math.max(96, Math.round(Math.min(viewport.width, viewport.height) * 0.12));
    const y = Math.max(viewport.topInset + 30, Math.min(viewport.height * 0.45, viewport.height - viewport.bottomInset - size - 20));
    const direction = tutorialStep % 2 === 0 ? 1 : -1;
    const speed = 88 + (tutorialStep * 10);

    spawnChicken({
        type: tutorialType,
        size,
        y,
        direction,
        speed,
        tutorialTarget: true
    });
}

function finishTutorialMode() {
    tutorialMode = false;
    tutorialStep = 0;
    clearTutorialTarget();
    setTutorialMessage("");
    showIntroOverlay(true);
}

function advanceTutorialAfterHit() {
    if (!tutorialMode) {
        return;
    }

    tutorialStep += 1;

    if (tutorialStep >= tutorialSteps.length - 1) {
        setTutorialMessage(tutorialSteps[tutorialSteps.length - 1]);
        setStatus("Tutorijal zavrsen. Standardna igra sada moze da pocne.");
        setTimeout(() => endGame(true), 900);
        return;
    }

    setTutorialMessage(tutorialSteps[tutorialStep]);
    setStatus("Odlicno. Prati oznacenu kokosku i nastavi.");
    window.setTimeout(() => {
        spawnTutorialChicken();
        highlightTutorialTarget();
    }, 320);
}

function isArrowKey(key) {
    return reloadDirections.includes(key);
}

function buildReloadSequence() {
    const sequence = [];
    let previousDirection = "";

    for (let i = 0; i < reloadSequenceLength; i += 1) {
        const options = previousDirection
            ? reloadDirections.filter((direction) => direction !== previousDirection)
            : reloadDirections;
        const nextDirection = options[Math.floor(Math.random() * options.length)];
        sequence.push(nextDirection);
        previousDirection = nextDirection;
    }

    return sequence;
}

function shotgunMarkup() {
    const pumpOffset = reloadStep > 0 ? Math.min(18, reloadStep * 4) : 0;

    return `
        <svg viewBox="0 0 360 120" aria-hidden="true">
            <rect x="34" y="52" width="196" height="12" rx="6" fill="#6e5130"></rect>
            <rect x="228" y="48" width="104" height="20" rx="8" fill="#405066"></rect>
            <rect x="${120 - pumpOffset}" y="44" width="42" height="28" rx="8" fill="#d4a355"></rect>
            <rect x="328" y="52" width="20" height="12" rx="6" fill="#96b6d9"></rect>
            <path d="M34 58 C24 74, 18 88, 24 104 L54 104 C62 86, 72 76, 94 70 L94 58 Z" fill="#815634"></path>
            <rect x="86" y="66" width="44" height="10" rx="5" fill="#1f2734"></rect>
        </svg>
    `;
}

function hideReloadOverlay() {
    reloadOverlay.classList.add("hidden");
    reloadOverlay.innerHTML = "";
}

function pulseReloadOverlay() {
    const card = reloadOverlay.querySelector(".reload-card");
    if (!card) {
        return;
    }
    card.classList.remove("shake");
    void card.offsetWidth;
    card.classList.add("shake");
}

function renderReloadOverlay(message = "Follow the arrows to chamber the shotgun.") {
    if (!reloadActive) {
        hideReloadOverlay();
        return;
    }

    reloadOverlay.innerHTML = `
        <div class="reload-card">
            <h3 class="reload-title">Shotgun Reload</h3>
            <p class="reload-copy">${escapeHtml(message)}</p>
            <div class="reload-weapon">${shotgunMarkup()}</div>
            <div class="reload-meta">
                <span>Step ${reloadStep + 1} / ${reloadSequence.length}</span>
                <span>Ammo empty</span>
            </div>
            <div class="reload-sequence">
                ${reloadSequence.map((direction, index) => `
                    <span class="reload-step${index < reloadStep ? " done" : ""}${index === reloadStep ? " active" : ""}">
                        ${reloadSymbols[direction]}
                    </span>
                `).join("")}
            </div>
            <div class="reload-pad">
                ${reloadDirections.map((direction) => `
                    <button class="reload-arrow" type="button" data-reload-key="${direction}">
                        ${reloadSymbols[direction]}
                    </button>
                `).join("")}
            </div>
        </div>
    `;
    reloadOverlay.classList.remove("hidden");
}

function beginReloadChallenge() {
    if (!gameRunning || gamePaused || reloadActive) {
        return;
    }

    reloadActive = true;
    reloadSequence = buildReloadSequence();
    reloadStep = 0;
    renderReloadOverlay("Ammo empty. Use arrow keys or tap the arrows to re-chamber the shotgun.");
    setStatus("Ammo empty. Follow the arrow sequence to reload.");
}

function finishReloadChallenge() {
    reloadActive = false;
    reloadSequence = [];
    reloadStep = 0;
    ammo = magSize;
    updateHud();
    hideReloadOverlay();
    setStatus("Shotgun ready. Keep shooting.");
}

function cancelReloadChallenge() {
    reloadActive = false;
    reloadSequence = [];
    reloadStep = 0;
    hideReloadOverlay();
}

function handleReloadInput(key) {
    if (!reloadActive || !isArrowKey(key)) {
        return false;
    }

    if (key === reloadSequence[reloadStep]) {
        reloadStep += 1;

        if (reloadStep >= reloadSequence.length) {
            finishReloadChallenge();
            return true;
        }

        renderReloadOverlay("Good. Keep pumping the shotgun.");
        setStatus(`Reloading... ${reloadStep}/${reloadSequence.length}`);
        return true;
    }

    reloadStep = 0;
    renderReloadOverlay("Wrong direction. Start the reload again.");
    pulseReloadOverlay();
    setStatus("Wrong direction. Start the reload again.");
    return true;
}

function buildLeaderboardMarkup() {
    if (!appState.dbAvailable) {
        return `<div class="empty-state">Leaderboard is unavailable because the database is not ready.</div>`;
    }
    if (!appState.leaderboard.length) {
        return `<div class="empty-state">No scores yet. Log in, finish a round and claim the first spot.</div>`;
    }
    return `
        <div class="leaderboard-list">
            ${appState.leaderboard.map((entry, index) => `
                <div class="leaderboard-row">
                    <span class="leaderboard-rank">#${index + 1}</span>
                    <span class="leaderboard-name">${escapeHtml(entry.nickname)}</span>
                    <span class="leaderboard-score">${entry.best_score} pts</span>
                    <span class="muted">${formatMetric(entry.best_accuracy, 1)}% acc</span>
                    <span class="muted">${entry.rounds_played} rounds</span>
                </div>
            `).join("")}
        </div>
    `;
}

function buildProgressChartMarkup() {
    const history = appState.analytics?.history || [];
    if (!history.length) {
        return `<div class="empty-state">Play a few logged-in rounds to build your progress chart.</div>`;
    }

    const maxScore = Math.max(...history.map((round) => Number(round.score) || 0), 1);

    return `
        <div class="chart-card">
            <h3>Progress Chart</h3>
            <p>Your latest ${history.length} saved rounds by score.</p>
            <div class="chart">
                ${history.map((round, index) => {
        const scoreValue = Number(round.score) || 0;
        const barHeight = Math.max(8, Math.round((scoreValue / maxScore) * 120));
        const gradientId = `chartGradient-${index}`;
        return `
                        <div class="chart-bar-wrap" title="Round ${index + 1}: ${scoreValue} pts, ${round.accuracy}% accuracy">
                            <span class="chart-value">${scoreValue}</span>
                            <svg class="chart-svg" viewBox="0 0 32 120" aria-hidden="true" focusable="false">
                                <defs>
                                    <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stop-color="#ffe388"></stop>
                                        <stop offset="100%" stop-color="#ffcb45"></stop>
                                    </linearGradient>
                                </defs>
                                <rect x="0" y="${120 - barHeight}" width="32" height="${barHeight}" rx="8" fill="url(#${gradientId})"></rect>
                            </svg>
                            <span class="chart-label">R${index + 1}</span>
                        </div>
                    `;
    }).join("")}
            </div>
        </div>
    `;
}

function buildAnalyticsMarkup() {
    if (!appState.dbAvailable || !appState.user) {
        return "";
    }

    const analytics = appState.analytics;
    const bestRound = analytics?.best_accuracy_round;
    const rank = analytics?.rank;
    const rankText = rank
        ? `#${rank.position} of ${rank.total_players}`
        : "No saved rank yet";
    const nextRankText = rank?.points_to_next_rank
        ? `${rank.points_to_next_rank} pts`
        : "Top rank reached";

    return `
        <div class="analytics-grid">
            <div class="card-section">
                <h3>Player Analytics</h3>
                <ul class="stats-list">
                    <li>Global rank: <strong>${rankText}</strong></li>
                    <li>Points to next rank: <strong>${nextRankText}</strong></li>
                    <li>Rounds played: <strong>${analytics?.rounds_played || 0}</strong></li>
                    <li>Best score: <strong>${analytics?.best_score || 0}</strong></li>
                    <li>Best accuracy: <strong>${formatMetric(analytics?.best_accuracy || 0, 1)}%</strong></li>
                    <li>Most accurate round: <strong>${bestRound ? `${bestRound.accuracy}%` : "No saved rounds yet"}</strong></li>
                    <li>Best round points per shot: <strong>${bestRound ? formatMetric(bestRound.points_per_shot, 2) : "0.00"}</strong></li>
                </ul>
            </div>
            <div>
                ${buildProgressChartMarkup()}
            </div>
        </div>
    `;
}

function getAuthMarkup() {
    if (!appState.dbAvailable) {
        return `<div class="card-section"><h3>Account System</h3><p class="auth-note">SQLite is not available, so login and register are temporarily disabled.</p></div>`;
    }
    if (appState.user) {
        return `
            <div class="card-section">
                <h3>Logged In</h3>
                <p>You are playing as <strong>${escapeHtml(appState.user.nickname)}</strong> (${escapeHtml(appState.user.username)}).</p>
                <div class="button-row">
                    <button class="button secondary" type="button" data-action="openSettings">User Settings</button>
                    <button class="button secondary" type="button" data-action="openLeaderboard">View Leaderboard</button>
                    <button class="button secondary" type="button" data-action="logout">Logout</button>
                </div>
                <p class="auth-note">Your finished rounds are saved to the leaderboard automatically.</p>
            </div>
        `;
    }
    return `
        <div class="account-entry">
            <p>Open a dedicated account screen so login and register stay clean and readable on desktop.</p>
            <div class="button-row account-entry-actions">
                <button class="button" type="button" data-action="openLogin">Login</button>
                <button class="button secondary" type="button" data-action="openRegister">Register</button>
            </div>
            <p class="auth-note">Scores are saved automatically after you sign in.</p>
        </div>
    `;
}

function getAuthScreenMarkup(activeTab = "login", feedback = null) {
    if (!appState.dbAvailable) {
        return `
            <div class="overlay-card auth-screen-card">
                <span class="tutorial-banner-title">Chicken Shooting</span>
                <h1>Account</h1>
                <p>The account system is temporarily unavailable because SQLite is not ready.</p>
                <div class="button-row button-row-spaced">
                    <button class="button secondary" type="button" data-action="showIntro">Back to Main Menu</button>
                </div>
            </div>
        `;
    }

    const normalizedTab = activeTab === "register" ? "register" : "login";

    return `
        <div class="overlay-card auth-screen-card">
            <span class="tutorial-banner-title">Chicken Shooting</span>
            <h1>Login and Register</h1>
            <p>Enter the account area without compressing the map layout. The game name stays front and center here too.</p>
            <div class="auth-screen-tabs" role="tablist" aria-label="Account forms">
                <button class="auth-tab-button${normalizedTab === "login" ? " active" : ""}" type="button" data-action="switchAuthTab" data-auth-tab="login" aria-pressed="${normalizedTab === "login"}">Login</button>
                <button class="auth-tab-button${normalizedTab === "register" ? " active" : ""}" type="button" data-action="switchAuthTab" data-auth-tab="register" aria-pressed="${normalizedTab === "register"}">Register</button>
            </div>
            ${buildFeedbackMarkup("authFeedback", feedback)}
            <div class="auth-grid auth-screen-grid">
                <div class="card-section auth-card${normalizedTab === "login" ? " active" : ""}">
                    <h3>Login</h3>
                    <p class="auth-note">Use your existing profile and continue tracking leaderboard rounds.</p>
                    <form id="loginForm">
                        <div class="field-group"><label for="loginUsername">Username</label><input id="loginUsername" name="username" type="text" minlength="3" maxlength="20" autocomplete="username" required></div>
                        <div class="field-group"><label for="loginPassword">Password</label><input id="loginPassword" name="password" type="password" minlength="6" autocomplete="current-password" required></div>
                        <button class="button" type="submit">Login</button>
                    </form>
                </div>
                <div class="card-section auth-card${normalizedTab === "register" ? " active" : ""}">
                    <h3>Register</h3>
                    <p class="auth-note">Create a username and a leaderboard nickname for Chicken Shooting.</p>
                    <form id="registerForm">
                        <div class="field-group"><label for="registerUsername">Username</label><input id="registerUsername" name="username" type="text" minlength="3" maxlength="20" autocomplete="username" required></div>
                        <div class="field-group"><label for="registerNickname">Nickname</label><input id="registerNickname" name="nickname" type="text" minlength="3" maxlength="20" autocomplete="nickname" required></div>
                        <div class="field-group"><label for="registerPassword">Password</label><input id="registerPassword" name="password" type="password" minlength="6" autocomplete="new-password" required></div>
                        <button class="button" type="submit">Register</button>
                    </form>
                </div>
            </div>
            <div class="button-row button-row-spaced">
                <button class="button secondary" type="button" data-action="showIntro">Back to Main Menu</button>
            </div>
        </div>
    `;
}

function showAuthOverlay(activeTab = "login", feedback = null) {
    centerCrosshair();
    setOverlayMode("default");
    overlay.innerHTML = getAuthScreenMarkup(activeTab, feedback);
    overlay.classList.remove("hidden");
    attachOverlayHandlers();
}

function showFeedback(response) {
    const feedback = overlay.querySelector("#authFeedback");
    if (!feedback) {
        return;
    }
    feedback.textContent = response.message || "";
    feedback.className = `feedback ${response.ok ? "success" : "error"}`;
}

function showScopedFeedback(selector, response) {
    const feedback = overlay.querySelector(selector);
    if (!feedback) {
        return;
    }

    feedback.textContent = response.message || "";
    feedback.className = `feedback ${response.ok ? "success" : "error"}`;
}

function buildFeedbackMarkup(id, feedback = null) {
    const className = feedback ? `feedback ${feedback.ok ? "success" : "error"}` : "feedback";
    const message = feedback?.message ? escapeHtml(feedback.message) : "";

    return `<div id="${escapeHtml(id)}" class="${className}">${message}</div>`;
}

function buildOverlayHeader(title, description = "", eyebrow = "Chicken Shooting") {
    return `
        <div class="overlay-header">
            <span class="tutorial-banner-title">${escapeHtml(eyebrow)}</span>
            <h1>${escapeHtml(title)}</h1>
            ${description ? `<p class="overlay-header-copy">${escapeHtml(description)}</p>` : ""}
        </div>
    `;
}

async function postAction(action, formData) {
    if (!appState.dbAvailable) {
        return { ok: false, message: "Database is not available." };
    }
    try {
        const response = await fetch(`?action=${encodeURIComponent(action)}`, {
            method: "POST",
            body: formData,
            credentials: "same-origin",
            cache: "no-store",
            headers: {
                "Accept": "application/json",
                "X-Requested-With": "XMLHttpRequest",
                "X-CSRF-Token": csrfToken
            }
        });
        const data = await response.json();
        syncSecurityState(data);
        return data;
    } catch (error) {
        return { ok: false, message: "Request failed. Please try again." };
    }
}

async function loadLeaderboard() {
    if (!appState.dbAvailable) {
        return;
    }
    try {
        const response = await fetch("?action=leaderboard", {
            credentials: "same-origin",
            cache: "no-store",
            headers: {
                "Accept": "application/json",
                "X-Requested-With": "XMLHttpRequest"
            }
        });
        const data = await response.json();
        syncSecurityState(data);
        if (data.ok) {
            appState.leaderboard = data.leaderboard || [];
            appState.user = data.user || appState.user;
            appState.analytics = data.analytics || null;
            updateHud();
        }
    } catch (error) {
        setStatus("Could not refresh leaderboard right now.");
    }
}

async function loadRoutes() {
    if (!appState.dbAvailable) {
        return false;
    }

    try {
        const response = await fetch("?action=routes", {
            credentials: "same-origin",
            cache: "no-store",
            headers: {
                "Accept": "application/json",
                "X-Requested-With": "XMLHttpRequest"
            }
        });
        const data = await response.json();
        syncSecurityState(data);
        if (!data.ok || !Array.isArray(data.routes) || data.routes.length === 0) {
            setStatus("Could not load routes right now.");
            return false;
        }

        setRouteConfigs(data.routes);
        bootstrapLevelProgress();
        return true;
    } catch (error) {
        setStatus("Could not load routes right now.");
        return false;
    }
}

function buildLevelMapMarkup() {
    return `
        <div class="world-map-board" role="group" aria-label="World map with level pins">
            <svg class="world-map-image world-map-svg" viewBox="0 0 1000 500" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
                <rect width="1000" height="500" fill="#2c3e50" rx="10"/>
                <g opacity="0.28" fill="#d9c59a">
                    <path d="M78 131c31-24 95-55 152-55 33 0 66 12 89 34 20 18 44 28 79 31 21 2 33 14 31 31-3 20-20 35-51 45-27 9-47 23-61 41-11 14-29 19-50 15-44-8-97-2-147 17-23 9-43 6-61-8-23-18-32-41-27-69 5-26-1-46-17-59-13-11-14-23-3-37 9-10 18-14 27-14 12 0 25 10 39 29z"/>
                    <path d="M392 63c17-10 47-18 81-18 37 0 67 7 90 20 18 11 42 17 71 18 37 1 61 9 73 23 15 18 13 40-7 65-17 22-22 45-13 68 8 21 4 37-13 47-18 11-45 12-81 4-32-6-60-5-84 3-34 13-57 8-70-14-12-21-31-36-57-45-31-11-45-27-43-49 1-16 11-29 29-39 20-10 29-23 28-38-2-20 10-35 36-45z"/>
                    <path d="M680 118c35-16 78-25 129-25 48 0 90 8 126 24 29 13 54 32 76 56 10 11 12 26 5 45-6 16-18 29-37 39-19 10-44 18-74 24-28 6-49 17-61 33-16 22-44 29-83 21-30-6-53-4-69 5-25 14-50 15-74 3-20-9-29-25-27-47 1-16-5-28-19-36-17-11-27-24-29-39-2-19 6-35 24-50 25-20 63-38 113-53z"/>
                    <path d="M296 304c24-14 54-21 89-21 42 0 71 10 86 29 11 13 14 30 8 51-6 22-19 43-40 64-23 24-38 46-44 67-5 18-17 31-36 38-18 7-35 6-50-4-19-12-29-29-29-51 0-15-8-28-24-38-22-14-34-33-35-56-1-30 9-54 30-72 13-12 28-20 45-27z"/>
                </g>
                ${mapPins.map((pin) => `
                    <a
                        class="svg-pin-link"
                        href="${escapeHtml(buildMapPinHref(pin))}"${buildMapPinExtraAttributes(pin)}
                        aria-label="Open ${escapeHtml(getLevelConfig(pin.targetLevel)?.mapTitle || `Level ${pin.targetLevel}`)} from SVG pin ${pin.label}"
                    >
                        <g class="svg-pin-base${pin.primary ? " primary" : ""}" transform="translate(${pin.x}, ${pin.y})">
                            <circle r="15"/>
                            <text y="5">${pin.label}</text>
                        </g>
                    </a>
                `).join("")}
            </svg>
        </div>
    `;
}

function getCookiePreferenceDescription() {
    return canUseFunctionalStorage()
        ? "Funkcionalni kolacici su ukljuceni. Lokalni rekord i otkljucani nivoi se cuvaju na ovom browseru."
        : "Koristis samo neophodne kolacice. Lokalni rekord i nivoi se ne cuvaju na ovom browseru.";
}

function getSettingsOverlayMarkup(feedback = null) {
    const isLoggedIn = Boolean(appState.user);
    const backAction = gameRunning || gamePaused ? "openPauseMenu" : "showIntro";
    const backLabel = gameRunning || gamePaused ? "Back to Game Menu" : "Back to Main Menu";

    return `
        <div class="overlay-card">
            ${buildOverlayHeader("User Settings", "Manage your profile, password and cookie preferences without covering the whole game flow.", "Chicken Shooting")}
            ${buildFeedbackMarkup("settingsFeedback", feedback)}
            <div class="settings-layout">
                <div class="settings-stack">
                    <div class="card-section">
                        <h3>Profile</h3>
                        ${isLoggedIn ? `
                            <p>Username ostaje fiksan, a nickname se prikazuje na leaderboard-u i u HUD-u.</p>
                            <div class="settings-summary">
                                <div class="settings-chip">
                                    <span class="settings-chip-label">Username</span>
                                    <strong>${escapeHtml(appState.user.username)}</strong>
                                </div>
                                <div class="settings-chip">
                                    <span class="settings-chip-label">Current Nickname</span>
                                    <strong>${escapeHtml(appState.user.nickname)}</strong>
                                </div>
                            </div>
                            <form id="profileForm" class="button-row-spaced">
                                <div class="field-group">
                                    <label for="settingsNickname">Nickname</label>
                                    <input id="settingsNickname" name="nickname" type="text" minlength="3" maxlength="20" value="${escapeHtml(appState.user.nickname)}" autocomplete="nickname" required>
                                </div>
                                <button class="button" type="submit">Save Profile</button>
                            </form>
                        ` : `
                            <p>Trenutno igras kao guest. Prijavi se iz glavnog menija da bi menjao profil i lozinku.</p>
                        `}
                    </div>
                    <div class="card-section">
                        <h3>Security</h3>
                        ${isLoggedIn ? `
                            <p>Promeni lozinku bez napustanja igre. Posle izmene sesija ostaje prijavljena i osvezena.</p>
                            <form id="passwordForm">
                                <div class="field-group">
                                    <label for="currentPassword">Current Password</label>
                                    <input id="currentPassword" name="current_password" type="password" minlength="6" autocomplete="current-password" required>
                                </div>
                                <div class="field-group">
                                    <label for="newPassword">New Password</label>
                                    <input id="newPassword" name="new_password" type="password" minlength="6" autocomplete="new-password" required>
                                </div>
                                <div class="field-group">
                                    <label for="confirmPassword">Confirm New Password</label>
                                    <input id="confirmPassword" name="confirm_password" type="password" minlength="6" autocomplete="new-password" required>
                                </div>
                                <button class="button" type="submit">Change Password</button>
                            </form>
                        ` : `
                            <p>Bez prijave nema promena bezbednosnih podesavanja. Cookie opcije su dostupne i u guest modu.</p>
                        `}
                    </div>
                </div>
                <div class="settings-stack">
                    <div class="card-section">
                        <h3>Cookie Preferences</h3>
                        <p>${escapeHtml(getCookiePreferenceDescription())}</p>
                        <form id="cookieSettingsForm">
                            <div class="settings-toggle">
                                <div>
                                    <strong>Essential cookies</strong>
                                    <p>Sesija, login i CSRF zastita su uvek ukljuceni.</p>
                                </div>
                                <span class="settings-badge">Always on</span>
                            </div>
                            <label class="settings-toggle" for="settingsCookieFunctional">
                                <div>
                                    <strong>Functional cookies</strong>
                                    <p>Cuvaju local best score i otkljucane nivoe na ovom browseru.</p>
                                </div>
                                <input id="settingsCookieFunctional" name="functional_cookies" type="checkbox"${canUseFunctionalStorage() ? " checked" : ""}>
                            </label>
                            <div class="button-row button-row-spaced">
                                <button class="button" type="submit">Save Cookie Settings</button>
                            </div>
                        </form>
                    </div>
                    <div class="card-section">
                        <h3>Session Overview</h3>
                        <ul class="menu-list">
                            <li>Player: <strong>${escapeHtml(appState.user?.nickname || "Guest")}</strong></li>
                            <li>Account status: <strong>${isLoggedIn ? "Logged in" : "Guest mode"}</strong></li>
                            <li>Local best score: <strong>${bestScore}</strong></li>
                            <li>Unlocked routes: <strong>${maxUnlockedLevel} / ${maxLevel}</strong></li>
                        </ul>
                    </div>
                </div>
            </div>
            <div class="button-row button-row-spaced">
                ${gamePaused ? '<button class="button secondary" type="button" data-action="resumeGame">Resume Game</button>' : ""}
                <button class="button secondary" type="button" data-action="${backAction}">${backLabel}</button>
            </div>
        </div>
    `;
}

function getIntroOverlayMarkup(showTutorialComplete = false) {
    const selectedConfig = getLevelConfig(selectedStartLevel);
    const selectedRouteTitle = selectedConfig?.mapTitle || "Route unavailable";
    const authPanelMarkup = appState.user
        ? `
            <div class="intro-panel intro-auth-panel">
                <span class="tutorial-banner-title">Account</span>
                ${getAuthMarkup()}
                <div id="authFeedback" class="feedback"></div>
            </div>
        `
        : `
            <div class="intro-panel intro-auth-panel intro-account-panel">
                <span class="tutorial-banner-title">Chicken Shooting</span>
                <h2>Account</h2>
                ${getAuthMarkup()}
            </div>
        `;

    return `
        <div class="intro-map-shell">
            ${buildLevelMapMarkup()}
            <div class="intro-layout">
                <div class="intro-panel intro-hero-panel">
                    <span class="tutorial-banner-title">Global Hunt Map</span>
                    <h1>Chicken Shooting</h1>
                    <p>Desktop intro stays map-first, with the world map covering the whole screen and compact panels around the edges.</p>
                    <p>Click pins <strong>1</strong> through <strong>8</strong> on the map to open that exact level directly.</p>
                    ${showTutorialComplete ? '<p><strong>Tutorial successfully accomplished.</strong> Now you can launch any route directly from the map.</p>' : ""}
                </div>
                <div class="intro-panel intro-status-panel">
                    <div class="intro-stat">
                        <span class="intro-stat-label">Selected Route</span>
                        <strong>${escapeHtml(selectedRouteTitle)}</strong>
                    </div>
                    <div class="intro-stat">
                        <span class="intro-stat-label">Best Local Score</span>
                        <strong>${bestScore}</strong>
                    </div>
                    <div class="intro-stat">
                        <span class="intro-stat-label">Unlocked Routes</span>
                        <strong>${maxUnlockedLevel} / ${maxLevel}</strong>
                    </div>
                    <div class="intro-stat">
                        <span class="intro-stat-label">Launch</span>
                        <strong>Click any pin</strong>
                    </div>
                </div>
                <div class="intro-panel intro-info-panel">
                    <ul class="tutorial-list">
                        <li class="tutorial-item"><span class="tutorial-title">Controls</span>Click to shoot. Press <strong>R</strong> to restart instantly. Use the <strong>Menu</strong> button or press <strong>Esc</strong> during a round to open the pause menu.</li>
                        <li class="tutorial-item"><span class="tutorial-title">Reload</span>When ammo reaches zero, the shotgun appears on screen. Follow the arrow sequence on your keyboard, or tap the on-screen arrows on mobile, to chamber a new magazine.</li>
                        <li class="tutorial-item"><span class="tutorial-title">Best Targets</span>Blue chickens are the fastest and worth the most points. Cream ones are easiest to hit.</li>
                        <li class="tutorial-item"><span class="tutorial-title">Routes</span>Push past 800 points to unlock the Russian mountain route, beyond 1500 for the tropical island sprint, over 2300 for the racing circuit, beyond 3200 for Paris Night, over 4100 for Pisa Plaza, beyond 5000 for Rio Heights, and over 6200 for Istanbul Skyline.</li>
                    </ul>
                </div>
                ${authPanelMarkup}
                <div class="intro-panel intro-actions-panel">
                    <div class="tutorial-actions">
                        <button class="button secondary" type="button" data-action="startTutorial">Start tutorial</button>
                        <button class="button" type="button" data-action="startGame">Enter ${escapeHtml(selectedRouteTitle)}</button>
                        <button class="button secondary" type="button" data-action="openSettings">User Settings</button>
                        <button class="button secondary" type="button" data-action="openLeaderboard">View Leaderboard</button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function showIntroOverlay(showTutorialComplete = false) {
    if (!gameRunning && !gamePaused) {
        currentLevel = selectedStartLevel;
        applyLevelTheme();
    }
    centerCrosshair();
    setOverlayMode("intro");
    overlay.innerHTML = getIntroOverlayMarkup(showTutorialComplete);
    overlay.classList.remove("hidden");
    attachOverlayHandlers();
}

function showLeaderboardOverlay() {
    centerCrosshair();
    setOverlayMode("default");
    overlay.innerHTML = `
        <div class="overlay-card">
            ${buildOverlayHeader("Leaderboard", "Best score for each registered nickname and a quick look at player progress.", "Chicken Shooting")}
            ${buildLeaderboardMarkup()}
            ${buildAnalyticsMarkup()}
            <div class="button-row button-row-spaced">
                <button class="button secondary" type="button" data-action="openSettings">User Settings</button>
                <button class="button secondary" type="button" data-action="showIntro">Back</button>
                ${gameRunning || gamePaused ? '<button class="button" type="button" data-action="openPauseMenu">Game Menu</button>' : '<button class="button" type="button" data-action="startGame">Start Hunt</button>'}
            </div>
        </div>
    `;
    overlay.classList.remove("hidden");
    attachOverlayHandlers();
}

function showSettingsOverlay(feedback = null) {
    centerCrosshair();
    setOverlayMode("default");
    overlay.innerHTML = getSettingsOverlayMarkup(feedback);
    overlay.classList.remove("hidden");
    attachOverlayHandlers();
}

function openPauseMenu() {
    if (!gameRunning && !gamePaused) {
        showIntroOverlay();
        return;
    }

    pauseGame();
    centerCrosshair();
    setOverlayMode("default");
    overlay.innerHTML = `
        <div class="overlay-card">
            ${buildOverlayHeader("Game Menu", "The round is paused. Pick the next step and jump back into Chicken Shooting when you're ready.", "Chicken Shooting")}
            <ul class="menu-list">
                <li>Current level: <strong>${currentLevel}</strong></li>
                <li>Current score: <strong>${score}</strong></li>
                <li>Time left: <strong>${timeLeft}</strong> seconds</li>
                <li>Total clicks: <strong>${clickCount}</strong></li>
                <li>Hits: <strong>${hitCount}</strong></li>
                <li>Accuracy: <strong>${formatMetric(calculateAccuracy(clickCount, hitCount), 1)}%</strong></li>
                <li>Points per shot: <strong>${formatMetric(calculatePointsPerShot(score, clickCount), 2)}</strong></li>
                <li>Logged in as: <strong>${escapeHtml(appState.user?.nickname || "Guest")}</strong></li>
            </ul>
            <div class="button-row button-row-spaced">
                <button class="button" type="button" data-action="resumeGame">Resume</button>
                <button class="button" type="button" data-action="restartGame">Restart</button>
                <button class="button secondary" type="button" data-action="openSettings">User Settings</button>
                <button class="button secondary" type="button" data-action="openLeaderboard">View Leaderboard</button>
                <button class="button danger-button" type="button" data-action="endGame">End Game</button>
            </div>
        </div>
    `;
    overlay.classList.remove("hidden");
    attachOverlayHandlers();
}

function attachOverlayHandlers() {
    const loginForm = document.getElementById("loginForm");
    const registerForm = document.getElementById("registerForm");
    const profileForm = document.getElementById("profileForm");
    const passwordForm = document.getElementById("passwordForm");
    const cookieSettingsForm = document.getElementById("cookieSettingsForm");
    const loginButton = overlay.querySelector('[data-action="openLogin"]');
    const registerButton = overlay.querySelector('[data-action="openRegister"]');
    const authTabButtons = overlay.querySelectorAll('[data-action="switchAuthTab"]');
    const openLeaderboardButton = overlay.querySelector('[data-action="openLeaderboard"]');
    const logoutButton = overlay.querySelector('[data-action="logout"]');
    const resumeButton = overlay.querySelector('[data-action="resumeGame"]');
    const startButtons = overlay.querySelectorAll('[data-action="startGame"]');
    const tutorialButtons = overlay.querySelectorAll('[data-action="startTutorial"]');
    const restartButtons = overlay.querySelectorAll('[data-action="restartGame"]');
    const endButtons = overlay.querySelectorAll('[data-action="endGame"]');
    const menuButtons = overlay.querySelectorAll('[data-action="openPauseMenu"]');
    const introButtons = overlay.querySelectorAll('[data-action="showIntro"]');
    const settingsButtons = overlay.querySelectorAll('[data-action="openSettings"]');

    if (loginForm) {
        loginForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            const response = await postAction("login", new FormData(loginForm));
            if (!response.ok) {
                showAuthOverlay("login", response);
                return;
            }

            appState.user = response.user;
            appState.leaderboard = response.leaderboard || appState.leaderboard;
            appState.analytics = response.analytics || null;
            updateHud();
            showIntroOverlay();
        });
    }

    if (registerForm) {
        registerForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            const response = await postAction("register", new FormData(registerForm));
            if (!response.ok) {
                showAuthOverlay("register", response);
                return;
            }

            appState.user = response.user;
            appState.leaderboard = response.leaderboard || appState.leaderboard;
            appState.analytics = response.analytics || null;
            updateHud();
            showIntroOverlay();
        });
    }

    if (profileForm) {
        profileForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            const response = await postAction("update_profile", new FormData(profileForm));
            if (!response.ok) {
                showScopedFeedback("#settingsFeedback", response);
                return;
            }

            appState.user = response.user || appState.user;
            appState.leaderboard = response.leaderboard || appState.leaderboard;
            appState.analytics = response.analytics || appState.analytics;
            updateHud();
            showSettingsOverlay(response);
        });
    }

    if (passwordForm) {
        passwordForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            const confirmPasswordInput = document.getElementById("confirmPassword");
            const newPasswordInput = document.getElementById("newPassword");

            if (confirmPasswordInput && newPasswordInput && confirmPasswordInput.value !== newPasswordInput.value) {
                showScopedFeedback("#settingsFeedback", {
                    ok: false,
                    message: "New password and confirmation must match."
                });
                return;
            }

            const formData = new FormData(passwordForm);
            formData.delete("confirm_password");
            const response = await postAction("change_password", formData);
            if (!response.ok) {
                showScopedFeedback("#settingsFeedback", response);
                return;
            }

            appState.user = response.user || appState.user;
            appState.leaderboard = response.leaderboard || appState.leaderboard;
            appState.analytics = response.analytics || appState.analytics;
            showSettingsOverlay(response);
        });
    }

    if (cookieSettingsForm) {
        cookieSettingsForm.addEventListener("submit", (event) => {
            event.preventDefault();
            const functionalCookieInput = document.getElementById("settingsCookieFunctional");
            saveCookiePreferences(Boolean(functionalCookieInput?.checked), { refreshOverlay: false });
            showSettingsOverlay({
                ok: true,
                message: "Cookie settings saved."
            });
        });
    }

    loginButton?.addEventListener("click", () => showAuthOverlay("login"));
    registerButton?.addEventListener("click", () => showAuthOverlay("register"));
    authTabButtons.forEach((button) => button.addEventListener("click", () => {
        showAuthOverlay(button.dataset.authTab || "login");
    }));
    openLeaderboardButton?.addEventListener("click", showLeaderboardOverlay);
    resumeButton?.addEventListener("click", resumeGameFromPause);
    startButtons.forEach((button) => button.addEventListener("click", () => startGame()));
    tutorialButtons.forEach((button) => button.addEventListener("click", startTutorialGame));
    restartButtons.forEach((button) => button.addEventListener("click", restartGame));
    endButtons.forEach((button) => button.addEventListener("click", () => endGame(true)));
    menuButtons.forEach((button) => button.addEventListener("click", openPauseMenu));
    introButtons.forEach((button) => button.addEventListener("click", showIntroOverlay));
    settingsButtons.forEach((button) => button.addEventListener("click", () => showSettingsOverlay()));

    if (logoutButton) {
        logoutButton.addEventListener("click", async () => {
            const response = await postAction("logout", new FormData());
            showFeedback(response);
            if (response.ok) {
                appState.user = null;
                appState.leaderboard = response.leaderboard || [];
                appState.analytics = response.analytics || null;
                updateHud();
                showIntroOverlay();
            }
        });
    }
}

function pauseGame() {
    if (!gameRunning || gamePaused) {
        return;
    }
    gamePaused = true;
    cancelAnimationFrame(rafId);
    rafId = null;
    setStatus("Game paused. Press Esc again to resume or use the menu.");
}

function resumeGameFromPause() {
    if (!gamePaused) {
        overlay.classList.add("hidden");
        return;
    }
    gamePaused = false;
    lastFrameTime = 0;
    overlay.classList.add("hidden");
    setStatus("Back in the hunt.");
    rafId = requestAnimationFrame(animateChickens);
}

function tropicalChickenMarkup() {
    return `
        <span class="chicken-sprite tropical-reference-sprite">
            <img class="tropical-reference-image" src="assets/images/chicken-hawai-cutout.png" alt="" aria-hidden="true">
        </span>
    `;
}

function chickenMarkup(bodyColor, wingColor, beakColor) {
    if (currentLevel === 3) {
        return tropicalChickenMarkup();
    }

    const isItalyLevel = currentLevel === 6;
    const isRioLevel = currentLevel === 7;
    const renderedBodyColor = isItalyLevel ? "#fff7e6" : bodyColor;
    const renderedWingColor = isItalyLevel ? "#168a4a" : wingColor;
    const renderedBeakColor = isItalyLevel ? "#f2a12b" : beakColor;
    const winterHat = currentLevel === 2 ? `
                <g class="winter-hat">
                    <path class="winter-hat-top" d="M60 16 C70 10, 92 11, 102 20 C104 30, 101 40, 90 45 L67 45 C58 40, 56 27, 60 16 Z" fill="#101010"></path>
                    <path class="winter-hat-top" d="M60 16 C70 10, 92 11, 102 20 C104 30, 101 40, 90 45 L67 45 C58 40, 56 27, 60 16 Z" fill="#3b3b3b" opacity="0.24"></path>
                    <rect class="winter-hat-top" x="61" y="34" width="40" height="14" rx="7" fill="#1d1d1d"></rect>
                    <path class="winter-hat-flap-left" d="M63 38 C51 42, 48 54, 50 67 C53 78, 60 88, 67 94 C66 79, 69 60, 73 44 Z" fill="#0d0d0d"></path>
                    <path class="winter-hat-flap-right" d="M97 38 C107 43, 111 55, 109 68 C106 78, 100 88, 94 94 C95 78, 92 60, 88 44 Z" fill="#0d0d0d"></path>
                    <circle class="winter-hat-badge" cx="81" cy="31" r="7.2" fill="#cf3030"></circle>
                    <path class="winter-hat-badge" d="M81 22 L83 28 L89 28 L84 32 L86 38 L81 34 L76 38 L78 32 L73 28 L79 28 Z" fill="#f0d25c"></path>
                    <circle class="winter-hat-badge" cx="81" cy="31" r="9.2" fill="none" stroke="#f0d25c" stroke-width="2"></circle>
                </g>
            ` : "";
    const parisBeret = currentLevel === 5 ? `
                <g class="paris-beret">
                    <path class="paris-beret-crown" d="M70 31 C78 20, 99 18, 111 29 C102 39, 82 42, 65 36 C64 33, 66 31, 70 31 Z" fill="#161719"></path>
                    <path class="paris-beret-brim" d="M67 36 C78 42, 98 42, 110 34 C111 39, 104 45, 90 47 C78 49, 68 45, 64 40 C63 38, 64 36, 67 36 Z" fill="#26292d"></path>
                    <path class="paris-beret-pin" d="M88 19 L91 26" stroke="#f7d35d" stroke-width="3" stroke-linecap="round"></path>
                </g>
            ` : "";
    const italyFlagColors = isItalyLevel ? `
                <g class="italy-flag-body">
                    <ellipse cx="51" cy="68" rx="13" ry="20" fill="#138a43"></ellipse>
                    <ellipse cx="62" cy="68" rx="12" ry="21" fill="#fffdf4"></ellipse>
                    <ellipse cx="74" cy="68" rx="13" ry="20" fill="#ce2b37"></ellipse>
                </g>
                <g class="italy-flag-head">
                    <ellipse cx="82" cy="52" rx="7" ry="13" fill="#138a43"></ellipse>
                    <ellipse cx="89" cy="52" rx="7" ry="14" fill="#fffdf4"></ellipse>
                    <ellipse cx="96" cy="52" rx="7" ry="13" fill="#ce2b37"></ellipse>
                </g>
                <path class="italy-scarf" d="M74 73 C83 79, 94 80, 103 75" stroke="#138a43" stroke-width="6" fill="none" stroke-linecap="round"></path>
                <path class="italy-scarf" d="M78 80 C87 86, 98 86, 108 80" stroke="#ce2b37" stroke-width="5" fill="none" stroke-linecap="round"></path>
            ` : "";
    const rioSash = isRioLevel ? `
                <path class="rio-sash" d="M45 53 C60 72, 78 82, 99 83" stroke="#1f9f68" stroke-width="7" fill="none" stroke-linecap="round"></path>
                <path class="rio-sash" d="M49 58 C64 74, 81 80, 98 78" stroke="#ffd447" stroke-width="4" fill="none" stroke-linecap="round"></path>
                <circle class="rio-badge" cx="86" cy="78" r="7" fill="#2e73b8"></circle>
                <path class="rio-badge-star" d="M86 72 L88 77 L93 77 L89 80 L91 85 L86 82 L81 85 L83 80 L79 77 L84 77 Z" fill="#fff8d6"></path>
            ` : "";
    const racingHelmet = currentLevel === 4 ? `
                <g class="racing-helmet">
                    <path d="M62 16 C74 4, 104 6, 112 22 C116 34, 112 46, 102 48 L68 48 C58 44, 56 30, 62 16 Z" fill="#c0392b"></path>
                    <path d="M66 20 C77 10, 99 11, 107 24" stroke="rgba(255,255,255,0.28)" stroke-width="4" fill="none" stroke-linecap="round"></path>
                    <rect x="62" y="38" width="49" height="12" rx="6" fill="#922b21"></rect>
                    <rect x="70" y="34" width="30" height="16" rx="3" fill="rgba(160,210,240,0.55)"></rect>
                </g>
            ` : "";
    return `
        <span class="chicken-sprite">
            <svg viewBox="0 0 120 120" aria-hidden="true">
                ${winterHat}
                ${racingHelmet}
                <ellipse cx="62" cy="68" rx="30" ry="22" fill="${renderedBodyColor}"></ellipse>
                <ellipse cx="88" cy="52" rx="18" ry="15" fill="${renderedBodyColor}"></ellipse>
                ${italyFlagColors}
                ${parisBeret}
                ${rioSash}
                <ellipse cx="40" cy="64" rx="16" ry="13" fill="${renderedWingColor}" opacity="0.95"></ellipse>
                <circle cx="95" cy="49" r="3.4" fill="#2b2318"></circle>
                <polygon points="102,55 117,60 102,65" fill="${renderedBeakColor}"></polygon>
                <path d="M82 37 C88 26, 102 26, 106 40" stroke="#d84b3f" stroke-width="6" fill="none" stroke-linecap="round"></path>
                <path d="M53 88 L50 109 M66 88 L63 109" stroke="#b56c2f" stroke-width="5" stroke-linecap="round"></path>
                <path d="M49 109 L44 116 M49 109 L54 116 M62 109 L57 116 M62 109 L67 116" stroke="#b56c2f" stroke-width="4" stroke-linecap="round"></path>
            </svg>
        </span>
    `;
}

function renderChicken(chicken) {
    const bobY = chicken.y + chicken.waveOffset;
    const facing = chicken.direction === -1 ? -1 : 1;
    chicken.el.style.transform = `translate3d(${chicken.x}px, ${bobY}px, 0) scaleX(${facing})`;
}

function createEffect(x, y, className, text = "") {
    const effect = document.createElement("div");
    effect.className = className;
    effect.style.left = `${x}px`;
    effect.style.top = `${y}px`;
    if (text) {
        effect.textContent = text;
    }
    gameArea.appendChild(effect);
    setTimeout(() => effect.remove(), 700);
}

function getRandomChickenType() {
    const random = Math.random();
    if (random < 0.34) return chickenTypes[0];
    if (random < 0.61) return chickenTypes[1];
    if (random < 0.84) return chickenTypes[2];
    return chickenTypes[3];
}

function spawnChicken(options = {}) {
    if (!gameRunning || gamePaused || chickens.size >= getActiveSpawnLimit()) {
        return;
    }

    const size = options.size ?? (Math.random() * 26 + 66);
    const upperBound = Math.max(80, viewport.height - viewport.bottomInset - size);
    const minY = Math.min(Math.max(56, viewport.topInset), Math.max(40, upperBound - 40));
    const maxY = Math.max(minY, upperBound);
    const y = options.y ?? (minY + Math.random() * Math.max(0, maxY - minY));
    const direction = options.direction ?? (Math.random() > 0.5 ? 1 : -1);
    const type = options.type ?? getRandomChickenType();
    const baseSpeed = options.speed ?? (type.speedMin + Math.random() * (type.speedMax - type.speedMin));
    const speed = baseSpeed * getActiveSpeedMultiplier();
    const startX = direction === 1 ? -size - 30 : viewport.width + 30;
    const [body, wing, beak] = type.colors;
    const pointRatio = Math.max(0, Math.min(1, (speed - type.speedMin) / (type.speedMax - type.speedMin || 1)));
    const chickenClass = getLevelConfig().chickenClass;

    const chicken = document.createElement("button");
    chicken.type = "button";
    chicken.className = "chicken";
    if (chickenClass) {
        chicken.classList.add(chickenClass);
    }
    chicken.style.width = `${size}px`;
    chicken.style.height = `${size}px`;
    chicken.innerHTML = chickenMarkup(body, wing, beak);
    chicken.setAttribute("aria-label", `${type.label} worth around ${type.pointsMin} to ${type.pointsMax} points`);

    const id = chickenId++;
    const data = {
        id,
        el: chicken,
        x: startX,
        y,
        waveOffset: 0,
        direction,
        speed,
        drift: Math.random() * 0.9 + 0.3,
        phase: Math.random() * Math.PI * 2,
        alive: true,
        points: Math.round(type.pointsMin + pointRatio * (type.pointsMax - type.pointsMin)),
        tutorialTarget: Boolean(options.tutorialTarget)
    };

    chicken.addEventListener("click", (event) => {
        event.stopPropagation();
        shootAt(event.clientX, event.clientY, data, true);
    });

    chickens.set(id, data);
    gameArea.appendChild(chicken);
    renderChicken(data);

    if (data.tutorialTarget) {
        tutorialTargetId = id;
        chicken.classList.add("tutorial-target");
    }

    return data;
}

function removeChicken(id) {
    const chicken = chickens.get(id);
    if (!chicken) {
        return;
    }
    if (tutorialTargetId === id) {
        tutorialTargetId = null;
    }
    chicken.el.remove();
    chickens.delete(id);

    if (tutorialMode && chickens.size > 0 && tutorialTargetId === null) {
        highlightTutorialTarget();
    }
}

function reload() {
    if (!gameRunning || gamePaused || reloadActive) {
        return;
    }
    beginReloadChallenge();
}

function shootAt(clientX, clientY, chicken = null, directHit = false) {
    if (!gameRunning || gamePaused) {
        return;
    }

    clickCount += 1;
    updateHud();

    if (reloadActive) {
        setStatus("Finish the arrow reload before shooting again.");
        return;
    }

    const rect = gameArea.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    createEffect(x, y, "muzzle-flash");
    playSound("shot");

    if (ammo <= 0) {
        reload();
        return;
    }

    ammo -= 1;
    updateHud();

    if (directHit && chicken && chicken.alive) {
        chicken.alive = false;
        hitCount += 1;
        const racingBonus = getRacingHitBonus();
        const awardedPoints = chicken.points + racingBonus;
        score += awardedPoints;
        updateHud();
        setStatus(`Direct hit! +${awardedPoints} points.${describeRacingCombo(racingBonus)}`);
        playSound("hit");
        chicken.el.classList.add("hit");
        createEffect(x, y, "score-pop", `+${awardedPoints}`);
        if (tutorialMode) {
            advanceTutorialAfterHit();
        }
        setTimeout(() => removeChicken(chicken.id), 280);

        if (maybeAdvanceToNextLevel()) {
            return;
        }
    } else {
        resetRacingCombo();
        playSound("miss");
        if (!tutorialMode) {
            score = Math.max(0, score - 2);
            updateHud();
            setStatus("Missed shot. The chickens are getting away.");
        } else {
            setStatus("Missed shot. The chickens are getting away. Try again, shoot marked chicken");
        }
    }

    if (ammo === 0) {
        reload();
    }
}

function animateChickens(timestamp) {
    if (!gameRunning || gamePaused) {
        return;
    }
    if (!lastFrameTime) {
        lastFrameTime = timestamp;
    }

    const deltaMs = Math.min(32, timestamp - lastFrameTime);
    lastFrameTime = timestamp;
    const deltaSeconds = deltaMs / 1000;

    spawnAccumulator += deltaMs;
    secondAccumulator += deltaMs;

    const activeSpawnEveryMs = getActiveSpawnEveryMs();

    if (!tutorialMode && spawnAccumulator >= activeSpawnEveryMs) {
        spawnAccumulator -= activeSpawnEveryMs;
        spawnChicken();
    }

    if (!tutorialMode && secondAccumulator >= 1000) {
        secondAccumulator -= 1000;
        timeLeft -= 1;
        updateHud();
        if (timeLeft <= 0) {
            endGame(false);
            return;
        }
    }

    chickens.forEach((chicken, id) => {
        if (!chicken.alive) {
            return;
        }
        chicken.x += chicken.speed * deltaSeconds * chicken.direction;
        chicken.waveOffset = Math.sin(timestamp * 0.004 + chicken.phase) * 12 * chicken.drift;
        renderChicken(chicken);
        if ((chicken.direction === 1 && chicken.x > viewport.width + 120) || (chicken.direction === -1 && chicken.x < -120)) {
            removeChicken(id);
        }
    });

    rafId = requestAnimationFrame(animateChickens);
}

async function saveScoreIfLoggedIn() {
    if (!appState.user || !appState.dbAvailable) {
        return;
    }
    const formData = new FormData();
    formData.append("score", String(score));
    formData.append("clicks", String(clickCount));
    formData.append("hits", String(hitCount));
    const response = await postAction("save_score", formData);
    if (response.ok && response.leaderboard) {
        appState.leaderboard = response.leaderboard;
        appState.analytics = response.analytics || null;
    } else if (!response.ok) {
        setStatus(response.message || "Could not save score.");
    }
}

async function endGame(endedEarly = false) {
    const finalScore = score;
    const finalClicks = clickCount;
    const finalHits = hitCount;
    const finalAccuracy = calculateAccuracy(finalClicks, finalHits);
    const finalPointsPerShot = calculatePointsPerShot(finalScore, finalClicks);
    const playerLevel = classifyPlayerLevel(finalScore, finalAccuracy, finalPointsPerShot, finalHits);
    const wasTutorialMode = tutorialMode;
    gameRunning = false;
    gamePaused = false;
    clearTimeout(reloadTimeout);
    cancelAnimationFrame(rafId);
    reloadTimeout = null;
    cancelReloadChallenge();
    rafId = null;
    lastFrameTime = 0;
    spawnAccumulator = 0;
    secondAccumulator = 0;

    if (!wasTutorialMode && finalScore > bestScore) {
        bestScore = finalScore;
        persistBestScore();
    }

    if (!wasTutorialMode) {
        unlockLevel(computeUnlockedLevelFromScore(Math.max(finalScore, bestScore)));
    }

    hideLevelBanner();
    clearAllChickens();
    updateHud();
    if (!wasTutorialMode) {
        await saveScoreIfLoggedIn();
    }

    if (wasTutorialMode) {
        finishTutorialMode();
        return;
    }

    setOverlayMode("default");
    overlay.innerHTML = `
        <div class="overlay-card">
            ${buildOverlayHeader(endedEarly ? "Game Ended" : "Time Up", "Round summary, performance stats and the fastest way back into the hunt.", "Chicken Shooting")}
            <p>You scored <strong>${finalScore}</strong> points. Accuracy analytics for this round are ready below, and ${appState.user ? "your round was saved to the leaderboard." : "you can log in to save future rounds to the leaderboard."}</p>
            <p><strong>Reached level:</strong> ${currentLevel}</p>
            <p><strong>Unlocked routes:</strong> ${maxUnlockedLevel} / ${maxLevel}</p>
            <p><strong>Nivo igraca:</strong> ${playerLevel.level}<br>${playerLevel.summary}</p>
            <ul class="stats-list round-summary">
                <li>Clicks: <strong>${finalClicks}</strong></li>
                <li>Hits: <strong>${finalHits}</strong></li>
                <li>Accuracy: <strong>${formatMetric(finalAccuracy, 1)}%</strong></li>
                <li>Points per shot: <strong>${formatMetric(finalPointsPerShot, 2)}</strong></li>
                <li>Best local score: <strong>${bestScore}</strong></li>
            </ul>
            ${buildRoundCoachMarkup(finalScore, finalClicks, finalHits, finalAccuracy, finalPointsPerShot)}
            <div class="button-row">
                <button class="button" type="button" data-action="restartGame">Play Again</button>
                <button class="button secondary" type="button" data-action="openSettings">User Settings</button>
                <button class="button secondary" type="button" data-action="openLeaderboard">View Leaderboard</button>
                <button class="button secondary" type="button" data-action="showIntro">Main Menu</button>
            </div>
        </div>
    `;
    overlay.classList.remove("hidden");
    attachOverlayHandlers();
    setStatus(endedEarly ? "Round ended from the pause menu." : "Round finished. Jump back in for another hunt.");
}

function resetRoundState() {
    clearTimeout(reloadTimeout);
    cancelAnimationFrame(rafId);
    reloadTimeout = null;
    cancelReloadChallenge();
    rafId = null;
    hideLevelBanner();
    clearAllChickens();
    score = 0;
    timeLeft = totalTime;
    ammo = magSize;
    clickCount = 0;
    hitCount = 0;
    chickenId = 0;
    lastFrameTime = 0;
    spawnAccumulator = 0;
    secondAccumulator = 0;
    gamePaused = false;
    currentLevel = 1;
    resetRacingCombo();
    applyLevelTheme();
}

function startGame(levelOverride = null) {
    const startingLevel = levelOverride === null ? selectedStartLevel : normalizeLevelNumber(levelOverride);
    tutorialMode = false;
    tutorialStep = 0;
    selectedStartLevel = startingLevel;
    setTutorialMessage("");
    overlay.classList.add("hidden");
    resetRoundState();
    gameRunning = true;
    updateViewport();
    activateLevel(startingLevel, { showBanner: startingLevel > 1 });
    rafId = requestAnimationFrame(animateChickens);
}

function startTutorialGame() {
    tutorialMode = true;
    tutorialStep = 0;
    overlay.classList.add("hidden");
    resetRoundState();
    gameRunning = true;
    updateViewport();
    updateHud();
    setTutorialMessage(tutorialSteps[0]);
    setStatus("Tutorial is active. Follow text on top and shoot marked chicken.");
    spawnTutorialChicken();
    rafId = requestAnimationFrame(animateChickens);
}

function restartGame() {
    if (tutorialMode) {
        startTutorialGame();
        return;
    }
    startGame();
}

function queueCrosshairRender() {
    if (crosshairQueued) {
        return;
    }
    crosshairQueued = true;
    requestAnimationFrame(() => {
        crosshair.style.transform = `translate3d(${pointerX}px, ${pointerY}px, 0) translate3d(-50%, -50%, 0)`;
        crosshairQueued = false;
    });
}

function centerCrosshair() {
    pointerX = window.innerWidth / 2;
    pointerY = window.innerHeight / 2;
    queueCrosshairRender();
}

menuControl.addEventListener("click", openPauseMenu);
restartControl.addEventListener("click", restartGame);
gameArea.addEventListener("click", (event) => shootAt(event.clientX, event.clientY, null, false));
reloadOverlay.addEventListener("click", (event) => {
    const button = event.target.closest("[data-reload-key]");
    if (!button) {
        return;
    }
    handleReloadInput(button.dataset.reloadKey);
});

window.addEventListener("pointermove", (event) => {
    pointerX = event.clientX;
    pointerY = event.clientY;
    queueCrosshairRender();
}, { passive: true });

window.addEventListener("touchmove", (event) => {
    const touch = event.touches[0];
    if (!touch) {
        return;
    }
    pointerX = touch.clientX;
    pointerY = touch.clientY;
    queueCrosshairRender();
}, { passive: true });

window.addEventListener("resize", updateViewport, { passive: true });
window.addEventListener("keydown", (event) => {
    if (reloadActive && !gamePaused && isArrowKey(event.key)) {
        event.preventDefault();
        handleReloadInput(event.key);
        return;
    }

    const key = event.key.toLowerCase();

    if (key === "r") {
        restartGame();
        return;
    }

    if (event.key === "Escape") {
        event.preventDefault();
        if (gamePaused) {
            resumeGameFromPause();
            return;
        }
        if (gameRunning) {
            openPauseMenu();
            return;
        }
        showIntroOverlay();
    }
});

cookieAcceptButton?.addEventListener("click", () => saveCookiePreferences(true));
cookieEssentialButton?.addEventListener("click", () => saveCookiePreferences(false));
cookieSettingsButton?.addEventListener("click", () => showSettingsOverlay());

updateViewport();
applyLevelTheme();
updateCookieUi();
queueCrosshairRender();
updateHud();

async function initApp() {
    const routesLoaded = await loadRoutes();
    const requestedLevelFromUrl = getRequestedLevelFromUrl();

    if (routesLoaded) {
        if (requestedLevelFromUrl !== null) {
            selectStartLevel(requestedLevelFromUrl, { render: false, force: true });
            clearRequestedLevelFromUrl();
            startGame(requestedLevelFromUrl);
        } else {
            showIntroOverlay();
        }
    } else {
        overlay.classList.remove("hidden");
        overlay.innerHTML = `
            <div class="overlay-card">
                ${buildOverlayHeader("Routes Unavailable", "The route list could not be loaded from the database right now.", "Chicken Shooting")}
                <p class="overlay-header-copy">Try refreshing the page after the backend becomes available.</p>
            </div>
        `;
    }

    loadLeaderboard();
}

initApp();


