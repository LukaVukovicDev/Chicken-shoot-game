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
    ensureScoreSubmissionsTable($db);
}

function ensureScoreSubmissionsTable(PDO $db): void
{
    $db->exec(
        'CREATE TABLE IF NOT EXISTS score_submissions (
            user_id INTEGER NOT NULL PRIMARY KEY,
            submitted_at INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )'
    );
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

    $insert = $db->prepare(
        'INSERT OR IGNORE INTO routes (
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
        [
            'id' => 4,
            'name' => 'Level 4',
            'map_title' => 'Racing Circuit',
            'map_copy' => 'A high-speed race track with hot asphalt, curbs and the fastest flock yet.',
            'locked_copy' => 'Unlock by pushing beyond 2300 score.',
            'status_text' => 'Level 4 started. The racing circuit is live and the chickens are blazing across the track.',
            'banner_title' => 'Level 4',
            'banner_copy' => 'Ulazis na trkacku stazu. Podloga je vrela, tempo je najbrzi do sada, a meta ima sve manje vremena na ekranu.',
            'start_count' => 7,
            'spawn_limit' => 14,
            'spawn_every_ms' => 520,
            'speed_multiplier' => 1.5,
            'chicken_class' => 'race-chicken',
            'accessory' => 'none',
            'unlock_score' => 2300,
            'display_order' => 4,
        ],
        [
            'id' => 5,
            'name' => 'Level 5',
            'map_title' => 'Paris Night',
            'map_copy' => 'A Paris skyline hunt with the Eiffel Tower glowing behind the action.',
            'locked_copy' => 'Unlock by pushing beyond 3200 score.',
            'status_text' => 'Level 5 started. Paris is lit up, the Eiffel Tower is in the background and the flock is flying at full speed.',
            'banner_title' => 'Level 5',
            'banner_copy' => 'Stizes u Pariz. Ajfelov toranj svetli iza mete, a kokoske sada prelecu grad jos brzim tempom.',
            'start_count' => 8,
            'spawn_limit' => 15,
            'spawn_every_ms' => 460,
            'speed_multiplier' => 1.62,
            'chicken_class' => 'paris-chicken',
            'accessory' => 'beret',
            'unlock_score' => 3200,
            'display_order' => 5,
        ],
        [
            'id' => 6,
            'name' => 'Level 6',
            'map_title' => 'Pisa Plaza',
            'map_copy' => 'A fast Italian plaza hunt beneath the leaning tower of Pisa.',
            'locked_copy' => 'Unlock by pushing beyond 4100 score.',
            'status_text' => 'Level 6 started. Pisa is open, the tower is leaning behind the action and the flock is flying in Italian colors.',
            'banner_title' => 'Level 6',
            'banner_copy' => 'Stizes u Pizu. Krivi toranj je iza mete, a kokoske nose boje italijanske zastave.',
            'start_count' => 9,
            'spawn_limit' => 16,
            'spawn_every_ms' => 420,
            'speed_multiplier' => 1.74,
            'chicken_class' => 'italy-chicken',
            'accessory' => 'italy',
            'unlock_score' => 4100,
            'display_order' => 6,
        ],
        [
            'id' => 7,
            'name' => 'Level 7',
            'map_title' => 'Rio Heights',
            'map_copy' => 'A Corcovado hill hunt with Christ the Redeemer watching over Rio de Janeiro.',
            'locked_copy' => 'Unlock by pushing beyond 5000 score.',
            'status_text' => 'Level 7 started. Rio is open, Christ the Redeemer rises in the background and the flock is flying over the hills.',
            'banner_title' => 'Level 7',
            'banner_copy' => 'Stizes u Rio de Janeiro. Statua Isusa Hrista stoji iznad grada, a kokoske lete kroz najbrzi ritam do sada.',
            'start_count' => 10,
            'spawn_limit' => 17,
            'spawn_every_ms' => 380,
            'speed_multiplier' => 1.86,
            'chicken_class' => 'rio-chicken',
            'accessory' => 'rio',
            'unlock_score' => 5000,
            'display_order' => 7,
        ],
        [
            'id' => 8,
            'name' => 'Level 8',
            'map_title' => 'Istanbul Skyline',
            'map_copy' => 'A fast Bosphorus chase with Aya Sofija rising over the old city skyline.',
            'locked_copy' => 'Unlock by pushing beyond 6200 score.',
            'status_text' => 'Level 8 started. Istanbul is open, Aya Sofija dominates the skyline and the flock is moving at top speed.',
            'banner_title' => 'Level 8',
            'banner_copy' => 'Stizes u Istanbul. Aja Sofija se uzdize iznad grada, a kokoske lete kroz najbrzi ritam u igri.',
            'start_count' => 11,
            'spawn_limit' => 18,
            'spawn_every_ms' => 350,
            'speed_multiplier' => 1.98,
            'chicken_class' => '',
            'accessory' => 'none',
            'unlock_score' => 6200,
            'display_order' => 8,
        ],
    ];

    foreach ($defaultRoutes as $route) {
        $insert->execute($route);
    }
}


