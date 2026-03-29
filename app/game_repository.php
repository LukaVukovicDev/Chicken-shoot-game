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
        'history' => $history,
    ];
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


