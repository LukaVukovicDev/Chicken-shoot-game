<?php
declare(strict_types=1);

function handleActionRequest(?PDO $db, ?string $dbError): void
{
    if (!isset($_GET['action'])) {
        return;
    }

    $action = readRequestedAction();

    ensureAjaxRequest();

    if (!isPublicAction($action)) {
        ensurePostRequest();
        validateSameOriginRequest();
        requireValidCsrfToken();
    }

    if ($dbError !== null) {
        logSecurityEvent('request_rejected_database_unavailable', [
            'action' => $action,
            'ip' => getClientIpAddress(),
            'database_error' => $dbError,
        ]);
        jsonResponse(['ok' => false, 'message' => 'Service is temporarily unavailable.'], 503);
    }

    $database = requireDatabase($db);

    if ($action === 'leaderboard') {
        $user = getSessionUser($database);
        jsonResponse(buildAppPayload($database, $user));
    }

    if ($action === 'routes') {
        jsonResponse([
            'ok' => true,
            'routes' => fetchRoutes($database),
            'csrfToken' => getCsrfToken(),
        ]);
    }

    dispatchProtectedAction($action, $database);
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

function readRequestedAction(): string
{
    $action = trim((string) ($_GET['action'] ?? ''));

    if ($action === '' || !preg_match('/^[a-z_]{3,32}$/', $action)) {
        logSecurityEvent('request_rejected_invalid_action', [
            'action' => $action,
            'ip' => getClientIpAddress(),
        ]);
        jsonResponse(['ok' => false, 'message' => 'Invalid action.'], 400);
    }

    return $action;
}

function isPublicAction(string $action): bool
{
    return in_array($action, ['leaderboard', 'routes'], true);
}

function dispatchProtectedAction(string $action, PDO $db): never
{
    $handlers = [
        'register' => 'handleRegisterAction',
        'login' => 'handleLoginAction',
        'logout' => 'handleLogoutAction',
        'update_profile' => 'handleUpdateProfileAction',
        'change_password' => 'handleChangePasswordAction',
        'save_score' => 'handleSaveScoreAction',
    ];

    $handler = $handlers[$action] ?? null;

    if ($handler === null) {
        logSecurityEvent('request_rejected_unknown_action', [
            'action' => $action,
            'ip' => getClientIpAddress(),
        ]);
        jsonResponse(['ok' => false, 'message' => 'Unknown action.'], 404);
    }

    $handler($db);
}

function buildAppPayload(PDO $db, ?array $user): array
{
    return [
        'ok' => true,
        'user' => $user,
        'leaderboard' => fetchLeaderboard($db),
        'analytics' => fetchPlayerAnalytics($db, $user),
        'csrfToken' => getCsrfToken(),
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

    rotateSessionSecurity();
    $_SESSION['user_id'] = (int) $db->lastInsertId();
    logSecurityEvent('user_registered', [
        'user_id' => $_SESSION['user_id'],
        'username' => $username,
        'ip' => getClientIpAddress(),
    ]);
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

    ensureLoginAllowed($db, $username);

    $statement = $db->prepare('SELECT id, username, nickname, password_hash FROM users WHERE username = :username');
    $statement->execute([':username' => $username]);
    $user = $statement->fetch();

    if (!$user || !password_verify($password, $user['password_hash'])) {
        recordFailedLoginAttempt($db, $username);
        jsonResponse(['ok' => false, 'message' => 'Wrong username or password.'], 401);
    }

    clearFailedLoginAttempts($db, $username);
    rotateSessionSecurity();
    $_SESSION['user_id'] = (int) $user['id'];
    logSecurityEvent('user_login', [
        'user_id' => $_SESSION['user_id'],
        'username' => $username,
        'ip' => getClientIpAddress(),
    ]);
    $publicUser = publicUserData($user);
    $response = buildAppPayload($db, $publicUser);
    $response['message'] = 'Login successful.';

    jsonResponse($response);
}

function handleLogoutAction(PDO $db): never
{
    $userId = (int) ($_SESSION['user_id'] ?? 0);
    resetSessionToGuest();
    logSecurityEvent('user_logout', [
        'user_id' => $userId,
        'ip' => getClientIpAddress(),
    ]);

    $response = buildAppPayload($db, null);
    $response['message'] = 'Logged out.';

    jsonResponse($response);
}

function handleSaveScoreAction(PDO $db): never
{
    $user = getSessionUser($db);
    if (!$user) {
        logSecurityEvent('unauthorized_score_submission', [
            'ip' => getClientIpAddress(),
        ]);
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

function requireAuthenticatedUser(PDO $db): array
{
    $user = getSessionUser($db);
    if (!$user) {
        jsonResponse(['ok' => false, 'message' => 'You need to log in first.'], 401);
    }

    return $user;
}

function handleUpdateProfileAction(PDO $db): never
{
    $user = requireAuthenticatedUser($db);
    $nickname = trim((string) ($_POST['nickname'] ?? ''));

    if (!preg_match('/^[\p{L}\p{N}_\- ]{3,20}$/u', $nickname)) {
        jsonResponse(['ok' => false, 'message' => 'Nickname must have 3-20 characters.'], 422);
    }

    $nicknameCheck = $db->prepare(
        'SELECT id
         FROM users
         WHERE lower(nickname) = lower(:nickname) AND id != :id'
    );
    $nicknameCheck->execute([
        ':nickname' => $nickname,
        ':id' => (int) $user['id'],
    ]);

    if ($nicknameCheck->fetch()) {
        jsonResponse(['ok' => false, 'message' => 'That nickname already exists. Choose another one.'], 409);
    }

    $update = $db->prepare('UPDATE users SET nickname = :nickname WHERE id = :id');
    $update->execute([
        ':nickname' => $nickname,
        ':id' => (int) $user['id'],
    ]);

    logSecurityEvent('user_profile_updated', [
        'user_id' => (int) $user['id'],
        'ip' => getClientIpAddress(),
    ]);

    $response = buildAppPayload($db, getSessionUser($db));
    $response['message'] = 'Profile updated.';

    jsonResponse($response);
}

function handleChangePasswordAction(PDO $db): never
{
    $user = requireAuthenticatedUser($db);
    $currentPassword = (string) ($_POST['current_password'] ?? '');
    $newPassword = (string) ($_POST['new_password'] ?? '');

    if ($currentPassword === '' || $newPassword === '') {
        jsonResponse(['ok' => false, 'message' => 'Current password and new password are required.'], 422);
    }

    if (mb_strlen($newPassword) < 6) {
        jsonResponse(['ok' => false, 'message' => 'Password must have at least 6 characters.'], 422);
    }

    $statement = $db->prepare('SELECT password_hash FROM users WHERE id = :id');
    $statement->execute([':id' => (int) $user['id']]);
    $credentials = $statement->fetch() ?: null;

    if (!$credentials || !password_verify($currentPassword, (string) $credentials['password_hash'])) {
        jsonResponse(['ok' => false, 'message' => 'Current password is not correct.'], 401);
    }

    if (password_verify($newPassword, (string) $credentials['password_hash'])) {
        jsonResponse(['ok' => false, 'message' => 'Choose a different password from the current one.'], 422);
    }

    $update = $db->prepare('UPDATE users SET password_hash = :password_hash WHERE id = :id');
    $update->execute([
        ':password_hash' => password_hash($newPassword, PASSWORD_DEFAULT),
        ':id' => (int) $user['id'],
    ]);

    rotateSessionSecurity();
    $_SESSION['user_id'] = (int) $user['id'];

    logSecurityEvent('user_password_changed', [
        'user_id' => (int) $user['id'],
        'ip' => getClientIpAddress(),
    ]);

    $response = buildAppPayload($db, getSessionUser($db));
    $response['message'] = 'Password updated.';

    jsonResponse($response);
}


