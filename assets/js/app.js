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

const totalTime = 45;
const magSize = 6;
const spawnLimit = 8;
const spawnEveryMs = 900;
const levelTwoScoreThreshold = 800;
const levelTwoSpawnLimit = 10;
const levelTwoSpawnEveryMs = 760;
const levelTwoSpeedMultiplier = 1.18;
const levelThreeScoreThreshold = 1500;
const levelThreeSpawnLimit = 12;
const levelThreeSpawnEveryMs = 620;
const levelThreeSpeedMultiplier = 1.32;
const maxLevel = 3;
const levelUnlockStorageKey = "chicken-shooting-unlocked-level";
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
const levelConfigs = {
    1: {
        id: 1,
        name: "Level 1",
        mapTitle: "Farm Run",
        mapCopy: "Classic meadow warm-up with the standard flock.",
        lockedCopy: "",
        status: "Round started. Aim for the quick birds and push past 800 points for the snowy second level.",
        bannerTitle: "Level 1",
        bannerCopy: "The hunt begins across the open meadow.",
        startCount: 4,
        spawnLimit,
        spawnEveryMs,
        speedMultiplier: 1,
        chickenClass: "",
        accessory: "none"
    },
    2: {
        id: 2,
        name: "Level 2",
        mapTitle: "Russian Ridge",
        mapCopy: "Snowy mountain terrain with ushanka-wearing chickens.",
        lockedCopy: "Unlock by pushing beyond 800 score.",
        status: "Level 2 started. Snowy ridge unlocked and the chickens are moving faster.",
        bannerTitle: "Level 2",
        bannerCopy: "Ulazis u ruski planinski teren. Tajmer je vracen na 45 sekundi, a kokoske sada nose zimske kape.",
        startCount: 5,
        spawnLimit: levelTwoSpawnLimit,
        spawnEveryMs: levelTwoSpawnEveryMs,
        speedMultiplier: levelTwoSpeedMultiplier,
        chickenClass: "winter-chicken",
        accessory: "winter"
    },
    3: {
        id: 3,
        name: "Level 3",
        mapTitle: "Island Sprint",
        mapCopy: "A tropical island chase with bright pink flower leis and hotter pace.",
        lockedCopy: "Unlock by pushing beyond 1500 score.",
        status: "Level 3 started. Tropical island unlocked and the chickens are darting through the sea breeze.",
        bannerTitle: "Level 3",
        bannerCopy: "Stizes na tropsko ostrvo. Tajmer je vracen na 45 sekundi, a kokoske sada nose havajski vencic.",
        startCount: 6,
        spawnLimit: levelThreeSpawnLimit,
        spawnEveryMs: levelThreeSpawnEveryMs,
        speedMultiplier: levelThreeSpeedMultiplier,
        chickenClass: "tropical-chicken",
        accessory: "lei"
    }
};
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
let bestScore = Number(localStorage.getItem("chicken-shooting-best") || 0);
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

const tutorialSteps = [
    "Click on the clearly marked chicken. This first target is larger and slower to help you get into the game.",
    "Great. Hit another slower chicken without rushing.",
    "Nice work. Hit one more and you'll be ready for the real game.",
    "Well done! The tutorial is complete. The next round is the standard game."
];

bestEl.textContent = bestScore;
playerNameEl.textContent = appState.user?.nickname || "Guest";
bootstrapLevelProgress();

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

function formatMetric(value, digits = 1) {
    return Number(value || 0).toFixed(digits);
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
    if (scoreValue > levelThreeScoreThreshold) {
        return 3;
    }
    if (scoreValue > levelTwoScoreThreshold) {
        return 2;
    }
    return 1;
}

function bootstrapLevelProgress() {
    const storedLevel = Number(localStorage.getItem(levelUnlockStorageKey) || 1);
    maxUnlockedLevel = Math.min(maxLevel, Math.max(1, storedLevel, computeUnlockedLevelFromScore(bestScore)));
    selectedStartLevel = maxUnlockedLevel;
    currentLevel = selectedStartLevel;
    localStorage.setItem(levelUnlockStorageKey, String(maxUnlockedLevel));
}

function persistUnlockedLevel() {
    localStorage.setItem(levelUnlockStorageKey, String(maxUnlockedLevel));
}

