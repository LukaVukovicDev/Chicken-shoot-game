<?php
declare(strict_types=1);

function fetchLeaderboard(?PDO $db, int $limit = 10): array
{
    if (!$db) {
        return [];
    }

    $statement = $db->prepare(
        'SELECT
            u.nickname,
            MAX(s.score) AS best_score,
            COUNT(s.id) AS rounds_played,
            ROUND(MAX(CASE WHEN s.clicks > 0 THEN (CAST(s.hits AS REAL) / s.clicks) * 100 ELSE 0 END), 1) AS best_accuracy
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

function fetchRoutes(?PDO $db): array
{
    if (!$db) {
        return [];
    }

    ensureRoutesTable($db);

    $statement = $db->query(
        'SELECT
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
            unlock_score
        FROM routes
        WHERE is_active = 1
        ORDER BY display_order ASC, id ASC'
    );

    return $statement->fetchAll() ?: [];
}

function fetchPlayerRank(?PDO $db, ?array $user): ?array
{
    if (!$db || !$user) {
        return null;
    }

    $statement = $db->prepare(
        'WITH ranked AS (
             SELECT
                 user_id,
                 MAX(score) AS best_score,
                 ROW_NUMBER() OVER (ORDER BY MAX(score) DESC, MIN(created_at) ASC, user_id ASC) AS position
             FROM scores
             GROUP BY user_id
         ),
         total AS (SELECT COUNT(*) AS cnt FROM ranked)
         SELECT
             r.position,
             r.best_score,
             t.cnt AS total_players,
             LAG(r.best_score) OVER (ORDER BY r.position) AS prev_best_score
         FROM ranked r
         CROSS JOIN total t
         WHERE r.user_id = :uid'
    );
    $statement->execute([':uid' => (int) $user['id']]);
    $row = $statement->fetch();

    if (!$row) {
        return null;
    }

    $pointsToNextRank = $row['prev_best_score'] !== null
        ? max(0, (int) $row['prev_best_score'] - (int) $row['best_score'] + 1)
        : 0;

    return [
        'position' => (int) $row['position'],
        'total_players' => (int) $row['total_players'],
        'points_to_next_rank' => $pointsToNextRank,
    ];
}

function fetchPlayerAnalytics(?PDO $db, ?array $user, int $limit = 8): ?array
{
    if (!$db || !$user) {
        return null;
    }

    $summaryStatement = $db->prepare(
        'SELECT
            COUNT(id) AS rounds_played,
            MAX(CASE WHEN clicks > 0 THEN (CAST(hits AS REAL) / clicks) * 100 ELSE 0 END) AS best_accuracy,
            MAX(score) AS best_score,
            MAX(best_streak) AS best_streak_ever
        FROM scores
        WHERE user_id = :user_id'
    );
    $summaryStatement->execute([':user_id' => (int) $user['id']]);
    $summary = $summaryStatement->fetch() ?: [];

    $bestRoundStatement = $db->prepare(
        'SELECT
            score,
            clicks,
            hits,
            created_at,
            ROUND(CASE WHEN clicks > 0 THEN (CAST(hits AS REAL) / clicks) * 100 ELSE 0 END, 1) AS accuracy,
            ROUND(CASE WHEN clicks > 0 THEN CAST(score AS REAL) / clicks ELSE 0 END, 2) AS points_per_shot
        FROM scores
        WHERE user_id = :user_id
        ORDER BY accuracy DESC, score DESC, created_at ASC
        LIMIT 1'
    );
    $bestRoundStatement->execute([':user_id' => (int) $user['id']]);
    $bestRound = $bestRoundStatement->fetch() ?: null;

    $historyStatement = $db->prepare(
        'SELECT
            score,
            clicks,
            hits,
            best_streak,
            created_at,
            ROUND(CASE WHEN clicks > 0 THEN (CAST(hits AS REAL) / clicks) * 100 ELSE 0 END, 1) AS accuracy,
            ROUND(CASE WHEN clicks > 0 THEN CAST(score AS REAL) / clicks ELSE 0 END, 2) AS points_per_shot
        FROM scores
        WHERE user_id = :user_id
        ORDER BY id DESC
        LIMIT :limit'
    );
    $historyStatement->bindValue(':user_id', (int) $user['id'], PDO::PARAM_INT);
    $historyStatement->bindValue(':limit', $limit, PDO::PARAM_INT);
    $historyStatement->execute();
    $history = array_reverse($historyStatement->fetchAll() ?: []);

    return [
        'rounds_played' => (int) ($summary['rounds_played'] ?? 0),
        'best_accuracy' => round((float) ($summary['best_accuracy'] ?? 0), 1),
        'best_score' => (int) ($summary['best_score'] ?? 0),
        'best_streak_ever' => (int) ($summary['best_streak_ever'] ?? 0),
        'best_accuracy_round' => $bestRound,
        'rank' => fetchPlayerRank($db, $user),
        'percentile' => fetchPlayerPercentile($db, $user),
        'history' => $history,
        'score_trend' => calculateScoreTrend($history),
        'above_average_streak' => fetchRecentScoreStreak($db, $user),
    ];
}

function fetchPlayerPercentile(?PDO $db, ?array $user): ?float
{
    if (!$db || !$user) {
        return null;
    }

    $statement = $db->prepare(
        'WITH bests AS (
             SELECT user_id, MAX(score) AS best_score
             FROM scores
             GROUP BY user_id
         )
         SELECT
             COUNT(*) AS total_players,
             SUM(CASE WHEN b.best_score < u.best_score THEN 1 ELSE 0 END) AS players_below
         FROM bests b
         CROSS JOIN (SELECT best_score FROM bests WHERE user_id = :uid) AS u'
    );
    $statement->execute([':uid' => (int) $user['id']]);
    $row = $statement->fetch();

    $total = (int) ($row['total_players'] ?? 0);
    if ($total <= 1) {
        return null;
    }

    return round(((int) ($row['players_below'] ?? 0)) / $total * 100, 1);
}

