<?php
/**
 * LibrePay Node — create invoice + redirect (plain PHP, no framework).
 *
 *   1. Fill NODE_URL and expose LIBREPAY_API_KEY as an env secret.
 *   2. Point your "Pay with Bitcoin" button at this file.
 *
 * The API key never leaves the server. The buyer only ever sees the
 * hosted checkout URL the node returns.
 */

declare(strict_types=1);

const NODE_URL = 'https://pay.example.com';          // your node's base URL
const API_KEY_ENV = 'LIBREPAY_API_KEY';              // lp_live_…

function create_librepay_invoice(array $order): ?array
{
    $apiKey = getenv(API_KEY_ENV) ?: '';
    if ($apiKey === '') { error_log('LIBREPAY_API_KEY not set'); return null; }

    $body = json_encode([
        // EITHER sats directly:
        // 'amountSats' => 42000,
        // OR fiat (node converts at the live rate):
        'amountFiat'  => $order['total'],
        'currency'    => $order['currency'],
        'orderId'     => (string) $order['id'],
        'description' => mb_substr($order['description'], 0, 140),
        'metadata'    => ['cart' => $order['cart_id'] ?? null],
    ], JSON_UNESCAPED_UNICODE);

    $ch = curl_init(NODE_URL . '/api/v1/invoices');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $body,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_HTTPHEADER     => [
            'content-type: application/json',
            'authorization: Bearer ' . $apiKey,
        ],
    ]);
    $res  = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($res === false || $code !== 201) {
        error_log("librepay invoice failed (HTTP $code): " . (string) $res);
        return null;
    }
    return json_decode($res, true);
}

// ── endpoint behavior ────────────────────────────────────────────────────────
$invoice = create_librepay_invoice([
    'id'          => $_POST['order_id'] ?? 'demo-' . time(),
    'total'       => 27.50,
    'currency'    => 'USD',
    'description' => 'Order #1042 — two coffees',
    'cart_id'     => 'c-881',
]);

if (!$invoice || empty($invoice['checkoutUrl'])) {
    http_response_code(502);
    exit('Payment backend unavailable — please try again.');
}

// Store $invoice['invoice']['id'] with the order row now — the webhook will
// reference this id when payment is detected/confirmed.
header('Location: ' . $invoice['checkoutUrl']);
exit;
