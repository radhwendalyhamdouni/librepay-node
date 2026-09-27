<?php
/**
 * LibrePay Node — webhook receiver (plain PHP, drop-in for WordPress & co).
 *
 * Register https://yoursite.com/librepay-webhook.php in LP_WEBHOOK_URLS
 * (or via the console → Webhooks) and set the matching secret below.
 *
 * Non-negotiables implemented here:
 *   1. hash_equals (timing-safe) on the RAW body BEFORE json_decode.
 *   2. Replay guard on X-LibrePay-Timestamp (10 minutes).
 *   3. Idempotency — deliveries may repeat; check before fulfilling.
 */

declare(strict_types=1);

$secret = getenv('LIBREPAY_WEBHOOK_SECRET') ?: '';   // whsec_… pairs with the URL
if ($secret === '') { http_response_code(500); exit('webhook secret not configured'); }

$raw      = file_get_contents('php://input') ?: '';
$expected = 'sha256=' . hash_hmac('sha256', $raw, $secret);
$got      = $_SERVER['HTTP_X_LIBREPAY_SIGNATURE'] ?? '';

if (!hash_equals($expected, $got)) { http_response_code(400); exit('bad signature'); }

$ts = (int) ($_SERVER['HTTP_X_LIBREPAY_TIMESTAMP'] ?? 0);
if ($ts === 0 || abs(time() * 1000 - $ts) > 10 * 60 * 1000) { http_response_code(400); exit('stale'); }

$evt = json_decode($raw, true, flags: JSON_THROW_ON_ERROR);
$deliveryId = $_SERVER['HTTP_X_LIBREPAY_DELIVERY_ID'] ?? ($evt['invoiceId'] . ':' . $evt['event']);

// ── idempotency ──────────────────────────────────────────────────────────────
// WordPress example: add_post_meta($orderId, '_lp_delivery_' . $deliveryId, 1, true)
// Generic example: a small table with a UNIQUE index on delivery_id.
$processed = @file_get_contents(sys_get_temp_dir() . "/lp-seen/$deliveryId");
if ($processed) { http_response_code(200); exit; }
@mkdir(sys_get_temp_dir() . '/lp-seen', 0700, true);
file_put_contents(sys_get_temp_dir() . "/lp-seen/$deliveryId", '1');

switch ($evt['event'] ?? '') {
    case 'invoice.confirmed':   // ✅ release the goods (2 confs / instant Lightning)
        // $orderId = $evt['data']['invoice']['orderId'] ?? null;
        // mark_order_paid($orderId, $evt['invoiceId']);
        break;
    case 'invoice.detected':    // mempool sighting — show "confirming…"
    case 'invoice.settled':     // 6+ confs, deep finality
    case 'invoice.expired':     // never paid — reopen order
    case 'invoice.underpaid':   // < 99% received — manual review
        break;
}

http_response_code(200);   // any non-2xx → node retries (1m, 5m, 15m, 1h, 6h, 24h)
echo 'ok';