function getLevelConfig(level = currentLevel) {
    return levelConfigs[level] || levelConfigs[1];
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
    const { render = true } = options;
    const nextLevel = Math.min(maxUnlockedLevel, Math.max(1, level));
    selectedStartLevel = nextLevel;
    currentLevel = nextLevel;
    applyLevelTheme();
    if (render) {
        showIntroOverlay();
    }
}

function applyLevelTheme() {
    document.body.classList.toggle("level-two", currentLevel === 2);
    document.body.classList.toggle("level-three", currentLevel === 3);
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

    if (currentLevel === 1 && score > levelTwoScoreThreshold) {
        unlockLevel(2);
        activateLevel(2);
        return true;
    }

    if (currentLevel === 2 && score > levelThreeScoreThreshold) {
        unlockLevel(3);
        activateLevel(3);
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

    return `
        <div class="analytics-grid">
            <div class="card-section">
                <h3>Player Analytics</h3>
                <ul class="stats-list">
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
                    <button class="button secondary" type="button" data-action="openLeaderboard">View Leaderboard</button>
                    <button class="button secondary" type="button" data-action="logout">Logout</button>
                </div>
                <p class="auth-note">Your finished rounds are saved to the leaderboard automatically.</p>
            </div>
        `;
    }
    return `
        <div class="auth-grid">
            <div class="card-section">
                <h3>Login</h3>
                <form id="loginForm">
                    <div class="field-group"><label for="loginUsername">Username</label><input id="loginUsername" name="username" type="text" minlength="3" maxlength="20" autocomplete="username" required></div>
                    <div class="field-group"><label for="loginPassword">Password</label><input id="loginPassword" name="password" type="password" minlength="6" autocomplete="current-password" required></div>
                    <button class="button" type="submit">Login</button>
                </form>
            </div>
            <div class="card-section">
                <h3>Register</h3>
                <form id="registerForm">
                    <div class="field-group"><label for="registerUsername">Username</label><input id="registerUsername" name="username" type="text" minlength="3" maxlength="20" autocomplete="username" required></div>
                    <div class="field-group"><label for="registerNickname">Nickname</label><input id="registerNickname" name="nickname" type="text" minlength="3" maxlength="20" autocomplete="nickname" required></div>
                    <div class="field-group"><label for="registerPassword">Password</label><input id="registerPassword" name="password" type="password" minlength="6" autocomplete="new-password" required></div>
                    <button class="button" type="submit">Register</button>
                </form>
                <p class="auth-note">Nickname must be unique because it appears on the leaderboard.</p>
            </div>
        </div>
    `;
}

