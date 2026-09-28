<?php
/**
 * Plugin Name:       LibrePay for WooCommerce
 * Plugin URI:        https://github.com/radhwendalyhamdouni/librepay-node
 * Description:       Accept Bitcoin (on-chain stealth addresses + instant Lightning) with LibrePay — privacy-first, non-custodial, no KYC, 0% fees. Signed webhooks, idempotent invoices, one-click connection test.
 * Version:           2.0.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            LibrePay
 * License:           MIT
 * Text Domain:       librepay-woo
 * WC requires at least: 7.0
 * WC tested up to:   9.4
 *
 * Non-custodial by design: payments go directly from the buyer's wallet to
 * YOUR wallet. This plugin only creates invoices (with your LibrePay API
 * key) and listens for HMAC-signed webhooks to mark orders paid.
 *
 * Reliability contract with the node:
 *   - invoice creation is idempotent (Idempotency-Key) → a double-click or a
 *     retry can never create a second invoice for one order;
 *   - an unpaid, still-open invoice is REUSED when the buyer retries checkout
 *     (no address churn, one QR per order attempt);
 *   - an expired invoice bumps the attempt counter → fresh address, new QR;
 *   - webhook deliveries are at-least-once → every handler here dedupes.
 */

if (!defined('ABSPATH')) {
    exit;
}

// HPOS compatibility declaration (WooCommerce Custom Order Tables)
add_action('before_woocommerce_init', function () {
    if (class_exists(\Automattic\WooCommerce\Utilities\FeaturesUtil::class)) {
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('custom_order_tables', __FILE__, true);
    }
});

add_action('plugins_loaded', 'librepay_woo_init', 11);

