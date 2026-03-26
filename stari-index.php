<?php
declare(strict_types=1);

session_start();

header('X-Frame-Options: SAMEORIGIN');

$dbError = null;
$db = null;

try {
    $db = new PDO('sqlite:' . __DIR__ . DIRECTORY_SEPARATOR . 'chicken_shooting.sqlite');
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $db->exec(
        'CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            nickname TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )'
    );
    $db->exec(
        'CREATE TABLE IF NOT EXISTS scores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            score INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )'
    );
} catch (Throwable $exception) {
    $dbError = $exception->getMessage();
}

function jsonResponse(array $payload, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=UTF-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fetchLeaderboard(?PDO $db, int $limit = 10): array
{
    if (!$db) {
        return [];
    }

    $statement = $db->prepare(
        'SELECT u.nickname, MAX(s.score) AS best_score, COUNT(s.id) AS rounds_played
         FROM scores s
         INNER JOIN users u ON u.id = s.user_id
         GROUP BY s.user_id, u.nickname
         ORDER BY best_score DESC, MIN(s.created_at) ASC
         LIMIT :limit'
    );
    $statement->bindValue(':limit', $limit, PDO::PARAM_INT);
    $statement->execute();

    return $statement->fetchAll() ?: [];
}

function getSessionUser(?PDO $db): ?array
{
    if (!$db || empty($_SESSION['user_id'])) {
        return null;
    }

    $statement = $db->prepare('SELECT id, username, nickname FROM users WHERE id = :id');
    $statement->execute([':id' => (int) $_SESSION['user_id']]);
    $user = $statement->fetch();

    if (!$user) {
        unset($_SESSION['user_id']);
        return null;
    }

    return $user;
}

if (isset($_GET['action'])) {
    $action = (string) $_GET['action'];

    if ($dbError) {
        jsonResponse(['ok' => false, 'message' => 'Database error: ' . $dbError], 500);
    }

    if ($action === 'leaderboard') {
        jsonResponse([
            'ok' => true,
            'leaderboard' => fetchLeaderboard($db),
            'user' => getSessionUser($db),
        ]);
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        jsonResponse(['ok' => false, 'message' => 'Invalid request method.'], 405);
    }

    if ($action === 'register') {
        $username = trim((string) ($_POST['username'] ?? ''));
        $nickname = trim((string) ($_POST['nickname'] ?? ''));
        $password = (string) ($_POST['password'] ?? '');

        if ($username === '' || $nickname === '' || $password === '') {
            jsonResponse(['ok' => false, 'message' => 'Username, nickname and password are required.'], 422);
        }
        if (!preg_match('/^[a-zA-Z0-9_]{3,20}$/', $username)) {
            jsonResponse(['ok' => false, 'message' => 'Username must have 3-20 characters and use only letters, numbers or _.'], 422);
        }
        if (!preg_match('/^[\p{L}\p{N}_\- ]{3,20}$/u', $nickname)) {
            jsonResponse(['ok' => false, 'message' => 'Nickname must have 3-20 characters.'], 422);
        }
        if (mb_strlen($password) < 6) {
            jsonResponse(['ok' => false, 'message' => 'Password must have at least 6 characters.'], 422);
        }

        $usernameCheck = $db->prepare('SELECT id FROM users WHERE username = :username');
        $usernameCheck->execute([':username' => $username]);
        if ($usernameCheck->fetch()) {
            jsonResponse(['ok' => false, 'message' => 'That username is already taken.'], 409);
        }

        $nicknameCheck = $db->prepare('SELECT id FROM users WHERE lower(nickname) = lower(:nickname)');
        $nicknameCheck->execute([':nickname' => $nickname]);
        if ($nicknameCheck->fetch()) {
            jsonResponse(['ok' => false, 'message' => 'That nickname already exists. Choose another one.'], 409);
        }

        $insert = $db->prepare('INSERT INTO users (username, nickname, password_hash) VALUES (:username, :nickname, :password_hash)');
        $insert->execute([
            ':username' => $username,
            ':nickname' => $nickname,
            ':password_hash' => password_hash($password, PASSWORD_DEFAULT),
        ]);

        $_SESSION['user_id'] = (int) $db->lastInsertId();

        jsonResponse([
            'ok' => true,
            'message' => 'Registration successful.',
            'user' => getSessionUser($db),
            'leaderboard' => fetchLeaderboard($db),
        ]);
    }

    if ($action === 'login') {
        $username = trim((string) ($_POST['username'] ?? ''));
        $password = (string) ($_POST['password'] ?? '');
        if ($username === '' || $password === '') {
            jsonResponse(['ok' => false, 'message' => 'Username and password are required.'], 422);
        }

        $statement = $db->prepare('SELECT id, username, nickname, password_hash FROM users WHERE username = :username');
        $statement->execute([':username' => $username]);
        $user = $statement->fetch();

        if (!$user || !password_verify($password, $user['password_hash'])) {
            jsonResponse(['ok' => false, 'message' => 'Wrong username or password.'], 401);
        }

        $_SESSION['user_id'] = (int) $user['id'];

        jsonResponse([
            'ok' => true,
            'message' => 'Login successful.',
            'user' => [
                'id' => (int) $user['id'],
                'username' => $user['username'],
                'nickname' => $user['nickname'],
            ],
            'leaderboard' => fetchLeaderboard($db),
        ]);
    }

    if ($action === 'logout') {
        unset($_SESSION['user_id']);
        jsonResponse(['ok' => true, 'message' => 'Logged out.', 'leaderboard' => fetchLeaderboard($db)]);
    }

    if ($action === 'save_score') {
        $user = getSessionUser($db);
        if (!$user) {
            jsonResponse(['ok' => false, 'message' => 'Log in first to save your score.'], 401);
        }

        $score = filter_input(INPUT_POST, 'score', FILTER_VALIDATE_INT);
        if ($score === false || $score === null || $score < 0) {
            jsonResponse(['ok' => false, 'message' => 'Invalid score.'], 422);
        }

        $insert = $db->prepare('INSERT INTO scores (user_id, score) VALUES (:user_id, :score)');
        $insert->execute([
            ':user_id' => (int) $user['id'],
            ':score' => (int) $score,
        ]);

        jsonResponse([
            'ok' => true,
            'message' => 'Score saved.',
            'leaderboard' => fetchLeaderboard($db),
        ]);
    }

    jsonResponse(['ok' => false, 'message' => 'Unknown action.'], 404);
}

$sessionUser = getSessionUser($db);
$leaderboard = fetchLeaderboard($db);
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Chicken Shooting</title>
    <style>
        :root {
            --sky-top: #86d7ff;
            --sky-bottom: #f5fdff;
            --field-top: #7fd16e;
            --field-bottom: #3e8c3a;
            --panel: rgba(16, 34, 26, 0.8);
            --accent: #ffcb45;
            --danger: #ff735a;
            --text: #fffdf6;
            --shadow: rgba(8, 20, 14, 0.24);
            --muted: rgba(255, 253, 246, 0.8);
        }

        * { box-sizing: border-box; }
        html, body { margin: 0; min-height: 100%; }

        body {
            font-family: "Trebuchet MS", "Segoe UI", sans-serif;
            background:
                radial-gradient(circle at top, rgba(255, 255, 255, 0.75), transparent 38%),
                linear-gradient(180deg, var(--sky-top) 0%, var(--sky-bottom) 52%, var(--field-top) 52%, var(--field-bottom) 100%);
            color: var(--text);
            overflow: hidden;
            cursor: crosshair;
            touch-action: manipulation;
        }

        .game-shell {
            position: relative;
            width: 100vw;
            height: 100vh;
            height: 100dvh;
            overflow: hidden;
            contain: layout paint style;
        }

        .hud {
            position: absolute;
            top: 18px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 20;
            display: grid;
            grid-template-columns: repeat(7, minmax(90px, 1fr));
            gap: 12px;
            width: min(1180px, calc(100vw - 24px));
            pointer-events: none;
        }

        .panel {
            padding: 14px 16px;
            border-radius: 18px;
            background: var(--panel);
            box-shadow: 0 12px 28px var(--shadow);
            border: 1px solid rgba(255, 255, 255, 0.14);
            pointer-events: none;
        }

        .panel-label {
            display: block;
            font-size: 0.75rem;
            text-transform: uppercase;
            letter-spacing: 0.16em;
            opacity: 0.78;
            margin-bottom: 6px;
        }

        .panel-value {
            font-size: clamp(1rem, 1.7vw, 2rem);
            font-weight: 700;
            overflow-wrap: anywhere;
        }

        .game-area { position: absolute; inset: 0; contain: strict; }
        .sun {
            position: absolute;
            top: 52px;
            right: 8vw;
            width: 120px;
            height: 120px;
            border-radius: 50%;
            background: radial-gradient(circle, #fff8c7 0%, #ffd559 58%, rgba(255, 213, 89, 0.18) 72%, transparent 74%);
        }

        .cloud, .cloud::before, .cloud::after {
            background: rgba(255, 255, 255, 0.82);
            border-radius: 999px;
            position: absolute;
            content: "";
        }

        .cloud {
            width: 150px;
            height: 44px;
            top: 15%;
            animation: drift 24s linear infinite;
            will-change: transform;
        }

        .cloud::before { width: 68px; height: 68px; top: -26px; left: 24px; }
        .cloud::after { width: 76px; height: 76px; top: -30px; right: 20px; }
        .cloud.two { top: 25%; width: 170px; left: -240px; animation-duration: 30s; animation-delay: -12s; }
        .cloud.three { top: 10%; width: 120px; left: -200px; animation-duration: 20s; animation-delay: -4s; }

        .ground {
            position: absolute;
            inset: auto 0 0;
            height: 26vh;
            background:
                linear-gradient(180deg, rgba(255, 255, 255, 0.08), transparent 24%),
                repeating-linear-gradient(105deg, rgba(255, 255, 255, 0.1) 0 14px, rgba(0, 0, 0, 0.03) 14px 28px);
            border-top: 3px solid rgba(255, 255, 255, 0.16);
        }

        .instructions {
            position: absolute;
            bottom: 22px;
            left: 22px;
            z-index: 20;
            max-width: 400px;
            padding: 12px 14px;
            border-radius: 16px;
            background: rgba(22, 41, 30, 0.68);
            font-size: 0.95rem;
            line-height: 1.4;
            box-shadow: 0 10px 24px var(--shadow);
            pointer-events: none;
        }

        .overlay {
            position: absolute;
            inset: 0;
            z-index: 25;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            background: rgba(7, 18, 14, 0.5);
        }

        .overlay.hidden { display: none; }

        .overlay-card {
            width: min(1040px, 100%);
            max-height: min(88vh, 920px);
            max-height: min(88dvh, 920px);
            overflow: auto;
            padding: 28px;
            border-radius: 24px;
            background: rgba(11, 25, 19, 0.92);
            border: 1px solid rgba(255, 255, 255, 0.14);
            box-shadow: 0 18px 40px var(--shadow);
        }

        .overlay-card h1, .overlay-card h2, .overlay-card h3 { margin-top: 0; }
        .overlay-card p { color: var(--muted); line-height: 1.55; }

        .overlay-grid {
            display: grid;
            grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.8fr);
            gap: 22px;
            align-items: start;
        }

        .card-section {
            padding: 18px;
            border-radius: 18px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.08);
        }

        .tutorial-list, .leaderboard-list, .menu-list {
            margin: 0;
            padding: 0;
            list-style: none;
            display: grid;
            gap: 10px;
        }

        .tutorial-item, .menu-list li, .leaderboard-row {
            padding: 12px 14px;
            border-radius: 16px;
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid rgba(255, 255, 255, 0.08);
        }

        .tutorial-title, .leaderboard-rank {
            display: block;
            margin-bottom: 4px;
            font-weight: 700;
            color: #fff7cb;
        }

        .tutorial-actions, .button-row {
            display: flex;
            justify-content: center;
            gap: 12px;
            flex-wrap: wrap;
        }

        .button {
            border: 0;
            border-radius: 999px;
            padding: 14px 24px;
            font-size: 1rem;
            font-weight: 700;
            color: #1c1a10;
            background: linear-gradient(180deg, #ffe388, var(--accent));
            box-shadow: 0 10px 22px rgba(255, 203, 69, 0.3);
            cursor: pointer;
            transition: transform 0.2s ease, box-shadow 0.2s ease;
            min-height: 52px;
        }

        .button:hover { transform: translateY(-2px); box-shadow: 0 14px 28px rgba(255, 203, 69, 0.36); }
        .button.secondary {
            color: var(--text);
            background: rgba(255, 255, 255, 0.08);
            box-shadow: none;
            border: 1px solid rgba(255, 255, 255, 0.14);
        }
        .button.secondary:hover { box-shadow: none; }
        .hud-button {
            width: 100%;
            height: 100%;
            min-height: 76px;
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: auto;
        }
        .menu-button {
            color: rgba(5, 16, 44, 0.34) !important;
            background: linear-gradient(180deg, rgba(21, 45, 80, 0.96) 0%, rgba(8, 19, 39, 0.98) 100%);
            border: 1px solid rgba(180, 214, 255, 0.18);
            box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06), 0 10px 22px rgba(5, 16, 44, 0.34);
        }
        .menu-button:hover {
            color: #1c1a10;
            box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12), 0 14px 28px rgba(5, 16, 44, 0.42);
        }
        .restart-button {
            color: #1c1a10 !important;
            background: linear-gradient(180deg, #ffe388, var(--accent));
            box-shadow: inset 0 0 0 1px rgba(255, 248, 214, 0.42), 0 10px 22px rgba(255, 203, 69, 0.3);
            border: 1px solid rgba(255, 241, 178, 0.55);
        }
        .restart-button:hover {
            color: #fff5f1;
            box-shadow: inset 0 0 0 1px rgba(230, 244, 255, 0.34), 0 14px 28px rgba(5, 16, 44, 0.5);
            background:
                linear-gradient(135deg, rgba(191, 229, 255, 1) 0 8%, transparent 8% 100%),
                linear-gradient(215deg, transparent 0 38%, rgba(148, 211, 255, 0.98) 38% 45%, transparent 45% 100%),
                linear-gradient(145deg, transparent 0 56%, rgba(224, 243, 255, 0.98) 56% 62%, transparent 62% 100%),
                linear-gradient(180deg, #1b468f 0%, #0d255c 55%, #081738 100%);
        }
        .danger-button {
            color: #fff5f1;
            background: linear-gradient(180deg, #ff9988 0%, #e44f39 100%);
            box-shadow: 0 10px 22px rgba(228, 79, 57, 0.28);
        }
        .auth-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
        .field-group { display: grid; gap: 8px; margin-bottom: 12px; }
        .field-group label { font-size: 0.9rem; color: var(--muted); }
        .field-group input {
            width: 100%;
            border: 1px solid rgba(255, 255, 255, 0.12);
            background: rgba(255, 255, 255, 0.08);
            color: var(--text);
            border-radius: 14px;
            padding: 12px 14px;
            font: inherit;
        }
        .field-group input:focus { outline: 2px solid rgba(255, 203, 69, 0.55); outline-offset: 2px; }
        .auth-note, .muted { color: var(--muted); font-size: 0.92rem; }
        .feedback { min-height: 24px; margin: 6px 0 0; font-weight: 700; color: #fff7cb; }
        .feedback.error { color: #ff8f7e; }
        .feedback.success { color: #b8f3bb; }
        .leaderboard-row {
            display: grid;
            grid-template-columns: auto 1fr auto auto;
            gap: 10px;
            align-items: center;
        }
        .leaderboard-name { font-weight: 700; }
        .leaderboard-score { color: #fff7cb; font-weight: 700; }
        .empty-state {
            padding: 14px;
            border-radius: 16px;
            background: rgba(255, 255, 255, 0.06);
            border: 1px dashed rgba(255, 255, 255, 0.12);
            color: var(--muted);
        }
        .crosshair {
            position: absolute;
            width: 38px;
            height: 38px;
            border: 2px solid rgba(255, 255, 255, 0.92);
            border-radius: 50%;
            pointer-events: none;
            z-index: 30;
            box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.18);
            transform: translate3d(-50%, -50%, 0);
            will-change: transform;
        }
        .crosshair::before, .crosshair::after {
            content: "";
            position: absolute;
            background: rgba(255, 255, 255, 0.92);
        }
        .crosshair::before {
            width: 2px;
            height: 46px;
            left: 50%;
            top: 50%;
            transform: translate3d(-50%, -50%, 0);
        }
        .crosshair::after {
            width: 46px;
            height: 2px;
            left: 50%;
            top: 50%;
            transform: translate3d(-50%, -50%, 0);
        }
        .chicken {
            position: absolute;
            top: 0;
            left: 0;
            width: 88px;
            height: 88px;
            padding: 0;
            border: 0;
            background: transparent;
            user-select: none;
            transform: translate3d(0, 0, 0);
            transform-origin: center;
            will-change: transform, opacity;
            contain: layout paint style;
            -webkit-tap-highlight-color: transparent;
        }
        .chicken-sprite {
            width: 100%;
            height: 100%;
            transform-origin: center;
            animation: flap 0.45s ease-in-out infinite alternate;
        }
        .chicken svg { width: 100%; height: 100%; overflow: visible; pointer-events: none; }
        .chicken.hit { animation: pop 0.32s ease forwards; }
        .muzzle-flash, .score-pop {
            position: absolute;
            pointer-events: none;
            z-index: 18;
            will-change: transform, opacity;
        }
        .muzzle-flash {
            width: 24px;
            height: 24px;
            border-radius: 50%;
            background: radial-gradient(circle, rgba(255, 255, 255, 0.96) 0%, rgba(255, 200, 74, 0.85) 45%, transparent 70%);
            transform: translate3d(-50%, -50%, 0);
            animation: fade-shot 0.28s ease forwards;
        }
        .score-pop {
            transform: translate3d(-50%, -50%, 0);
            color: #fff5b1;
            font-size: 1.2rem;
            font-weight: 700;
            text-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
            animation: float-score 0.7s ease forwards;
        }
        .warning { color: var(--danger); }
        .db-warning {
            position: absolute;
            right: 20px;
            bottom: 20px;
            z-index: 22;
            max-width: 380px;
            padding: 12px 14px;
            border-radius: 14px;
            color: #ffe7e1;
            background: rgba(112, 30, 16, 0.86);
            border: 1px solid rgba(255, 180, 160, 0.3);
        }
        .sun,
        .cloud,
        .ground {
            pointer-events: none;
        }
        @keyframes flap { from { transform: rotate(-5deg) scale(1); } to { transform: rotate(5deg) scale(1.04); } }
        @keyframes drift { from { transform: translate3d(-220px, 0, 0); } to { transform: translate3d(calc(100vw + 280px), 0, 0); } }
        @keyframes pop { 0% { opacity: 1; transform: translate3d(0, 0, 0) scale(1) rotate(0deg); } 100% { opacity: 0; transform: translate3d(0, 0, 0) scale(0.35) rotate(26deg); } }
        @keyframes fade-shot { from { opacity: 1; transform: translate3d(-50%, -50%, 0) scale(0.4); } to { opacity: 0; transform: translate3d(-50%, -50%, 0) scale(2); } }
        @keyframes float-score { from { opacity: 1; transform: translate3d(-50%, -50%, 0) translateY(0); } to { opacity: 0; transform: translate3d(-50%, -50%, 0) translateY(-42px); } }
        @media (max-width: 900px) {
            .hud {
                grid-template-columns: repeat(4, minmax(0, 1fr));
                width: min(860px, calc(100vw - 20px));
                gap: 10px;
            }
            .overlay-grid, .auth-grid { grid-template-columns: 1fr; }
            .overlay-card { padding: 22px; }
        }
        @media (max-width: 700px) {
            body { cursor: default; }
            .hud {
                grid-template-columns: repeat(4, minmax(56px, 64px));
                justify-content: start;
                left: 8px;
                transform: none;
                top: 8px;
                width: auto;
                max-width: calc(100vw - 16px);
                gap: 6px;
            }
            .panel {
                min-height: 64px;
                padding: 6px;
                border-radius: 14px;
                aspect-ratio: 1 / 1;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                text-align: center;
            }
            .panel-label {
                font-size: 0.56rem;
                letter-spacing: 0.08em;
                margin-bottom: 3px;
                line-height: 1.05;
            }
            .panel-value {
                font-size: 0.88rem;
                line-height: 1.05;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 100%;
            }
            .hud-button {
                min-height: 64px;
                width: 64px;
                padding: 6px;
                border-radius: 14px;
                aspect-ratio: 1 / 1;
                font-size: 0.72rem;
                line-height: 1.05;
                text-align: center;
            }
            .overlay {
                align-items: flex-start;
                padding: 10px;
            }
            .overlay-card {
                width: 100%;
                max-height: calc(100dvh - 20px);
                padding: 16px;
                border-radius: 18px;
            }
            .card-section,
            .tutorial-item,
            .menu-list li,
            .leaderboard-row {
                padding: 12px;
                border-radius: 14px;
            }
            .button-row,
            .tutorial-actions {
                flex-direction: column;
                align-items: stretch;
            }
            .button,
            .button.secondary,
            .danger-button {
                width: 100%;
            }
            .instructions {
                left: 50%;
                transform: translateX(-50%);
                bottom: 8px;
                width: max-content;
                max-width: calc(100vw - 16px);
                font-size: 0.76rem;
                line-height: 1.35;
                padding: 8px 10px;
                text-align: center;
                border-radius: 12px;
            }
            .chicken { width: 68px; height: 68px; }
            .sun { width: 78px; height: 78px; top: 96px; right: 16px; }
            .cloud { transform: scale(0.85); transform-origin: left top; }
            .leaderboard-row {
                grid-template-columns: auto 1fr;
                gap: 6px 10px;
            }
            .leaderboard-score,
            .leaderboard-row .muted {
                grid-column: 2;
            }
            .crosshair {
                display: none;
            }
        }

        @media (max-width: 420px) {
            .hud {
                grid-template-columns: repeat(4, minmax(50px, 56px));
                gap: 5px;
            }
            .panel { min-height: 56px; }
            .hud-button { width: 56px; min-height: 56px; font-size: 0.66rem; }
            .panel-label { font-size: 0.5rem; }
            .panel-value { font-size: 0.78rem; }
            .instructions {
                font-size: 0.72rem;
            }
            .overlay-card h1 {
                font-size: 1.8rem;
            }
            .overlay-card h2 {
                font-size: 1.45rem;
            }
        }
    </style>
</head>
<body>
    <div class="game-shell">
        <div class="hud">
            <div class="panel"><span class="panel-label">Score</span><span class="panel-value" id="score">0</span></div>
            <div class="panel"><span class="panel-label">Time Left</span><span class="panel-value" id="time">45</span></div>
            <div class="panel"><span class="panel-label">Ammo</span><span class="panel-value" id="ammo">6 / 6</span></div>
            <div class="panel"><span class="panel-label">Best</span><span class="panel-value" id="best">0</span></div>
            <div class="panel"><span class="panel-label">Player</span><span class="panel-value" id="playerName"><?= htmlspecialchars($sessionUser['nickname'] ?? 'Guest', ENT_QUOTES, 'UTF-8') ?></span></div>
            <button class="button secondary hud-button menu-button" id="menuControl" type="button">Menu</button>
            <button class="button secondary hud-button restart-button" id="restartControl" type="button">Restart</button>
        </div>

        <div class="sun"></div>
        <div class="cloud one"></div>
        <div class="cloud two"></div>
        <div class="cloud three"></div>
        <div class="game-area" id="gameArea" aria-label="Chicken shooting game area"></div>
        <div class="ground"></div>
        <div class="instructions" id="statusText">Click chickens before the timer ends. Use Menu or Esc for the game menu, R to restart instantly, and log in to save your scores on the leaderboard.</div>
        <div class="overlay" id="overlay"></div>
        <div class="crosshair" id="crosshair"></div>
        <?php if ($dbError): ?>
            <div class="db-warning">Database error detected. Login, register and leaderboard are disabled until SQLite works again.</div>
        <?php endif; ?>
    </div>
    <script>
        const appState = {
            dbAvailable: <?= $dbError ? 'false' : 'true' ?>,
            user: <?= json_encode($sessionUser, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?>,
            leaderboard: <?= json_encode($leaderboard, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?>,
            dbError: <?= json_encode($dbError, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?>
        };

        const gameArea = document.getElementById("gameArea");
        const hud = document.querySelector(".hud");
        const scoreEl = document.getElementById("score");
        const timeEl = document.getElementById("time");
        const ammoEl = document.getElementById("ammo");
        const bestEl = document.getElementById("best");
        const overlay = document.getElementById("overlay");
        const statusText = document.getElementById("statusText");
        const crosshair = document.getElementById("crosshair");
        const menuControl = document.getElementById("menuControl");
        const restartControl = document.getElementById("restartControl");
        const playerNameEl = document.getElementById("playerName");

        const totalTime = 45;
        const magSize = 6;
        const spawnLimit = 8;
        const spawnEveryMs = 900;
        const chickens = new Map();
        const chickenTypes = [
            { label: "Cream Chicken", colors: ["#fff7e8", "#f4e0bb", "#ef9b29"], speedMin: 140, speedMax: 190, pointsMin: 22, pointsMax: 30 },
            { label: "Golden Chicken", colors: ["#ffe3a6", "#ffc54d", "#ea7f1c"], speedMin: 185, speedMax: 235, pointsMin: 30, pointsMax: 38 },
            { label: "Rose Chicken", colors: ["#f2a49b", "#e88374", "#f3b74e"], speedMin: 230, speedMax: 280, pointsMin: 38, pointsMax: 46 },
            { label: "Blue Chicken", colors: ["#d9eef9", "#afdae9", "#ef9b29"], speedMin: 275, speedMax: 340, pointsMin: 46, pointsMax: 56 }
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
        let bestScore = Number(localStorage.getItem("chicken-shooting-best") || 0);
        let gameRunning = false;
        let gamePaused = false;
        let reloadTimeout = null;
        let rafId = null;
        let chickenId = 0;
        let lastFrameTime = 0;
        let spawnAccumulator = 0;
        let secondAccumulator = 0;
        let pointerX = window.innerWidth / 2;
        let pointerY = window.innerHeight / 2;
        let crosshairQueued = false;

        bestEl.textContent = bestScore;
        playerNameEl.textContent = appState.user?.nickname || "Guest";

        function escapeHtml(value) {
            return String(value)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
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
            ammoEl.classList.toggle("warning", ammo <= 1);
            bestEl.textContent = bestScore;
            playerNameEl.textContent = appState.user?.nickname || "Guest";
        }

        function setStatus(message) {
            statusText.textContent = message;
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
                            <span class="muted">${entry.rounds_played} rounds</span>
                        </div>
                    `).join("")}
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
                const response = await fetch(`?action=${encodeURIComponent(action)}`, { method: "POST", body: formData });
                return await response.json();
            } catch (error) {
                return { ok: false, message: "Request failed. Please try again." };
            }
        }

        async function loadLeaderboard() {
            if (!appState.dbAvailable) {
                return;
            }
            try {
                const response = await fetch("?action=leaderboard");
                const data = await response.json();
                if (data.ok) {
                    appState.leaderboard = data.leaderboard || [];
                    appState.user = data.user || appState.user;
                    updateHud();
                }
            } catch (error) {
                setStatus("Could not refresh leaderboard right now.");
            }
        }

        function getIntroOverlayMarkup() {
            return `
                <div class="overlay-card">
                    <div class="overlay-grid">
                        <div class="card-section">
                            <h1>Chicken Shooting</h1>
                            <p>Hunt runaway chickens for 45 seconds. Fast birds give more points, missed shots cost points, and your magazine reloads automatically.</p>
                            <ul class="tutorial-list">
                                <li class="tutorial-item"><span class="tutorial-title">Controls</span>Click to shoot. Press <strong>R</strong> to restart instantly. Use the <strong>Menu</strong> button or press <strong>Esc</strong> during a round to open the pause menu.</li>
                                <li class="tutorial-item"><span class="tutorial-title">Best Targets</span>Blue chickens are the fastest and worth the most points. Cream ones are easiest to hit.</li>
                                <li class="tutorial-item"><span class="tutorial-title">Leaderboard</span>Register with a unique nickname, then your finished rounds can be saved to the ranking table.</li>
                            </ul>
                            <div class="tutorial-actions">
                                <button class="button" type="button" data-action="startGame">Start Hunt</button>
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

        function showIntroOverlay() {
            overlay.innerHTML = getIntroOverlayMarkup();
            overlay.classList.remove("hidden");
            attachOverlayHandlers();
        }

        function showLeaderboardOverlay() {
            overlay.innerHTML = `
                <div class="overlay-card">
                    <h2>Leaderboard</h2>
                    <p>Best score for each registered nickname.</p>
                    ${buildLeaderboardMarkup()}
                    <div class="button-row" style="margin-top:18px;">
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
                        <li>Current score: <strong>${score}</strong></li>
                        <li>Time left: <strong>${timeLeft}</strong> seconds</li>
                        <li>Logged in as: <strong>${escapeHtml(appState.user?.nickname || "Guest")}</strong></li>
                    </ul>
                    <div class="button-row" style="margin-top:18px;">
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
            const restartButtons = overlay.querySelectorAll('[data-action="restartGame"]');
            const endButtons = overlay.querySelectorAll('[data-action="endGame"]');
            const menuButtons = overlay.querySelectorAll('[data-action="openPauseMenu"]');
            const introButtons = overlay.querySelectorAll('[data-action="showIntro"]');

            if (loginForm) {
                loginForm.addEventListener("submit", async (event) => {
                    event.preventDefault();
                    const response = await postAction("login", new FormData(loginForm));
                    showFeedback(response);
                    if (response.ok) {
                        appState.user = response.user;
                        appState.leaderboard = response.leaderboard || appState.leaderboard;
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
                        updateHud();
                        showIntroOverlay();
                    }
                });
            }

            openLeaderboardButton?.addEventListener("click", showLeaderboardOverlay);
            resumeButton?.addEventListener("click", resumeGameFromPause);
            startButtons.forEach((button) => button.addEventListener("click", startGame));
            restartButtons.forEach((button) => button.addEventListener("click", restartGame));
            endButtons.forEach((button) => button.addEventListener("click", () => endGame(true)));
            menuButtons.forEach((button) => button.addEventListener("click", openPauseMenu));
            introButtons.forEach((button) => button.addEventListener("click", showIntroOverlay));

            if (logoutButton) {
                logoutButton.addEventListener("click", async () => {
                    const response = await postAction("logout", new FormData());
                    showFeedback(response);
                    if (response.ok) {
                        appState.user = null;
                        appState.leaderboard = response.leaderboard || [];
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

        function chickenMarkup(bodyColor, wingColor, beakColor) {
            return `
                <span class="chicken-sprite">
                    <svg viewBox="0 0 120 120" aria-hidden="true">
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

        function spawnChicken() {
            if (!gameRunning || gamePaused || chickens.size >= spawnLimit) {
                return;
            }

            const size = Math.random() * 26 + 66;
            const upperBound = Math.max(80, viewport.height - viewport.bottomInset - size);
            const minY = Math.min(Math.max(56, viewport.topInset), Math.max(40, upperBound - 40));
            const maxY = Math.max(minY, upperBound);
            const y = minY + Math.random() * Math.max(0, maxY - minY);
            const direction = Math.random() > 0.5 ? 1 : -1;
            const type = getRandomChickenType();
            const speed = type.speedMin + Math.random() * (type.speedMax - type.speedMin);
            const startX = direction === 1 ? -size - 30 : viewport.width + 30;
            const [body, wing, beak] = type.colors;

            const chicken = document.createElement("button");
            chicken.type = "button";
            chicken.className = "chicken";
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
                points: Math.round(type.pointsMin + ((speed - type.speedMin) / (type.speedMax - type.speedMin || 1)) * (type.pointsMax - type.pointsMin))
            };

            chicken.addEventListener("click", (event) => {
                event.stopPropagation();
                shootAt(event.clientX, event.clientY, data, true);
            });

            chickens.set(id, data);
            gameArea.appendChild(chicken);
            renderChicken(data);
        }

        function removeChicken(id) {
            const chicken = chickens.get(id);
            if (!chicken) {
                return;
            }
            chicken.el.remove();
            chickens.delete(id);
        }

        function reload() {
            if (!gameRunning || gamePaused || reloadTimeout) {
                return;
            }
            setStatus("Reloading...");
            reloadTimeout = setTimeout(() => {
                if (!gameRunning) {
                    return;
                }
                ammo = magSize;
                reloadTimeout = null;
                updateHud();
                setStatus("Reloaded. Keep shooting.");
            }, 1200);
        }

        function shootAt(clientX, clientY, chicken = null, directHit = false) {
            if (!gameRunning || gamePaused) {
                return;
            }

            const rect = gameArea.getBoundingClientRect();
            const x = clientX - rect.left;
            const y = clientY - rect.top;
            createEffect(x, y, "muzzle-flash");

            if (reloadTimeout) {
                setStatus("Magazine empty. Wait for reload.");
                return;
            }
            if (ammo <= 0) {
                reload();
                return;
            }

            ammo -= 1;
            updateHud();

            if (directHit && chicken && chicken.alive) {
                chicken.alive = false;
                score += chicken.points;
                updateHud();
                setStatus(`Direct hit! +${chicken.points} points`);
                chicken.el.classList.add("hit");
                createEffect(x, y, "score-pop", `+${chicken.points}`);
                setTimeout(() => removeChicken(chicken.id), 280);
            } else {
                score = Math.max(0, score - 2);
                updateHud();
                setStatus("Missed shot. The chickens are getting away.");
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

            if (spawnAccumulator >= spawnEveryMs) {
                spawnAccumulator -= spawnEveryMs;
                spawnChicken();
            }

            if (secondAccumulator >= 1000) {
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
            const response = await postAction("save_score", formData);
            if (response.ok && response.leaderboard) {
                appState.leaderboard = response.leaderboard;
            } else if (!response.ok) {
                setStatus(response.message || "Could not save score.");
            }
        }

        async function endGame(endedEarly = false) {
            const finalScore = score;
            gameRunning = false;
            gamePaused = false;
            clearTimeout(reloadTimeout);
            cancelAnimationFrame(rafId);
            reloadTimeout = null;
            rafId = null;
            lastFrameTime = 0;
            spawnAccumulator = 0;
            secondAccumulator = 0;

            if (finalScore > bestScore) {
                bestScore = finalScore;
                localStorage.setItem("chicken-shooting-best", String(bestScore));
            }

            chickens.forEach((chicken) => chicken.el.remove());
            chickens.clear();
            updateHud();
            await saveScoreIfLoggedIn();

            overlay.innerHTML = `
                <div class="overlay-card">
                    <h2>${endedEarly ? "Game Ended" : "Time Up"}</h2>
                    <p>You scored <strong>${finalScore}</strong> points. Best local score: <strong>${bestScore}</strong>. ${appState.user ? "Your round was saved to the leaderboard." : "Log in to save future rounds to the leaderboard."}</p>
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
            rafId = null;
            chickens.forEach((chicken) => chicken.el.remove());
            chickens.clear();
            score = 0;
            timeLeft = totalTime;
            ammo = magSize;
            chickenId = 0;
            lastFrameTime = 0;
            spawnAccumulator = 0;
            secondAccumulator = 0;
            gamePaused = false;
        }

        function startGame() {
            overlay.classList.add("hidden");
            resetRoundState();
            gameRunning = true;
            updateViewport();
            updateHud();
            setStatus("Round started. Aim for the quick birds.");

            for (let i = 0; i < 4; i += 1) {
                spawnChicken();
            }

            rafId = requestAnimationFrame(animateChickens);
        }

        function restartGame() {
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
        queueCrosshairRender();
        updateHud();
        showIntroOverlay();
        loadLeaderboard();
    </script>
</body>
</html>
    </style>
</head>