function showFeedback(response) {
    const feedback = overlay.querySelector("#authFeedback");
    if (!feedback) {
        return;
    }
    feedback.textContent = response.message || "";
    feedback.className = `feedback ${response.ok ? "success" : "error"}`;
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

function buildLevelMapMarkup() {
    return `
        <section class="level-map" aria-label="Level selection map">
            <div class="level-map-header">
                <span class="tutorial-banner-title">Level Map</span>
                <p class="level-map-copy">Click any unlocked route to jump in, or use the button below for the currently selected start: <strong>${escapeHtml(getLevelConfig(selectedStartLevel).mapTitle)}</strong>.</p>
            </div>
            <div class="level-route" role="list">
                ${Object.values(levelConfigs).map((config) => {
        const unlocked = config.id <= maxUnlockedLevel;
        const selected = config.id === selectedStartLevel;
        return `
                        <button
                            class="level-node ${selected ? "selected" : ""} ${unlocked ? "unlocked" : "locked"}"
                            type="button"
                            data-action="startLevel"
                            data-level="${config.id}"
                            ${unlocked ? "" : "disabled"}
                            aria-pressed="${selected ? "true" : "false"}"
                            aria-label="${escapeHtml(config.name)}${unlocked ? "" : " locked"}"
                            role="listitem"
                        >
                            <span class="level-node-ring"></span>
                            <span class="level-node-number">${config.id}</span>
                            <span class="level-node-title">${escapeHtml(config.mapTitle)}</span>
                            <span class="level-node-copy">${escapeHtml(unlocked ? config.mapCopy : config.lockedCopy)}</span>
                        </button>
                    `;
    }).join("")}
            </div>
        </section>
    `;
}

function getIntroOverlayMarkup(showTutorialComplete = false) {
    const selectedConfig = getLevelConfig(selectedStartLevel);

    return `
        <div class="overlay-card">
            <div class="overlay-grid">
                <div class="card-section">
                    <h1>Chicken Shooting</h1>
                    <p>Hunt runaway chickens for 45 seconds. Fast birds give more points, missed shots cost points, and your magazine reloads automatically.</p>
                    <p>Push past 800 points to unlock the Russian mountain route, then beyond 1500 to reach the tropical island sprint.</p>
                    ${showTutorialComplete ? '<p><strong>Tutorial successfully accomplished.</strong> Now you can run real game or practice again.</p>' : ""}
                    ${buildLevelMapMarkup()}
                    <ul class="tutorial-list">
                        <li class="tutorial-item"><span class="tutorial-title">Controls</span>Click to shoot. Press <strong>R</strong> to restart instantly. Use the <strong>Menu</strong> button or press <strong>Esc</strong> during a round to open the pause menu.</li>
                        <li class="tutorial-item"><span class="tutorial-title">Reload</span>When ammo reaches zero, the shotgun appears on screen. Follow the arrow sequence on your keyboard, or tap the on-screen arrows on mobile, to chamber a new magazine.</li>
                        <li class="tutorial-item"><span class="tutorial-title">Best Targets</span>Blue chickens are the fastest and worth the most points. Cream ones are easiest to hit.</li>
                        <li class="tutorial-item"><span class="tutorial-title">Leaderboard</span>Register with a unique nickname, then your finished rounds can be saved to the ranking table.</li>
                    </ul>
                    <div class="tutorial-actions">
                        <button class="button secondary" type="button" data-action="startTutorial">Start tutorial</button>
                        <button class="button" type="button" data-action="startGame">Enter ${escapeHtml(selectedConfig.mapTitle)}</button>
                        <button class="button secondary" type="button" data-action="openLeaderboard">View Leaderboard</button>
                    </div>
                </div>
                <div>
                    ${getAuthMarkup()}
                    <div id="authFeedback" class="feedback"></div>
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
    overlay.innerHTML = getIntroOverlayMarkup(showTutorialComplete);
    overlay.classList.remove("hidden");
    attachOverlayHandlers();
}

function showLeaderboardOverlay() {
    overlay.innerHTML = `
        <div class="overlay-card">
            <h2>Leaderboard</h2>
            <p>Best score for each registered nickname.</p>
            ${buildLeaderboardMarkup()}
            ${buildAnalyticsMarkup()}
            <div class="button-row button-row-spaced">
                <button class="button secondary" type="button" data-action="showIntro">Back</button>
                ${gameRunning || gamePaused ? '<button class="button" type="button" data-action="openPauseMenu">Game Menu</button>' : '<button class="button" type="button" data-action="startGame">Start Hunt</button>'}
            </div>
        </div>
    `;
    overlay.classList.remove("hidden");
    attachOverlayHandlers();
}

function openPauseMenu() {
    if (!gameRunning && !gamePaused) {
        showIntroOverlay();
        return;
    }

    pauseGame();
    overlay.innerHTML = `
        <div class="overlay-card">
            <h2>Game Menu</h2>
            <p>The round is paused. Choose what you want to do next.</p>
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
    const openLeaderboardButton = overlay.querySelector('[data-action="openLeaderboard"]');
    const logoutButton = overlay.querySelector('[data-action="logout"]');
    const resumeButton = overlay.querySelector('[data-action="resumeGame"]');
    const startButtons = overlay.querySelectorAll('[data-action="startGame"]');
    const tutorialButtons = overlay.querySelectorAll('[data-action="startTutorial"]');
    const restartButtons = overlay.querySelectorAll('[data-action="restartGame"]');
    const endButtons = overlay.querySelectorAll('[data-action="endGame"]');
    const menuButtons = overlay.querySelectorAll('[data-action="openPauseMenu"]');
    const introButtons = overlay.querySelectorAll('[data-action="showIntro"]');
    const levelButtons = overlay.querySelectorAll('[data-action="startLevel"]');

    if (loginForm) {
        loginForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            const response = await postAction("login", new FormData(loginForm));
            showFeedback(response);
            if (response.ok) {
                appState.user = response.user;
                appState.leaderboard = response.leaderboard || appState.leaderboard;
                appState.analytics = response.analytics || null;
                updateHud();
                showIntroOverlay();
            }
        });
    }

    if (registerForm) {
        registerForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            const response = await postAction("register", new FormData(registerForm));
            showFeedback(response);
            if (response.ok) {
                appState.user = response.user;
                appState.leaderboard = response.leaderboard || appState.leaderboard;
                appState.analytics = response.analytics || null;
                updateHud();
                showIntroOverlay();
            }
        });
    }

    openLeaderboardButton?.addEventListener("click", showLeaderboardOverlay);
    resumeButton?.addEventListener("click", resumeGameFromPause);
    startButtons.forEach((button) => button.addEventListener("click", startGame));
    tutorialButtons.forEach((button) => button.addEventListener("click", startTutorialGame));
    restartButtons.forEach((button) => button.addEventListener("click", restartGame));
    endButtons.forEach((button) => button.addEventListener("click", () => endGame(true)));
    menuButtons.forEach((button) => button.addEventListener("click", openPauseMenu));
    introButtons.forEach((button) => button.addEventListener("click", showIntroOverlay));
    levelButtons.forEach((button) => button.addEventListener("click", () => {
        const level = Number(button.dataset.level || 1);
        selectStartLevel(level, { render: false });
        startGame();
    }));

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

