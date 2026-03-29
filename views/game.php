<?php
declare(strict_types=1);

$initialAppState = [
    'dbAvailable' => $dbError === null,
    'user' => $sessionUser,
    'leaderboard' => $leaderboard,
    'analytics' => $playerAnalytics,
    'dbError' => $dbError === null ? null : 'Database is temporarily unavailable.',
];
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Chicken Shooting</title>
    <link rel="stylesheet" href="assets/css/app.css">
</head>
<body data-app-state="<?= escapeHtml(encodeJson($initialAppState)) ?>" data-csrf-token="<?= escapeHtml(getCsrfToken()) ?>">
    <div class="game-shell">
        <div class="hud">
            <div class="panel"><span class="panel-label">Score</span><span class="panel-value" id="score">0</span></div>
            <div class="panel"><span class="panel-label">Time Left</span><span class="panel-value" id="time">45</span></div>
            <div class="panel"><span class="panel-label">Ammo</span><span class="panel-value" id="ammo">6 / 6</span></div>
            <div class="panel"><span class="panel-label">Clicks</span><span class="panel-value" id="clickCount">0</span></div>
            <div class="panel"><span class="panel-label">Hits</span><span class="panel-value" id="hits">0</span></div>
            <div class="panel"><span class="panel-label">Accuracy</span><span class="panel-value" id="accuracy">0.0%</span></div>
            <div class="panel"><span class="panel-label">PPS</span><span class="panel-value" id="pointsPerShot">0.00</span></div>
            <div class="panel"><span class="panel-label">Best</span><span class="panel-value" id="best">0</span></div>
            <div class="panel"><span class="panel-label">Player</span><span class="panel-value" id="playerName"><?= escapeHtml($sessionUser['nickname'] ?? 'Guest') ?></span></div>
            <button class="button secondary hud-button menu-button" id="menuControl" type="button">Menu</button>
            <button class="button secondary hud-button restart-button" id="restartControl" type="button">Restart</button>
        </div>

        <div class="sun"></div>
        <div class="cloud one"></div>
        <div class="cloud two"></div>
        <div class="cloud three"></div>
        <div class="mountain-scene" aria-hidden="true">
            <div class="mountain-range mountain-far"></div>
            <div class="mountain-range mountain-mid"></div>
            <div class="mountain-range mountain-near"></div>
            <div class="pine-line"></div>
            <div class="snowfall">
                <span class="snowflake"></span>
                <span class="snowflake"></span>
                <span class="snowflake"></span>
                <span class="snowflake"></span>
                <span class="snowflake"></span>
                <span class="snowflake"></span>
                <span class="snowflake"></span>
                <span class="snowflake"></span>
                <span class="snowflake"></span>
                <span class="snowflake"></span>
            </div>
        </div>
        <div class="tropical-scene" aria-hidden="true">
            <div class="sea-horizon"></div>
            <div class="island island-back"></div>
            <div class="island island-front"></div>
            <div class="lagoon-shine"></div>
            <div class="palm palm-left"></div>
            <div class="palm palm-right"></div>
            <div class="wave wave-one"></div>
            <div class="wave wave-two"></div>
            <div class="wave wave-three"></div>
        </div>
        <div class="game-area" id="gameArea" aria-label="Chicken shooting game area"></div>
        <div class="ground"></div>
        <div class="level-banner hidden" id="levelBanner" aria-live="polite"></div>
        <div class="tutorial-banner hidden" id="tutorialBanner" aria-live="polite">
            <span class="tutorial-banner-title">Tutorial</span>
            <p class="tutorial-banner-copy" id="tutorialText">Prati uputstvo i pogodi oznacenu kokosku.</p>
        </div>
        <div class="instructions" id="statusText">Click chickens before the timer ends. Use Menu or Esc for the game menu, R to restart instantly, and when ammo hits 0 use the arrow reload prompt to chamber the shotgun.</div>
        <div class="reload-overlay hidden" id="reloadOverlay" aria-live="polite"></div>
        <div class="overlay" id="overlay"></div>
        <div class="crosshair" id="crosshair"></div>
        <?php if ($dbError): ?>
            <div class="db-warning">Database error detected. Login, register and leaderboard are disabled until SQLite works again.</div>
        <?php endif; ?>
    </div>
    <script src="assets/js/app.js"></script>
</body>
</html>

