<?php
declare(strict_types=1);

const SESSION_IDLE_TIMEOUT = 1800;
const SESSION_REGENERATION_INTERVAL = 900;
const LOGIN_RATE_LIMIT_WINDOW = 900;
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 5;
const LOGIN_RATE_LIMIT_BLOCK_SECONDS = 900;

function bootstrapSecurity(): void
{
    header_remove('X-Powered-By');
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.cookie_httponly', '1');
    ini_set('session.cookie_samesite', 'Strict');
    ini_set('session.cookie_secure', isHttpsRequest() ? '1' : '0');

    session_name('CHICKENSHOOTSESSID');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'domain' => '',
        'secure' => isHttpsRequest(),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);

    if (session_status() !== PHP_SESSION_ACTIVE) {
        session_start();
    }

    enforceSessionTimeout();
    maybeRegenerateSessionId();
    ensureCsrfToken();
    sendSecurityHeaders();
}

function isHttpsRequest(): bool
{
    if (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off') {
        return true;
    }

    $forwardedProto = strtolower(trim((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')));
    if ($forwardedProto !== '') {
        $firstForwardedProto = strtok($forwardedProto, ',');
        if ($firstForwardedProto !== false && trim($firstForwardedProto) === 'https') {
            return true;
        }
    }

    return (int) ($_SERVER['SERVER_PORT'] ?? 0) === 443;
}

function sendSecurityHeaders(): void
{
    header('Content-Type: text/html; charset=UTF-8');
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Expires: 0');
    header('X-Frame-Options: DENY');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    header('Permissions-Policy: accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()');
    header('Cross-Origin-Opener-Policy: same-origin');
    header('Cross-Origin-Resource-Policy: same-origin');
    header('X-Permitted-Cross-Domain-Policies: none');
    header("Content-Security-Policy: default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; manifest-src 'self'; media-src 'self'");

    if (isHttpsRequest()) {
        header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
    }
}

function ensureCsrfToken(bool $rotate = false): void
{
    if ($rotate || empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
}

function getCsrfToken(): string
{
    ensureCsrfToken();
    return (string) $_SESSION['csrf_token'];
}

function rotateSessionSecurity(): void
{
    session_regenerate_id(true);
    $_SESSION['session_regenerated_at'] = time();
    $_SESSION['last_activity_at'] = time();
    ensureCsrfToken(true);
}

function resetSessionToGuest(): void
{
    $_SESSION = [];
    rotateSessionSecurity();
}

function enforceSessionTimeout(): void
{
    $now = time();
    $lastActivityAt = (int) ($_SESSION['last_activity_at'] ?? 0);

    if ($lastActivityAt > 0 && ($now - $lastActivityAt) > SESSION_IDLE_TIMEOUT) {
        logSecurityEvent('session_timeout', [
            'ip' => getClientIpAddress(),
        ]);
        $_SESSION = [];
        rotateSessionSecurity();
        return;
    }

    $_SESSION['last_activity_at'] = $now;
}

function maybeRegenerateSessionId(): void
{
    $now = time();
    $lastRegeneratedAt = (int) ($_SESSION['session_regenerated_at'] ?? 0);

    if ($lastRegeneratedAt === 0 || ($now - $lastRegeneratedAt) >= SESSION_REGENERATION_INTERVAL) {
        session_regenerate_id(true);
        $_SESSION['session_regenerated_at'] = $now;
    }
}

function ensureAjaxRequest(): void
{
    $requestedWith = strtolower((string) ($_SERVER['HTTP_X_REQUESTED_WITH'] ?? ''));
    if ($requestedWith !== 'xmlhttprequest') {
        logSecurityEvent('non_ajax_action_request', [
            'action' => (string) ($_GET['action'] ?? ''),
            'ip' => getClientIpAddress(),
        ]);
        jsonResponse(['ok' => false, 'message' => 'Unsupported request context.'], 403);
    }
}

function validateSameOriginRequest(): void
{
    $origin = trim((string) ($_SERVER['HTTP_ORIGIN'] ?? ''));
    $referer = trim((string) ($_SERVER['HTTP_REFERER'] ?? ''));
    $fetchSite = strtolower((string) ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? ''));

    if ($fetchSite !== '' && !in_array($fetchSite, ['same-origin', 'none'], true)) {
        logSecurityEvent('cross_site_request_blocked', [
            'action' => (string) ($_GET['action'] ?? ''),
            'ip' => getClientIpAddress(),
            'sec_fetch_site' => $fetchSite,
        ]);
        jsonResponse(['ok' => false, 'message' => 'Cross-site request blocked.'], 403);
    }

    if ($origin !== '' && isAllowedOrigin($origin)) {
        return;
    }

    if ($origin === '' && $referer !== '' && isAllowedOrigin($referer)) {
        return;
    }

    logSecurityEvent('origin_validation_failed', [
        'action' => (string) ($_GET['action'] ?? ''),
        'ip' => getClientIpAddress(),
        'origin' => $origin,
        'referer' => $referer,
    ]);
    jsonResponse(['ok' => false, 'message' => 'Request origin validation failed.'], 403);
}

function requireValidCsrfToken(): void
{
    $submittedToken = trim((string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''));
    if ($submittedToken === '') {
        $submittedToken = trim((string) ($_POST['_csrf'] ?? ''));
    }

    if ($submittedToken === '' || !hash_equals(getCsrfToken(), $submittedToken)) {
        logSecurityEvent('csrf_validation_failed', [
            'action' => (string) ($_GET['action'] ?? ''),
            'ip' => getClientIpAddress(),
        ]);
        jsonResponse(['ok' => false, 'message' => 'Security token validation failed. Refresh the page and try again.'], 403);
    }
}

function isAllowedOrigin(string $url): bool
{
    $host = getRequestHost();
    if ($host === '') {
        return false;
    }

    $parts = parse_url($url);
    if (!is_array($parts)) {
        return false;
    }

    $scheme = strtolower((string) ($parts['scheme'] ?? ''));
    $requestScheme = isHttpsRequest() ? 'https' : 'http';
    $originHost = strtolower((string) ($parts['host'] ?? ''));
    $requestHost = normalizeHostName($host);
    $originPort = (int) ($parts['port'] ?? ($scheme === 'https' ? 443 : 80));
    $requestPort = getRequestPort($requestScheme, $host);

    return $scheme === $requestScheme
        && $originHost === $requestHost
        && $originPort === $requestPort;
}

function getRequestHost(): string
{
    $forwardedHost = trim((string) ($_SERVER['HTTP_X_FORWARDED_HOST'] ?? ''));
    if ($forwardedHost !== '') {
        $firstForwardedHost = strtok($forwardedHost, ',');
        if ($firstForwardedHost !== false) {
            return trim($firstForwardedHost);
        }
    }

    return trim((string) ($_SERVER['HTTP_HOST'] ?? ''));
}

function normalizeHostName(string $host): string
{
    return strtolower((string) preg_replace('/:\d+$/', '', trim($host)));
}

function getRequestPort(string $scheme, string $host): int
{
    $forwardedPort = trim((string) ($_SERVER['HTTP_X_FORWARDED_PORT'] ?? ''));
    if ($forwardedPort !== '' && ctype_digit($forwardedPort)) {
        return (int) $forwardedPort;
    }

    $parsedPort = parse_url($scheme . '://' . $host, PHP_URL_PORT);
    if (is_int($parsedPort)) {
        return $parsedPort;
    }

    return $scheme === 'https' ? 443 : 80;
}

function getClientIpAddress(): string
{
    return (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
}

function logSecurityEvent(string $event, array $context = []): void
{
    $logDirectory = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'logs';
    if (!is_dir($logDirectory)) {
        @mkdir($logDirectory, 0775, true);
    }

    $entry = json_encode([
        'timestamp' => gmdate('c'),
        'event' => $event,
        'context' => $context,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    if ($entry !== false) {
        @file_put_contents($logDirectory . DIRECTORY_SEPARATOR . 'security.log', $entry . PHP_EOL, FILE_APPEND | LOCK_EX);
    }
}

function ensureLoginAllowed(PDO $db, string $username): void
{
    cleanupExpiredLoginAttempts($db);

    $statement = $db->prepare(
        'SELECT failed_count, blocked_until
         FROM login_attempts
         WHERE username = :username AND ip_address = :ip_address'
    );
    $statement->execute([
        ':username' => normalizeUsernameForRateLimit($username),
        ':ip_address' => getClientIpAddress(),
    ]);

    $attempt = $statement->fetch();
    $blockedUntil = (int) ($attempt['blocked_until'] ?? 0);

    if ($blockedUntil > time()) {
        logSecurityEvent('login_rate_limit_hit', [
            'username' => normalizeUsernameForRateLimit($username),
            'ip' => getClientIpAddress(),
            'blocked_until' => $blockedUntil,
        ]);
        jsonResponse(['ok' => false, 'message' => 'Too many login attempts. Try again in a few minutes.'], 429);
    }
}

function recordFailedLoginAttempt(PDO $db, string $username): void
{
    $normalizedUsername = normalizeUsernameForRateLimit($username);
    $ipAddress = getClientIpAddress();
    $currentTime = time();

    $select = $db->prepare(
        'SELECT failed_count, last_failed_at
         FROM login_attempts
         WHERE username = :username AND ip_address = :ip_address'
    );
    $select->execute([
        ':username' => $normalizedUsername,
        ':ip_address' => $ipAddress,
    ]);
    $attempt = $select->fetch() ?: null;

    $failedCount = 1;
    if ($attempt && ($currentTime - (int) $attempt['last_failed_at']) <= LOGIN_RATE_LIMIT_WINDOW) {
        $failedCount = (int) $attempt['failed_count'] + 1;
    }

    $blockedUntil = $failedCount >= LOGIN_RATE_LIMIT_MAX_ATTEMPTS
        ? $currentTime + LOGIN_RATE_LIMIT_BLOCK_SECONDS
        : null;

    $upsert = $db->prepare(
        'INSERT INTO login_attempts (username, ip_address, failed_count, last_failed_at, blocked_until)
         VALUES (:username, :ip_address, :failed_count, :last_failed_at, :blocked_until)
         ON CONFLICT(username, ip_address) DO UPDATE SET
            failed_count = excluded.failed_count,
            last_failed_at = excluded.last_failed_at,
            blocked_until = excluded.blocked_until'
    );
    $upsert->execute([
        ':username' => $normalizedUsername,
        ':ip_address' => $ipAddress,
        ':failed_count' => $failedCount,
        ':last_failed_at' => $currentTime,
        ':blocked_until' => $blockedUntil,
    ]);

    logSecurityEvent('failed_login_attempt', [
        'username' => $normalizedUsername,
        'ip' => $ipAddress,
        'failed_count' => $failedCount,
        'blocked_until' => $blockedUntil,
    ]);
}

function clearFailedLoginAttempts(PDO $db, string $username): void
{
    $statement = $db->prepare(
        'DELETE FROM login_attempts
         WHERE username = :username AND ip_address = :ip_address'
    );
    $statement->execute([
        ':username' => normalizeUsernameForRateLimit($username),
        ':ip_address' => getClientIpAddress(),
    ]);
}

function cleanupExpiredLoginAttempts(PDO $db): void
{
    $cutoff = time() - LOGIN_RATE_LIMIT_WINDOW;
    $statement = $db->prepare(
        'DELETE FROM login_attempts
         WHERE blocked_until IS NOT NULL AND blocked_until < :now
            OR blocked_until IS NULL AND last_failed_at < :cutoff'
    );
    $statement->execute([
        ':now' => time(),
        ':cutoff' => $cutoff,
    ]);
}

function normalizeUsernameForRateLimit(string $username): string
{
    return strtolower(trim($username));
}
