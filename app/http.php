<?php
declare(strict_types=1);

const APP_JSON_FLAGS = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES;

function jsonResponse(array $payload, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=UTF-8');

    $encoded = json_encode($payload, APP_JSON_FLAGS);
    if ($encoded === false) {
        http_response_code(500);
        $encoded = '{"ok":false,"message":"Failed to encode JSON response."}';
    }

    echo $encoded;
    exit;
}

function encodeJson(mixed $value): string
{
    $encoded = json_encode($value, APP_JSON_FLAGS);

    if ($encoded === false) {
        throw new RuntimeException('Failed to encode view data as JSON.');
    }

    return $encoded;
}

function escapeHtml(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}


