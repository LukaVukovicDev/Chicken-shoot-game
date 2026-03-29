<?php
declare(strict_types=1);

function createDatabaseContext(string $databasePath): array
{
    $db = null;
    $dbError = null;

    try {
        $db = new PDO('sqlite:' . $databasePath);
        $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $db->setAttribute(PDO::ATTR_EMULATE_PREPARES, false);

        initializeDatabaseSchema($db);
    } catch (Throwable $exception) {
        $dbError = $exception->getMessage();
        logSecurityEvent('database_bootstrap_failed', [
            'message' => $dbError,
        ]);
    }

    return [
        'db' => $db,
        'dbError' => $dbError,
    ];
}

function initializeDatabaseSchema(PDO $db): void
{
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
            clicks INTEGER NOT NULL DEFAULT 0,
            hits INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )'
    );

    $db->exec(
        'CREATE TABLE IF NOT EXISTS login_attempts (
            username TEXT NOT NULL,
            ip_address TEXT NOT NULL,
            failed_count INTEGER NOT NULL DEFAULT 0,
            last_failed_at INTEGER NOT NULL,
            blocked_until INTEGER DEFAULT NULL,
            PRIMARY KEY (username, ip_address)
        )'
    );

    ensureScoreColumns($db);
}

function ensureScoreColumns(PDO $db): void
{
    $scoreColumns = $db->query('PRAGMA table_info(scores)')->fetchAll() ?: [];
    $scoreColumnNames = array_column($scoreColumns, 'name');

    if (!in_array('clicks', $scoreColumnNames, true)) {
        $db->exec('ALTER TABLE scores ADD COLUMN clicks INTEGER NOT NULL DEFAULT 0');
    }

    if (!in_array('hits', $scoreColumnNames, true)) {
        $db->exec('ALTER TABLE scores ADD COLUMN hits INTEGER NOT NULL DEFAULT 0');
    }
}