function librepay_woo_init()
{
    if (!class_exists('WC_Payment_Gateway')) {
        return;
    }
    load_plugin_textdomain('librepay-woo', false, dirname(plugin_basename(__FILE__)) . '/languages');

    final class WC_Gateway_LibrePay extends WC_Payment_Gateway
    {
        const META_INVOICE   = '_librepay_invoice_id';
        const META_CHECKOUT  = '_librepay_checkout_url';
        const META_EXPIRES   = '_librepay_expires_at';
        const META_ATTEMPT   = '_librepay_attempt';
        const META_MARK_AT   = '_librepay_mark_paid_at';
        const META_PAID      = '_librepay_settled';

        /** @var string */
        public $api_key;
        /** @var string */
        public $api_base;
        /** @var string */
        public $webhook_secret;
        /** @var string */
        public $mark_paid_at;      // confirmed | settled
        /** @var string */
        public $on_expiry;         // failed | cancelled | hold
        /** @var string */
        public $on_underpaid;      // hold | note
        /** @var string */
        public $expiry_minutes;    // 0 = node default
        /** @var string */
        public $enable_logging;

        public function __construct()
        {
            $this->id                 = 'librepay';
            $this->icon               = apply_filters('librepay_woo_icon', plugins_url('assets/icon.svg', __FILE__));
            $this->has_fields         = false;
            $this->method_title       = __('Bitcoin (LibrePay)', 'librepay-woo');
            $this->method_description = __(
                'Accept Bitcoin on-chain and Lightning via LibrePay. Non-custodial: funds go straight to your wallet. 0% transaction fees.',
                'librepay-woo'
            );
            $this->supports           = ['products']; // refunds stay manual & non-custodial by design

            $this->init_form_fields();
            $this->init_settings();

            $this->title          = $this->get_option('title');
            $this->description    = $this->get_option('description');
            $this->api_key        = trim((string) $this->get_option('api_key'));
            $this->api_base       = untrailingslashit(trim((string) $this->get_option('api_base')));
            $this->webhook_secret = trim((string) $this->get_option('webhook_secret'));
            $this->mark_paid_at   = $this->get_option('mark_paid_at', 'confirmed');
            $this->on_expiry      = $this->get_option('on_expiry', 'failed');
            $this->on_underpaid   = $this->get_option('on_underpaid', 'hold');
            $this->expiry_minutes = (string) $this->get_option('expiry_minutes', '0');
            $this->enable_logging = $this->get_option('enable_logging', 'no');

            add_action('woocommerce_update_options_payment_gateways_' . $this->id, [$this, 'process_admin_options']);
            add_action('woocommerce_api_librepay_webhook', [$this, 'handle_webhook']);
            add_action('woocommerce_thankyou_' . $this->id, [$this, 'thankyou_page']);
            add_action('woocommerce_order_details_after_order_table', [$this, 'account_pay_button']);
            add_action('admin_footer', [$this, 'admin_test_script']);
            add_filter('woocommerce_admin_order_preview_get_order_details', [$this, 'preview_payment_link'], 10, 2);

            // admin orders list: a "Bitcoin" column with invoice state
            add_filter('manage_edit-shop_order_columns', [$this, 'column_header'], 20);
            add_action('manage_shop_order_posts_custom_column', [$this, 'column_content'], 20, 2);
            // HPOS order list
            add_filter('manage_woocommerce_page_wc-orders_columns', [$this, 'column_header'], 20);
            add_action('manage_woocommerce_page_wc-orders_custom_column', [$this, 'column_content_hpos'], 20, 2);

            // AJAX: settings-screen connection test
            add_action('wp_ajax_librepay_woo_test', [$this, 'ajax_test_connection']);
        }

        // ── settings ─────────────────────────────────────────────────────────

        public function init_form_fields()
        {
            $webhook_url = home_url('/wc-api/librepay_webhook');
            $this->form_fields = [
                'enabled' => [
                    'title'   => __('Enable/Disable', 'librepay-woo'),
                    'type'    => 'checkbox',
                    'label'   => __('Enable Bitcoin payments via LibrePay', 'librepay-woo'),
                    'default' => 'no',
                ],
                'title' => [
                    'title'       => __('Title', 'librepay-woo'),
                    'type'        => 'text',
                    'description' => __('Payment method title shown to customers at checkout.', 'librepay-woo'),
                    'default'     => __('Bitcoin (on-chain & Lightning)', 'librepay-woo'),
                    'desc_tip'    => true,
                ],
                'description' => [
                    'title'       => __('Description', 'librepay-woo'),
                    'type'        => 'textarea',
                    'description' => __('Shown under the title at checkout.', 'librepay-woo'),
                    'default'     => __('Pay privately with Bitcoin. You will get a payment page with a QR code — on-chain or Lightning, your choice. Funds go directly to the store wallet.', 'librepay-woo'),
                ],
                'connection' => [
                    'title'       => __('1 · Connection', 'librepay-woo'),
                    'type'        => 'title',
                    'description' => sprintf(
                        /* translators: %s: webhook URL */
                        __('Point your store at your self-hosted LibrePay node, then press “Test connection”. Register this webhook URL in the node console → Webhook destinations: %s', 'librepay-woo'),
                        '<code dir="ltr">' . esc_html($webhook_url) . '</code>'
                    ),
                ],
                'api_base' => [
                    'title'       => __('LibrePay node URL', 'librepay-woo'),
                    'type'        => 'url',
                    'description' => __('Base URL of YOUR node, e.g. https://pay.example.com (a Tor .onion address also works for the admin side).', 'librepay-woo'),
                    'default'     => '',
                    'desc_tip'    => true,
                ],
                'api_key' => [
                    'title'       => __('API key', 'librepay-woo'),
                    'type'        => 'password',
                    'description' => __('From the node console → Connect your store (starts with lp_live_). Stored server-side only — never sent to browsers.', 'librepay-woo'),
                    'desc_tip'    => true,
                ],
                'webhook_secret' => [
                    'title'       => __('Webhook secret', 'librepay-woo'),
                    'type'        => 'password',
                    'description' => __('From the node console → Webhook secret. Required — unsigned events are rejected.', 'librepay-woo'),
                    'desc_tip'    => true,
                ],
                'test_button' => [
                    'type' => 'librepay_test',
                ],
                'behavior' => [
                    'title'       => __('2 · Order behavior', 'librepay-woo'),
                    'type'        => 'title',
                    'description' => __('How order statuses follow the invoice lifecycle.', 'librepay-woo'),
                ],
                'mark_paid_at' => [
                    'title'       => __('Mark order paid', 'librepay-woo'),
                    'type'        => 'select',
                    'description' => __('“On first confirmation” delivers faster (2 confirmations by default, instant for Lightning). “On settlement” waits for deep finality (6+).', 'librepay-woo'),
                    'options'     => [
                        'confirmed' => __('On first confirmation (faster)', 'librepay-woo'),
                        'settled'   => __('On settlement (safest)', 'librepay-woo'),
                    ],
                    'default'     => 'confirmed',
                    'desc_tip'    => false,
                ],
                'expiry_minutes' => [
                    'title'       => __('Invoice expiry (minutes)', 'librepay-woo'),
                    'type'        => 'number',
                    'custom_attributes' => ['min' => '0', 'max' => '120'],
                    'description' => __('0 = use the node default. Fresh Bitcoin price + address after expiry.', 'librepay-woo'),
                    'default'     => '0',
                ],
                'on_expiry' => [
                    'title'       => __('When invoice expires', 'librepay-woo'),
                    'type'        => 'select',
                    'description' => __('A late payment still revives the order — nothing is lost.', 'librepay-woo'),
                    'options'     => [
                        'failed'    => __('Mark order failed (buyer can retry)', 'librepay-woo'),
                        'cancelled' => __('Cancel order', 'librepay-woo'),
                        'hold'      => __('Keep pending (manual review)', 'librepay-woo'),
                    ],
                    'default'     => 'failed',
                ],
                'on_underpaid' => [
                    'title'       => __('When payment is underpaid', 'librepay-woo'),
                    'type'        => 'select',
                    'description' => __('Underpaid = more than 1% short after confirmations. You can always refund from your own wallet.', 'librepay-woo'),
                    'options'     => [
                        'hold' => __('Put order on-hold for review', 'librepay-woo'),
                        'note' => __('Add an order note only', 'librepay-woo'),
                    ],
                    'default'     => 'hold',
                ],
                'advanced' => [
                    'title'       => __('3 · Advanced', 'librepay-woo'),
                    'type'        => 'title',
                ],
                'enable_logging' => [
                    'title'       => __('Debug log', 'librepay-woo'),
                    'type'        => 'checkbox',
                    'label'       => __('Log LibrePay requests and webhook events (WooCommerce → Status → Logs, source “librepay”)', 'librepay-woo'),
                    'default'     => 'no',
                ],
            ];
        }

        /** Custom settings row: the connection-test button. */
        public function generate_librepay_test_html()
        {
            ob_start();
            ?>
            <tr valign="top">
                <th scope="row" class="titledesc"><?php esc_html_e('Test connection', 'librepay-woo'); ?></th>
                <td class="forminp">
                    <button type="button" class="button button-secondary" id="librepay-test-btn">
                        <?php esc_html_e('Test connection', 'librepay-woo'); ?>
                    </button>
                    <span id="librepay-test-result" style="margin-inline-start:8px;font-weight:600;"></span>
                    <p class="description">
                        <?php esc_html_e('Checks that the node URL is reachable, the API key is valid, and a wallet is configured — in one call.', 'librepay-woo'); ?>
                    </p>
                </td>
            </tr>
            <?php
            return ob_get_clean();
        }

        public function admin_test_script()
        {
            $screen = function_exists('get_current_screen') ? get_current_screen() : null;
            if (!$screen || strpos((string) $screen->id, 'woocommerce_page_wc-settings') === false) {
                return;
            }
            ?>
            <script>
            (function () {
                var btn = document.getElementById('librepay-test-btn');
                if (!btn) return;
                btn.addEventListener('click', function () {
                    var out = document.getElementById('librepay-test-result');
                    out.textContent = '…'; out.style.color = '';
                    var base = document.querySelector('input[name$="librepay_api_base"]'),
                        key  = document.querySelector('input[name$="librepay_api_key"]');
                    jQuery.post(woocommerce_admin.ajax_url, {
                        action: 'librepay_woo_test',
                        nonce: '<?php echo esc_js(wp_create_nonce('librepay_woo_test')); ?>',
                        api_base: base ? base.value : '',
                        api_key: key ? key.value : ''
                    }).done(function (r) {
                        var d = r.data || {};
                        if (r.success) {
                            out.textContent = '✓ ' + d.message;
                            out.style.color = 'green';
                        } else {
                            out.textContent = '✗ ' + d.message;
                            out.style.color = '#c0392b';
                        }
                    }).fail(function () {
                        out.textContent = '✗ <?php echo esc_js(__('request failed', 'librepay-woo')); ?>';
                        out.style.color = '#c0392b';
                    });
                });
            })();
            </script>
            <?php
        }

        /** One call verifies URL + key + wallet: GET {node}/api/system/status (Bearer). */
        public function ajax_test_connection()
        {
            if (!current_user_can('manage_woocommerce') || !check_ajax_referer('librepay_woo_test', 'nonce', false)) {
                wp_send_json_error(['message' => __('forbidden', 'librepay-woo')], 403);
            }
            // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- nonce checked above
            $base = untrailingslashit(trim((string) ($_POST['api_base'] ?? '')));
            $key  = trim((string) ($_POST['api_key'] ?? ''));
            if ($base === '' || $key === '') {
                wp_send_json_error(['message' => __('node URL and API key are required', 'librepay-woo')]);
            }
            if (!preg_match('#^https?://#i', $base)) {
                wp_send_json_error(['message' => __('node URL must start with http(s)://', 'librepay-woo')]);
            }
            $res = wp_remote_get($base . '/api/system/status', [
                'timeout' => 15,
                'headers' => ['authorization' => 'Bearer ' . $key, 'accept' => 'application/json'],
            ]);
            if (is_wp_error($res)) {
                wp_send_json_error(['message' => $res->get_error_message()]);
            }
            $code = (int) wp_remote_retrieve_response_code($res);
            $body = json_decode(wp_remote_retrieve_body($res), true);
            if ($code === 401) {
                wp_send_json_error(['message' => __('API key rejected — copy it again from the node console', 'librepay-woo')]);
            }
            if ($code !== 200) {
                wp_send_json_error(['message' => sprintf(__('HTTP %s from node', 'librepay-woo'), $code)]);
            }
            $wallet = !empty($body['wallet']) && !empty($body['wallet']['configured']) ? 'wallet OK' : __('NO WALLET CONFIGURED — run the node setup wizard', 'librepay-woo');
            $store  = isset($body['store']['name']) ? $body['store']['name'] : '';
            wp_send_json_success([
                'message' => trim(sprintf(__('connected to %1$s (%2$s)', 'librepay-woo'), $store, $wallet)),
                'body'    => $body,
            ]);
        }

        private function log($level, $message, $context = [])
        {
            if ($this->enable_logging !== 'yes' || !function_exists('wc_get_logger')) {
                return;
            }
            wc_get_logger()->log($level, $message, array_merge(['source' => 'librepay'], $context));
        }

        // ── checkout ─────────────────────────────────────────────────────────

        public function process_payment($order_id)
        {
            $order = wc_get_order($order_id);
            if (!$order) {
                wc_add_notice(__('Order not found.', 'librepay-woo'), 'error');
                return ['result' => 'failure'];
            }
            if ($this->api_key === '' || $this->api_base === '') {
                wc_add_notice(__('Bitcoin payments are not configured — contact the store.', 'librepay-woo'), 'error');
                return ['result' => 'failure'];
            }

            // 1) reuse a still-open invoice for this order (buyer retry / refresh)
            $reuse = $this->open_invoice_for_order($order);
            if ($reuse !== null) {
                $this->log('info', "reusing open invoice {$reuse['id']} for order {$order->get_id()}");
                return $this->complete_redirect($order, $reuse['checkout']);
            }

            // 2) create — idempotent per attempt. Reaching this line means any
            //    previous invoice for the order is no longer open (expired/failed),
            //    so bump the attempt counter: fresh idempotency key → fresh
            //    invoice, and the old key can never replay a dead invoice.
            $attempt = (int) $order->get_meta(self::META_ATTEMPT);
            if ((string) $order->get_meta(self::META_INVOICE) !== '') {
                $attempt++;
                $order->update_meta_data(self::META_ATTEMPT, $attempt);
            }
            $payload = [
                'amountFiat'  => (float) $order->get_total(),
                'currency'    => strtoupper($order->get_currency()),
                'orderId'     => (string) $order->get_id(),
                'description' => sprintf(
                    /* translators: 1: order number 2: blog name */
                    __('Order #%1$s at %2$s', 'librepay-woo'),
                    $order->get_order_number(),
                    get_bloginfo('name')
                ),
                'metadata'    => [
                    'order_key'    => $order->get_order_key(),
                    'attempt'      => $attempt,
                    'site'         => home_url(),
                ],
            ];
            if ($this->expiry_minutes !== '0' && (int) $this->expiry_minutes > 0) {
                $payload['expiresInMinutes'] = (int) $this->expiry_minutes;
            }

            $res = wp_remote_post($this->api_base . '/api/v1/invoices', [
                'timeout' => 30,
                'headers' => [
                    'authorization'   => 'Bearer ' . $this->api_key,
                    'content-type'    => 'application/json',
                    'idempotency-key' => sprintf('wc-%d-%d', $order->get_id(), $attempt),
                ],
                'body'    => wp_json_encode($payload),
            ]);

            if (is_wp_error($res)) {
                $this->log('error', 'create failed: ' . $res->get_error_message());
                wc_add_notice(__('Could not reach LibrePay. Please try again.', 'librepay-woo') . ' (' . $res->get_error_message() . ')', 'error');
                return ['result' => 'failure'];
            }

            $code = (int) wp_remote_retrieve_response_code($res);
            $body = json_decode(wp_remote_retrieve_body($res), true);
            if ($code !== 201 || empty($body['invoice']['id'])) {
                $msg = isset($body['error']) ? sanitize_text_field(wp_unslash($body['error'])) : __('Unexpected LibrePay response.', 'librepay-woo');
                $this->log('error', "create HTTP {$code}: {$msg}");
                wc_add_notice(__('Bitcoin payment error: ', 'librepay-woo') . $msg, 'error');
                return ['result' => 'failure'];
            }

            $invoice_id = sanitize_text_field($body['invoice']['id']);
            $checkout   = isset($body['checkoutUrl']) ? esc_url_raw($body['checkoutUrl']) : $this->api_base . '/pay/' . rawurlencode($invoice_id);
            $expires    = isset($body['invoice']['expiresAt']) ? sanitize_text_field($body['invoice']['expiresAt']) : '';

            if ((string) $order->get_meta(self::META_INVOICE) !== $invoice_id) {
                $order->add_order_note(__('LibrePay invoice created: ', 'librepay-woo') . $invoice_id);
            }
            $order->update_status('pending', __('Awaiting Bitcoin payment.', 'librepay-woo'));
            $order->update_meta_data(self::META_INVOICE, $invoice_id);
            $order->update_meta_data(self::META_CHECKOUT, $checkout);
            $order->update_meta_data(self::META_EXPIRES, $expires);
            $order->update_meta_data(self::META_MARK_AT, $this->mark_paid_at);
            $order->save();

            return $this->complete_redirect($order, $checkout);
        }

        /** Common tail of process_payment: empty cart + redirect. */
        private function complete_redirect($order, $checkout)
        {
            if (WC()->cart) {
                WC()->cart->empty_cart();
            }
            return ['result' => 'success', 'redirect' => $checkout];
        }

        /**
         * Returns ['id' => …, 'checkout' => …] when the order still holds an
         * OPEN invoice at the node, else null (→ mint a fresh one).
         */
        private function open_invoice_for_order($order)
        {
            $invoice_id = (string) $order->get_meta(self::META_INVOICE);
            if ($invoice_id === '' || $order->is_paid()) {
                return null;
            }
            $res = wp_remote_get($this->api_base . '/api/v1/invoices/' . rawurlencode($invoice_id), [
                'timeout' => 15,
                'headers' => ['authorization' => 'Bearer ' . $this->api_key, 'accept' => 'application/json'],
            ]);
            if (is_wp_error($res) || (int) wp_remote_retrieve_response_code($res) !== 200) {
                return null;
            }
            $inv = json_decode(wp_remote_retrieve_body($res), true);
            $inv = isset($inv['invoice']) ? $inv['invoice'] : null;
            if (!$inv || !in_array($inv['status'] ?? '', ['waiting', 'detected'], true)) {
                return null;
            }
            $checkout = (string) $order->get_meta(self::META_CHECKOUT);
            if ($checkout === '') {
                $checkout = $this->api_base . '/pay/' . rawurlencode($invoice_id);
            }
            return ['id' => $invoice_id, 'checkout' => $checkout];
        }

        // ── webhook ──────────────────────────────────────────────────────────

        /** Verify HMAC-SHA256 of the RAW body (timing-safe). */
        private function verify_signature($raw_body)
        {
            if ($this->webhook_secret === '') {
                return false;
            }
            $sig = isset($_SERVER['HTTP_X_LIBREPAY_SIGNATURE']) ? sanitize_text_field(wp_unslash($_SERVER['HTTP_X_LIBREPAY_SIGNATURE'])) : '';
            if (strpos($sig, 'sha256=') !== 0) {
                return false;
            }
            $expected = 'sha256=' . hash_hmac('sha256', $raw_body, $this->webhook_secret);
            return hash_equals($expected, $sig);
        }

        /** Reject deliveries older than 10 minutes (replay guard). */
        private function verify_freshness()
        {
            $ts = isset($_SERVER['HTTP_X_LIBREPAY_TIMESTAMP']) ? (int) $_SERVER['HTTP_X_LIBREPAY_TIMESTAMP'] : 0;
            if ($ts <= 0) {
                return true; // node always sends it; tolerate odd proxies
            }
            $skew = abs((time() * 1000) - $ts);
            return $skew <= 10 * 60 * 1000;
        }

        public function handle_webhook()
        {
            $raw = (string) file_get_contents('php://input');

            if (!$this->verify_signature($raw)) {
                $this->log('warning', 'webhook rejected: invalid signature');
                status_header(401);
                nocache_woocommerce();
                header('content-type: application/json');
                echo json_encode(['error' => 'invalid_signature']);
                exit;
            }
            if (!$this->verify_freshness()) {
                $this->log('warning', 'webhook rejected: stale timestamp');
                status_header(400);
                header('content-type: application/json');
                echo json_encode(['error' => 'stale_timestamp']);
                exit;
            }

            $event = json_decode($raw, true);
            if (!is_array($event) || empty($event['event']) || empty($event['invoiceId'])) {
                status_header(400);
                header('content-type: application/json');
                echo json_encode(['error' => 'bad_payload']);
                exit;
            }

            $name       = (string) $event['event'];
            $invId      = sanitize_text_field((string) $event['invoiceId']);
            $deliveryId = isset($_SERVER['HTTP_X_LIBREPAY_DELIVERY_ID'])
                ? sanitize_text_field(wp_unslash($_SERVER['HTTP_X_LIBREPAY_DELIVERY_ID']))
                : $invId . ':' . $name;

            $this->log('info', "webhook {$name} delivery {$deliveryId} invoice {$invId}");

            $orders = wc_get_orders([
                'limit'      => 5,
                'meta_query' => [['key' => self::META_INVOICE, 'value' => $invId, 'compare' => '=']],
            ]);
            if (empty($orders)) {
                // legacy (pre-HPOS) stores: retry with the classic meta args
                $orders = wc_get_orders(['limit' => 5, 'meta_key' => self::META_INVOICE, 'meta_value' => $invId]);
            }
            header('content-type: application/json');
            if (empty($orders)) {
                echo json_encode(['ok' => true, 'unknown_order' => true]);
                exit;
            }
            /** @var WC_Order $order */
            $order = $orders[0];

            // at-least-once delivery → dedupe on the delivery id
            if ($order->get_meta('_librepay_delivery_' . $deliveryId) === '1') {
                echo json_encode(['ok' => true, 'duplicate' => true]);
                exit;
            }
            $order->update_meta_data('_librepay_delivery_' . $deliveryId, '1');

            $inv   = isset($event['data']['invoice']) && is_array($event['data']['invoice']) ? $event['data']['invoice'] : [];
            $txid  = isset($inv['txid']) ? sanitize_text_field((string) $inv['txid']) : '';
            $rail  = isset($inv['paymentMethod']) ? sanitize_text_field((string) $inv['paymentMethod']) : 'onchain';
            $railN = $rail === 'lightning' ? __('Lightning', 'librepay-woo') : __('on-chain', 'librepay-woo');

            switch ($name) {
                case 'invoice.detected':
                    if (!$order->is_paid() && $order->has_status('pending')) {
                        $order->add_order_note(sprintf(
                            /* translators: 1: payment rail */
                            __('LibrePay: payment seen on the %1$s network — waiting for confirmations.', 'librepay-woo'),
                            $railN
                        ));
                    }
                    break;

                case 'invoice.confirmed':
                case 'invoice.settled':
                    $is_settled = ($name === 'invoice.settled');
                    if ($this->mark_paid_at === 'settled' && !$is_settled && !$order->is_paid()) {
                        $order->add_order_note(__('LibrePay: payment confirmed — waiting for settlement before marking paid (per store settings).', 'librepay-woo'));
                        break;
                    }
                    if (!$order->is_paid()) {
                        // revive failed/cancelled orders when a late payment lands
                        if ($order->has_status(['failed', 'cancelled'])) {
                            $order->update_status('pending', __('LibrePay: late payment received — order re-opened.', 'librepay-woo'));
                        }
                        $order->payment_complete($txid !== '' ? $txid : $invId);
                        $order->add_order_note(sprintf(
                            /* translators: 1: confirmed|settled 2: rail 3: txid */
                            __('LibrePay: payment %1$s via %2$s.%3$s', 'librepay-woo'),
                            $is_settled ? 'settled (6+ confirmations)' : 'confirmed',
                            $railN,
                            $txid !== '' ? ' TX: ' . $txid : ''
                        ));
                        $order->update_meta_data(self::META_PAID, 'yes');
                    }
                    break;

                case 'invoice.expired':
                    if (!$order->is_paid() && $order->has_status('pending')) {
                        if ($this->on_expiry === 'cancelled') {
                            $order->update_status('cancelled', __('LibrePay: invoice expired unpaid — order cancelled. A retry mints a fresh invoice and price.', 'librepay-woo'));
                        } elseif ($this->on_expiry === 'hold') {
                            $order->add_order_note(__('LibrePay: invoice expired unpaid — order left pending for manual review.', 'librepay-woo'));
                        } else {
                            $order->update_status('failed', __('LibrePay: invoice expired unpaid. The buyer can retry checkout for a fresh invoice.', 'librepay-woo'));
                        }
                        // next checkout attempt must NOT reuse the dead invoice:
                        $attempt = (int) $order->get_meta(self::META_ATTEMPT);
                        $order->update_meta_data(self::META_ATTEMPT, $attempt + 1);
                    }
                    break;

                case 'invoice.underpaid':
                    if (!$order->is_paid()) {
                        if ($this->on_underpaid === 'hold') {
                            if (!$order->has_status('on-hold')) {
                                $order->update_status('on-hold', __('LibrePay: payment underpaid beyond tolerance — held for review. Decide: accept, or refund from your wallet.', 'librepay-woo'));
                            } else {
                                $order->add_order_note(__('LibrePay: underpaid payment update received.', 'librepay-woo'));
                            }
                        } else {
                            $order->add_order_note(__('LibrePay: payment underpaid beyond tolerance — review in the node dashboard.', 'librepay-woo'));
                        }
                    }
                    break;

                default:
                    break; // unknown/future events are acknowledged silently
            }

            $order->save();
            echo json_encode(['ok' => true]);
            exit;
        }

        // ── buyer-facing surfaces ────────────────────────────────────────────

        /** "Complete your payment" button for unpaid orders (thank-you + My Account). */
        public function pay_button_html($order)
        {
            if (!$order || $order->get_payment_method() !== $this->id || $order->is_paid()) {
                return;
            }
            $checkout = (string) $order->get_meta(self::META_CHECKOUT);
            if ($checkout === '') {
                return;
            }
            echo '<section class="librepay-resume" style="margin:1.5em 0;text-align:center">'
                . '<p>' . esc_html__('Your Bitcoin payment is still open — the price is locked until the invoice expires.', 'librepay-woo') . '</p>'
                . '<a class="button" href="' . esc_url($checkout) . '" target="_blank" rel="noopener">'
                . esc_html__('Complete Bitcoin payment', 'librepay-woo') . '</a></section>';
        }

        public function thankyou_page($order_id)
        {
            $order = wc_get_order($order_id);
            if (!$order) {
                return;
            }
            echo '<section class="librepay-thankyou"><p>'
                . esc_html__('Paying with Bitcoin? Complete it in the payment window you were redirected to — on-chain takes minutes, Lightning seconds. Your order updates itself automatically.', 'librepay-woo')
                . '</p></section>';
            $this->pay_button_html($order);
        }

        public function account_pay_button($order)
        {
            $this->pay_button_html($order);
        }

        // ── admin orders list ────────────────────────────────────────────────

        public function column_header($columns)
        {
            $columns['librepay'] = esc_html__('Bitcoin', 'librepay-woo');
            return $columns;
        }

        public function column_content($column, $order_id)
        {
            if ($column !== 'librepay') {
                return;
            }
            $this->render_column(wc_get_order($order_id));
        }

        public function column_content_hpos($column, $order)
        {
            if ($column !== 'librepay') {
                return;
            }
            $this->render_column(is_object($order) && method_exists($order, 'get_id') ? $order : wc_get_order($order));
        }

        private function render_column($order)
        {
            if (!$order || $order->get_payment_method() !== $this->id) {
                echo '—';
                return;
            }
            $invId   = (string) $order->get_meta(self::META_INVOICE);
            $paid    = $order->is_paid();
            $checkout = (string) $order->get_meta(self::META_CHECKOUT);
            echo $paid
                ? '<span style="color:green">✓</span>'
                : '<span dir="ltr" style="font-size:11px">' . ($invId !== '' ? esc_html($invId) : '—') . '</span>';
            if (!$paid && $checkout !== '') {
                echo '<br><a href="' . esc_url($checkout) . '" target="_blank" rel="noopener">' . esc_html__('open payment', 'librepay-woo') . '</a>';
            }
        }

        /** Order preview (admin list popup): expose the checkout URL. */
        public function preview_payment_link($data, $order)
        {
            if ($order && $order->get_payment_method() === $this->id) {
                $checkout = (string) $order->get_meta(self::META_CHECKOUT);
                if ($checkout !== '') {
                    $data['payment_url'] = $checkout;
                }
            }
            return $data;
        }
    }

    add_filter('woocommerce_payment_gateways', function ($gateways) {
        $gateways[] = 'WC_Gateway_LibrePay';
        return $gateways;
    });
}