function calculateScoreTrend(array $history): array
{
    $scores = array_map(static fn (array $round): int => (int) ($round['score'] ?? 0), $history);
    $roundCount = count($scores);

    if ($roundCount < 2) {
        return [
            'status' => 'not_enough_data',
            'label' => 'Play more rounds',
            'summary' => 'Finish at least two saved rounds to unlock trend analysis.',
            'delta' => 0,
            'recent_average' => $roundCount === 1 ? $scores[0] : 0,
            'previous_average' => 0,
        ];
    }

    $recentSize = max(1, intdiv($roundCount, 2));
    $previousScores = array_slice($scores, 0, $roundCount - $recentSize);
    $recentScores = array_slice($scores, -$recentSize);
    $previousAverage = (int) round(array_sum($previousScores) / max(1, count($previousScores)));
    $recentAverage = (int) round(array_sum($recentScores) / max(1, count($recentScores)));
    $delta = (int) round($recentAverage - $previousAverage);
    $trend = [
        'status' => 'steady',
        'label' => 'Stable form',
        'summary' => 'Your recent scores are close to your earlier saved rounds.',
    ];

    if ($delta >= 75) {
        $trend = [
            'status' => 'improving',
            'label' => 'Improving',
            'summary' => 'Your recent average is climbing. Keep the same shooting rhythm.',
        ];
    } elseif ($delta <= -75) {
        $trend = [
            'status' => 'cooling',
            'label' => 'Cooling off',
            'summary' => 'Your recent average dipped. Slow down misses and rebuild accuracy.',
        ];
    }

    return array_merge($trend, [
        'delta' => $delta,
        'recent_average' => $recentAverage,
        'previous_average' => $previousAverage,
    ]);
}

function fetchScoreHistory(?PDO $db, ?array $user, int $page = 1, int $perPage = 10): ?array
{
    if (!$db || !$user) {
        return null;
    }

    $page = max(1, $page);
    $offset = ($page - 1) * $perPage;

    $totalStmt = $db->prepare('SELECT COUNT(*) FROM scores WHERE user_id = :uid');
    $totalStmt->execute([':uid' => (int) $user['id']]);
    $total = (int) $totalStmt->fetchColumn();

    $stmt = $db->prepare(
        'SELECT
            s.id,
            s.score,
            s.clicks,
            s.hits,
            s.best_streak,
            s.route_id,
            s.created_at,
            ROUND(CASE WHEN s.clicks > 0 THEN (CAST(s.hits AS REAL) / s.clicks) * 100 ELSE 0 END, 1) AS accuracy,
            r.name AS route_name
         FROM scores s
         LEFT JOIN routes r ON r.id = s.route_id
         WHERE s.user_id = :uid
         ORDER BY s.id DESC
         LIMIT :limit OFFSET :offset'
    );
    $stmt->bindValue(':uid', (int) $user['id'], PDO::PARAM_INT);
    $stmt->bindValue(':limit', $perPage, PDO::PARAM_INT);
    $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
    $stmt->execute();

    return [
        'items' => $stmt->fetchAll() ?: [],
        'total' => $total,
        'page' => $page,
        'per_page' => $perPage,
        'total_pages' => (int) ceil($total / $perPage),
    ];
}

