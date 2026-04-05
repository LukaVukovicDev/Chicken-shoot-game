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
        $db->exec('PRAGMA busy_timeout = 5000');

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
    ensureRoutesTable($db);
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

function ensureRoutesTable(PDO $db): void
{
    $db->exec(
        'CREATE TABLE IF NOT EXISTS routes (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            map_title TEXT NOT NULL,
            map_copy TEXT NOT NULL,
            locked_copy TEXT NOT NULL DEFAULT "",
            status_text TEXT NOT NULL,
            banner_title TEXT NOT NULL,
            banner_copy TEXT NOT NULL,
            start_count INTEGER NOT NULL,
            spawn_limit INTEGER NOT NULL,
            spawn_every_ms INTEGER NOT NULL,
            speed_multiplier REAL NOT NULL DEFAULT 1,
            chicken_class TEXT NOT NULL DEFAULT "",
            accessory TEXT NOT NULL DEFAULT "none",
            unlock_score INTEGER NOT NULL DEFAULT 0,
            display_order INTEGER NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1
        )'
    );

    $routeCount = (int) $db->query('SELECT COUNT(*) FROM routes')->fetchColumn();
    if ($routeCount > 0) {
        return;
    }

    $insert = $db->prepare(
        'INSERT INTO routes (
            id,
            name,
            map_title,
            map_copy,
            locked_copy,
            status_text,
            banner_title,
            banner_copy,
            start_count,
            spawn_limit,
            spawn_every_ms,
            speed_multiplier,
            chicken_class,
            accessory,
            unlock_score,
            display_order
        ) VALUES (
            :id,
            :name,
            :map_title,
            :map_copy,
            :locked_copy,
            :status_text,
            :banner_title,
            :banner_copy,
            :start_count,
            :spawn_limit,
            :spawn_every_ms,
            :speed_multiplier,
            :chicken_class,
            :accessory,
            :unlock_score,
            :display_order
        )'
    );

    $defaultRoutes = [
        [
            'id' => 1,
            'name' => 'Level 1',
            'map_title' => 'Farm Run',
            'map_copy' => 'Classic meadow warm-up with the standard flock.',
            'locked_copy' => '',
            'status_text' => 'Round started. Aim for the quick birds and push past 800 points for the snowy second level.',
            'banner_title' => 'Level 1',
            'banner_copy' => 'The hunt begins across the open meadow.',
            'start_count' => 4,
            'spawn_limit' => 8,
            'spawn_every_ms' => 900,
            'speed_multiplier' => 1,
            'chicken_class' => '',
            'accessory' => 'none',
            'unlock_score' => 0,
            'display_order' => 1,
        ],
        [
            'id' => 2,
            'name' => 'Level 2',
            'map_title' => 'Russian Ridge',
            'map_copy' => 'Snowy mountain terrain with ushanka-wearing chickens.',
            'locked_copy' => 'Unlock by pushing beyond 800 score.',
            'status_text' => 'Level 2 started. Snowy ridge unlocked and the chickens are moving faster.',
            'banner_title' => 'Level 2',
            'banner_copy' => 'Ulazis u ruski planinski teren. Tajmer je vracen na 45 sekundi, a kokoske sada nose zimske kape.',
            'start_count' => 5,
            'spawn_limit' => 10,
            'spawn_every_ms' => 760,
            'speed_multiplier' => 1.18,
            'chicken_class' => 'winter-chicken',
            'accessory' => 'winter',
            'unlock_score' => 800,
            'display_order' => 2,
        ],
        [
            'id' => 3,
            'name' => 'Level 3',
            'map_title' => 'Island Sprint',
            'map_copy' => 'A tropical island chase with bright pink flower leis and hotter pace.',
            'locked_copy' => 'Unlock by pushing beyond 1500 score.',
            'status_text' => 'Level 3 started. Tropical island unlocked and the chickens are darting through the sea breeze.',
            'banner_title' => 'Level 3',
            'banner_copy' => 'Stizes na tropsko ostrvo. Tajmer je vracen na 45 sekundi, a kokoske sada nose havajski vencic.',
            'start_count' => 6,
            'spawn_limit' => 12,
            'spawn_every_ms' => 620,
            'speed_multiplier' => 1.32,
            'chicken_class' => 'tropical-chicken',
            'accessory' => 'lei',
            'unlock_score' => 1500,
            'display_order' => 3,
        ],
    ];

    foreach ($defaultRoutes as $route) {
        $insert->execute($route);
    }
}