function leiBloomMarkup(className, x, y, scale, rotation, colors) {
    const [petalOne, petalTwo, petalThree, petalFour, petalFive, center = "#ffe1f1"] = colors;

    return `
        <g class="lei-bloom ${className}" transform="translate(${x} ${y}) rotate(${rotation}) scale(${scale})">
            <ellipse class="lei-petal" cx="0" cy="-4.9" rx="2.6" ry="5.8" fill="${petalOne}"></ellipse>
            <ellipse class="lei-petal" cx="4.6" cy="-1.4" rx="2.5" ry="5.4" fill="${petalTwo}" transform="rotate(58 4.6 -1.4)"></ellipse>
            <ellipse class="lei-petal" cx="3.1" cy="4.2" rx="2.4" ry="5.1" fill="${petalThree}" transform="rotate(126 3.1 4.2)"></ellipse>
            <ellipse class="lei-petal" cx="-3.1" cy="4.1" rx="2.5" ry="5.2" fill="${petalFour}" transform="rotate(-128 -3.1 4.1)"></ellipse>
            <ellipse class="lei-petal" cx="-4.7" cy="-1.5" rx="2.5" ry="5.4" fill="${petalFive}" transform="rotate(-58 -4.7 -1.5)"></ellipse>
            <circle class="lei-center" cx="0" cy="0" r="1.8" fill="${center}"></circle>
        </g>
    `;
}