function fetchTopAccuracyLeaders(?PDO $db, int $limit = 10, int $minHits = 10): array
{
    if (!$db) {
        return [];
    }

    $stmt = $db->prepare(
        'SELECT
            u.nickname,
            SUM(s.hits) AS total_hits,
            SUM(s.clicks) AS total_clicks,
            ROUND((CAST(SUM(s.hits) AS REAL) / SUM(s.clicks)) * 100, 1) AS accuracy,
            MAX(s.score) AS best_score
         FROM scores s
         INNER JOIN users u ON u.id = s.user_id
         WHERE s.clicks > 0
         GROUP BY s.user_id, u.nickname
         HAVING SUM(s.hits) >= :min_hits AND SUM(s.clicks) > 0
         ORDER BY accuracy DESC, total_hits DESC, MIN(s.created_at) ASC
         LIMIT :limit'
    );
    $stmt->bindValue(':min_hits', $minHits, PDO::PARAM_INT);
    $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
    $stmt->execute();

    return $stmt->fetchAll() ?: [];
}

function fetchLeaderboardByRoute(?PDO $db, int $routeId, int $limit = 10): array
{
    if (!$db) {
        return [];
    }

    $stmt = $db->prepare(
        'SELECT
            u.nickname,
            MAX(s.score) AS best_score,
            COUNT(s.id) AS rounds_on_route,
            ROUND(MAX(CASE WHEN s.clicks > 0 THEN (CAST(s.hits AS REAL) / s.clicks) * 100 ELSE 0 END), 1) AS best_accuracy
         FROM scores s
         INNER JOIN users u ON u.id = s.user_id
         WHERE s.route_id = :route_id
         GROUP BY s.user_id, u.nickname
         ORDER BY best_score DESC, MIN(s.created_at) ASC
         LIMIT :limit'
    );
    $stmt->bindValue(':route_id', $routeId, PDO::PARAM_INT);
    $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
    $stmt->execute();

    return $stmt->fetchAll() ?: [];
}

function fetchPlayerAchievements(?PDO $db, ?array $user): array
{
    if (!$db || !$user) {
        return [];
    }

    $stmt = $db->prepare(
        'SELECT code, earned_at FROM achievements WHERE user_id = :uid ORDER BY earned_at ASC'
    );
    $stmt->execute([':uid' => (int) $user['id']]);

    return $stmt->fetchAll() ?: [];
}

function fetchLifetimeStats(?PDO $db, ?array $user): ?array
{
    if (!$db || !$user) {
        return null;
    }

    $stmt = $db->prepare(
        'SELECT
            COUNT(id) AS total_rounds,
            COALESCE(SUM(clicks), 0) AS total_clicks,
            COALESCE(SUM(hits), 0) AS total_hits,
            COALESCE(SUM(score), 0) AS total_score,
            COALESCE(MAX(best_streak), 0) AS best_streak_ever,
            ROUND(
                CASE WHEN SUM(clicks) > 0
                     THEN (CAST(SUM(hits) AS REAL) / SUM(clicks)) * 100
                     ELSE 0 END,
                1
            ) AS lifetime_accuracy,
            ROUND(
                CASE WHEN COUNT(id) > 0
                     THEN CAST(SUM(score) AS REAL) / COUNT(id)
                     ELSE 0 END,
                0
            ) AS average_score
         FROM scores
         WHERE user_id = :uid'
    );
    $stmt->execute([':uid' => (int) $user['id']]);
    $row = $stmt->fetch() ?: [];

    $favoriteRoute = (int) ($row['total_rounds'] ?? 0) > 0
        ? fetchTopRouteForUser($db, (int) $user['id'])
        : null;

    return [
        'total_rounds' => (int) ($row['total_rounds'] ?? 0),
        'total_clicks' => (int) ($row['total_clicks'] ?? 0),
        'total_hits' => (int) ($row['total_hits'] ?? 0),
        'total_score' => (int) ($row['total_score'] ?? 0),
        'best_streak_ever' => (int) ($row['best_streak_ever'] ?? 0),
        'lifetime_accuracy' => (float) ($row['lifetime_accuracy'] ?? 0.0),
        'average_score' => (int) ($row['average_score'] ?? 0),
        'favorite_route' => $favoriteRoute,
    ];
}

