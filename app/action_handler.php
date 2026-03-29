<?php
declare(strict_types=1);

function handleActionRequest(?PDO $db, ?string $dbError): void
{
    if (!isset($_GET['action'])) {
        return;
    }

    $action = (string) $_GET['action'];

    if ($dbError !== null) {
        jsonResponse(['ok' => false, 'message' => 'Database error: ' . $dbError], 500);
    }

    $database = requireDatabase($db);

    if ($action === 'leaderboard') {
        $user = getSessionUser($database);
        jsonResponse(buildAppPayload($database, $user));
    }

    ensurePostRequest();

    switch ($action) {
        case 'register':
            handleRegisterAction($database);
            break;
        case 'login':
            handleLoginAction($database);
            break;
        case 'logout':
            handleLogoutAction($database);
            break;
        case 'save_score':
            handleSaveScoreAction($database);
            break;
        default:
            jsonResponse(['ok' => false, 'message' => 'Unknown action.'], 404);
    }
}

function requireDatabase(?PDO $db): PDO
{
    if ($db === null) {
        jsonResponse(['ok' => false, 'message' => 'Database is not available.'], 500);
    }

    return $db;
}

function ensurePostRequest(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        jsonResponse(['ok' => false, 'message' => 'Invalid request method.'], 405);
    }
}

function buildAppPayload(PDO $db, ?array $user): array
{
    return [
        'ok' => true,
        'user' => $user,
        'leaderboard' => fetchLeaderboard($db),
        'analytics' => fetchPlayerAnalytics($db, $user),
    ];
}

function publicUserData(array $user): array
{
    return [
        'id' => (int) $user['id'],
        'username' => (string) $user['username'],
        'nickname' => (string) $user['nickname'],
    ];
}

function readValidatedInt(string $name, string $message, int $min = 0, ?int $max = null): int
{
    $value = filter_input(INPUT_POST, $name, FILTER_VALIDATE_INT);

    if ($value === false || $value === null || $value < $min) {
        jsonResponse(['ok' => false, 'message' => $message], 422);
    }

    if ($max !== null && $value > $max) {
        jsonResponse(['ok' => false, 'message' => $message], 422);
    }

    return (int) $value;
}

function handleRegisterAction(PDO $db): never
{
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
    $response = buildAppPayload($db, getSessionUser($db));
    $response['message'] = 'Registration successful.';

    jsonResponse($response);
}

function handleLoginAction(PDO $db): never
{
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
    $publicUser = publicUserData($user);
    $response = buildAppPayload($db, $publicUser);
    $response['message'] = 'Login successful.';

    jsonResponse($response);
}

function handleLogoutAction(PDO $db): never
{
    unset($_SESSION['user_id']);

    $response = buildAppPayload($db, null);
    $response['message'] = 'Logged out.';

    jsonResponse($response);
}

function handleSaveScoreAction(PDO $db): never
{
    $user = getSessionUser($db);
    if (!$user) {
        jsonResponse(['ok' => false, 'message' => 'Log in first to save your score.'], 401);
    }

    $score = readValidatedInt('score', 'Invalid score.');
    $clicks = readValidatedInt('clicks', 'Invalid clicks value.');
    $hits = readValidatedInt('hits', 'Invalid hits value.', 0, $clicks);

    $insert = $db->prepare('INSERT INTO scores (user_id, score, clicks, hits) VALUES (:user_id, :score, :clicks, :hits)');
    $insert->execute([
        ':user_id' => (int) $user['id'],
        ':score' => $score,
        ':clicks' => $clicks,
        ':hits' => $hits,
    ]);

    $response = buildAppPayload($db, $user);
    $response['message'] = 'Score saved.';

    jsonResponse($response);
}


