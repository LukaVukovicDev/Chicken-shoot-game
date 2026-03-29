<?php
declare(strict_types=1);

require_once __DIR__ . '/app/bootstrap.php';
require_once __DIR__ . '/app/http.php';
require_once __DIR__ . '/app/database.php';
require_once __DIR__ . '/app/game_repository.php';
require_once __DIR__ . '/app/action_handler.php';

$databaseContext = createDatabaseContext(__DIR__ . DIRECTORY_SEPARATOR . 'chicken_shooting.sqlite');
$db = $databaseContext['db'];
$dbError = $databaseContext['dbError'];

handleActionRequest($db, $dbError);

$sessionUser = getSessionUser($db);
$leaderboard = fetchLeaderboard($db);
$playerAnalytics = fetchPlayerAnalytics($db, $sessionUser);

require __DIR__ . '/views/game.php';

