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

    $statement = $db->query(
        'SELECT
            user_id,
            MAX(score) AS best_score,
            MIN(created_at) AS first_round_at
         FROM scores
         GROUP BY user_id
         ORDER BY best_score DESC, first_round_at ASC, user_id ASC'
    );

    $rankedPlayers = $statement->fetchAll() ?: [];
    $currentUserId = (int) $user['id'];

    foreach ($rankedPlayers as $index => $player) {
        if ((int) $player['user_id'] !== $currentUserId) {
            continue;
        }

        $nextPlayer = $rankedPlayers[$index - 1] ?? null;
        $pointsToNextRank = $nextPlayer
            ? max(0, (int) $nextPlayer['best_score'] - (int) $player['best_score'] + 1)
            : 0;

        return [
            'position' => $index + 1,
            'total_players' => count($rankedPlayers),
            'points_to_next_rank' => $pointsToNextRank,
        ];
    }

    return null;
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
            MAX(score) AS best_score
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
        'best_accuracy_round' => $bestRound,
        'rank' => fetchPlayerRank($db, $user),
        'history' => $history,
        'score_trend' => calculateScoreTrend($history),
    ];
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