function tropicalChickenMarkup() {
    const tropicalLei = `
                <g class="lei">
                    <path class="lei-rope" d="M56 51 C52 69, 67 88, 81 88 C93 88, 101 76, 96 63" fill="none" stroke="#ffd8e9" stroke-width="4.2" stroke-linecap="round"></path>
                    ${[
                        leiBloomMarkup("bloom-one", 56, 51, 0.82, -12, ["#ff5da7", "#ff85be", "#ff4596", "#ff92c5", "#ff6caf"]),
                        leiBloomMarkup("bloom-two", 59, 57, 0.88, -8, ["#ff68ae", "#ff94c7", "#ff539e", "#ff9ed0", "#ff75b6"]),
                        leiBloomMarkup("bloom-three", 61, 63, 0.92, -5, ["#ff5aa5", "#ff8fc3", "#ff4797", "#ff9acf", "#ff6aac"]),
                        leiBloomMarkup("bloom-four", 64, 69, 0.96, -2, ["#ff73b4", "#ffabd5", "#ff61aa", "#ffa1d1", "#ff82bc"]),
                        leiBloomMarkup("bloom-five", 68, 75, 1, 1, ["#ff61aa", "#ff8ec4", "#ff4e9a", "#ff9cce", "#ff73b5"]),
                        leiBloomMarkup("bloom-six", 73, 80, 1.04, 3, ["#ff6db0", "#ff9ecf", "#ff57a3", "#ff8fc3", "#ff7ebb"]),
                        leiBloomMarkup("bloom-seven", 79, 84, 1, 4, ["#ff62ab", "#ff8dc4", "#ff4d99", "#ff97ca", "#ff71b2"]),
                        leiBloomMarkup("bloom-eight", 85, 83, 0.98, 3, ["#ff5ea8", "#ff88c1", "#ff4b98", "#ff95c8", "#ff6cad"]),
                        leiBloomMarkup("bloom-nine", 90, 79, 0.94, 0, ["#ff69ae", "#ff97c9", "#ff53a0", "#ff9fd0", "#ff76b7"]),
                        leiBloomMarkup("bloom-ten", 93, 72, 0.88, -4, ["#ff61aa", "#ff8dc4", "#ff4d9a", "#ff95c8", "#ff71b3"]),
                        leiBloomMarkup("bloom-eleven", 94, 65, 0.84, -8, ["#ff73b5", "#ffa8d4", "#ff61aa", "#ff9fd0", "#ff86bf"])
                    ].join("")}
                </g>
    `;

    return `
        <span class="chicken-sprite">
            <svg viewBox="0 0 120 120" aria-hidden="true">
                <ellipse class="tropical-tail" cx="31" cy="65" rx="23" ry="19"></ellipse>
                <ellipse class="tropical-body" cx="61" cy="73" rx="36" ry="26"></ellipse>
                <ellipse class="tropical-head" cx="87" cy="50" rx="23" ry="19"></ellipse>
                <ellipse class="tropical-neck-shadow" cx="73" cy="60" rx="16" ry="12"></ellipse>
                <ellipse class="tropical-wing" cx="42" cy="70" rx="21" ry="18"></ellipse>
                ${tropicalLei}
                <path class="tropical-comb" d="M71 25 C78 10, 96 10, 105 27"></path>
                <circle class="tropical-eye-white" cx="98" cy="46" r="8.2"></circle>
                <circle class="tropical-eye-pupil" cx="99" cy="46" r="4.8"></circle>
                <polygon class="tropical-beak" points="108,55 121,61 108,67"></polygon>
                <path class="tropical-leg" d="M50 92 L46 114"></path>
                <path class="tropical-leg" d="M64 91 L60 114"></path>
                <path class="tropical-foot" d="M46 114 L39 123 M46 114 L51 122 M46 114 L56 123"></path>
                <path class="tropical-foot" d="M60 114 L53 123 M60 114 L65 122 M60 114 L70 123"></path>
            </svg>
        </span>
    `;
}

function chickenMarkup(bodyColor, wingColor, beakColor) {
    if (currentLevel === 3) {
        return tropicalChickenMarkup();
    }

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
    return `
        <span class="chicken-sprite">
            <svg viewBox="0 0 120 120" aria-hidden="true">
                ${winterHat}
                <ellipse cx="62" cy="68" rx="30" ry="22" fill="${bodyColor}"></ellipse>
                <ellipse cx="88" cy="52" rx="18" ry="15" fill="${bodyColor}"></ellipse>
                <ellipse cx="40" cy="64" rx="16" ry="13" fill="${wingColor}" opacity="0.95"></ellipse>
                <circle cx="95" cy="49" r="3.4" fill="#2b2318"></circle>
                <polygon points="102,55 117,60 102,65" fill="${beakColor}"></polygon>
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

    if (ammo <= 0) {
        reload();
        return;
    }

    ammo -= 1;
    updateHud();

    if (directHit && chicken && chicken.alive) {
        chicken.alive = false;
        hitCount += 1;
        score += chicken.points;
        updateHud();
        setStatus(`Direct hit! +${chicken.points} points`);
        chicken.el.classList.add("hit");
        createEffect(x, y, "score-pop", `+${chicken.points}`);
        if (tutorialMode) {
            advanceTutorialAfterHit();
        }
        setTimeout(() => removeChicken(chicken.id), 280);

        if (maybeAdvanceToNextLevel()) {
            return;
        }
    } else {
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
        localStorage.setItem("chicken-shooting-best", String(bestScore));
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

    overlay.innerHTML = `
        <div class="overlay-card">
            <h2>${endedEarly ? "Game Ended" : "Time Up"}</h2>
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
            <div class="button-row">
                <button class="button" type="button" data-action="restartGame">Play Again</button>
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
    applyLevelTheme();
}

function startGame() {
    tutorialMode = false;
    tutorialStep = 0;
    setTutorialMessage("");
    overlay.classList.add("hidden");
    resetRoundState();
    gameRunning = true;
    updateViewport();
    activateLevel(selectedStartLevel, { showBanner: selectedStartLevel > 1 });
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

updateViewport();
applyLevelTheme();
queueCrosshairRender();
updateHud();
showIntroOverlay();
loadLeaderboard();