function fetchRecentScoreStreak(?PDO $db, ?array $user): int
{
    if (!$db || !$user) {
        return 0;
    }

    $stmt = $db->prepare(
        'WITH avg_score AS (
             SELECT CAST(AVG(score) AS REAL) AS mean FROM scores WHERE user_id = :uid
         )
         SELECT s.score, a.mean
         FROM scores s
         CROSS JOIN avg_score a
         WHERE s.user_id = :uid
         ORDER BY s.id DESC
         LIMIT 20'
    );
    $stmt->execute([':uid' => (int) $user['id']]);
    $rows = $stmt->fetchAll() ?: [];

    $streak = 0;
    foreach ($rows as $row) {
        if ((float) $row['score'] >= (float) $row['mean']) {
            $streak++;
        } else {
            break;
        }
    }

    return $streak;
}

function fetchTopRouteForUser(PDO $db, int $userId): ?array
{
    $stmt = $db->prepare(
        'SELECT r.name, COUNT(s.id) AS plays
         FROM scores s
         INNER JOIN routes r ON r.id = s.route_id
         WHERE s.user_id = :uid AND s.route_id IS NOT NULL
         GROUP BY s.route_id
         ORDER BY plays DESC, MIN(s.created_at) ASC
         LIMIT 1'
    );
    $stmt->execute([':uid' => $userId]);
    $row = $stmt->fetch() ?: null;

    if (!$row) {
        return null;
    }

    return [
        'name' => (string) $row['name'],
        'plays' => (int) $row['plays'],
    ];
}

function fetchWorstRound(?PDO $db, ?array $user): ?array
{
    if (!$db || !$user) {
        return null;
    }

    $stmt = $db->prepare(
        'SELECT
            s.score,
            s.hits,
            s.clicks,
            s.created_at,
            ROUND(CASE WHEN s.clicks > 0 THEN (CAST(s.hits AS REAL) / s.clicks) * 100 ELSE 0 END, 1) AS accuracy,
            r.name AS route_name
         FROM scores s
         LEFT JOIN routes r ON r.id = s.route_id
         WHERE s.user_id = :uid AND s.clicks > 0
         ORDER BY s.score ASC, s.created_at ASC
         LIMIT 1'
    );
    $stmt->execute([':uid' => (int) $user['id']]);
    $row = $stmt->fetch() ?: null;

    if (!$row) {
        return null;
    }

    return [
        'score'      => (int) $row['score'],
        'hits'       => (int) $row['hits'],
        'clicks'     => (int) $row['clicks'],
        'accuracy'   => (float) $row['accuracy'],
        'route_name'  => $row['route_name'] !== null ? (string) $row['route_name'] : null,
        'achieved_at' => (string) $row['created_at'],
    ];
}

function fetchPersonalBest(?PDO $db, ?array $user): ?array
{
    if (!$db || !$user) {
        return null;
    }

    $stmt = $db->prepare(
        'SELECT
            s.score,
            s.hits,
            s.clicks,
            s.created_at,
            ROUND(CASE WHEN s.clicks > 0 THEN (CAST(s.hits AS REAL) / s.clicks) * 100 ELSE 0 END, 1) AS accuracy,
            r.name AS route_name
         FROM scores s
         LEFT JOIN routes r ON r.id = s.route_id
         WHERE s.user_id = :uid
         ORDER BY s.score DESC, s.created_at ASC
         LIMIT 1'
    );
    $stmt->execute([':uid' => (int) $user['id']]);
    $row = $stmt->fetch() ?: null;

    if (!$row) {
        return null;
    }

    return [
        'score'      => (int) $row['score'],
        'hits'       => (int) $row['hits'],
        'clicks'     => (int) $row['clicks'],
        'accuracy'   => (float) $row['accuracy'],
        'route_name' => $row['route_name'] !== null ? (string) $row['route_name'] : null,
        'achieved_at' => (string) $row['created_at'],
    ];
}

function getSessionUser(?PDO $db): ?array
{
    if (!$db || empty($_SESSION['user_id'])) {
        return null;
    }

    $statement = $db->prepare('SELECT id, username, nickname, last_login_at FROM users WHERE id = :id');
    $statement->execute([':id' => (int) $_SESSION['user_id']]);
    $user = $statement->fetch();

    if (!$user) {
        unset($_SESSION['user_id']);
        return null;
    }

    return $user;
}


