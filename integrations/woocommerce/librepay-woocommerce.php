<?php
/**
 * Plugin Name:       LibrePay for WooCommerce
 * Plugin URI:        https://librepay.app
 * Description:       Accept Bitcoin (on-chain + Lightning) with LibrePay — privacy-first, non-custodial, no KYC, 0% transaction fees. Orders sync automatically via signed webhooks.
 * Version:           1.0.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            LibrePay
 * License:           MIT
 * Text Domain:       librepay-woo
 * WC requires at least: 7.0
 * WC tested up to:   9.0
 *
 * Non-custodial: payments go directly from the buyer's wallet to YOUR wallet.
 * This plugin only creates invoices (via your LibrePay API key) and listens
 * for HMAC-signed webhooks to mark orders paid.
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

    class WC_Gateway_LibrePay extends WC_Payment_Gateway
    {
        /** @var string */
        public $api_key;
        /** @var string */
        public $api_base;
        /** @var string */
        public $webhook_secret;
        /** @var string */
        public $mark_paid_at; // confirmed | settled

        public function __construct()
        {
            $this->id                 = 'librepay';
            $this->icon               = apply_filters('librepay_woo_icon', '');
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
            $this->api_key        = $this->get_option('api_key');
            $this->api_base       = untrailingslashit($this->get_option('api_base'));
            $this->webhook_secret = $this->get_option('webhook_secret');
            $this->mark_paid_at   = $this->get_option('mark_paid_at', 'confirmed');

            add_action('woocommerce_update_options_payment_gateways_' . $this->id, [$this, 'process_admin_options']);
            add_action('woocommerce_api_librepay_webhook', [$this, 'handle_webhook']);
            add_action('woocommerce_thankyou_' . $this->id, [$this, 'thankyou_page']);
        }

        public function init_form_fields()
        {
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
                'api_base' => [
                    'title'       => __('LibrePay URL', 'librepay-woo'),
                    'type'        => 'url',
                    'description' => __('Your LibrePay instance base URL.', 'librepay-woo'),
                    'default'     => 'https://app.librepay.app',
                    'desc_tip'    => true,
                ],
                'api_key' => [
                    'title'       => __('API key', 'librepay-woo'),
                    'type'        => 'password',
                    'description' => __('Create one in LibrePay → Dashboard → API Keys (starts with lp_live_).', 'librepay-woo'),
                    'desc_tip'    => true,
                ],
                'webhook_secret' => [
                    'title'       => __('Webhook secret', 'librepay-woo'),
                    'type'        => 'password',
                    'description' => __('From LibrePay → Dashboard → Webhooks. Required to verify signed events. Webhook URL: ' . home_url('/wc-api/librepay_webhook'), 'librepay-woo'),
                    'desc_tip'    => false,
                ],
                'mark_paid_at' => [
                    'title'       => __('Mark order paid', 'librepay-woo'),
                    'type'        => 'select',
                    'description' => __('"On first confirmation" delivers faster (higher 0-conf risk). "On settlement" waits for deep confirmations (safest).', 'librepay-woo'),
                    'options'     => [
                        'confirmed' => __('On first confirmation (faster)', 'librepay-woo'),
                        'settled'   => __('On settlement (safest)', 'librepay-woo'),
                    ],
                    'default'     => 'confirmed',
                    'desc_tip'    => false,
                ],
            ];
        }

        public function process_payment($order_id)
        {
            $order = wc_get_order($order_id);
            if (!$order) {
                wc_add_notice(__('Order not found.', 'librepay-woo'), 'error');
                return ['result' => 'failure'];
            }

            $payload = [
                'amountFiat' => (float) $order->get_total(),
                'currency'   => strtoupper($order->get_currency()),
                'orderId'    => (string) $order->get_id(),
                'description' => sprintf(
                    /* translators: 1: blog name */
                    __('Order #%1$s at %2$s', 'librepay-woo'),
                    $order->get_order_number(),
                    get_bloginfo('name')
                ),
                'metadata'   => [
                    'order_key'   => $order->get_order_key(),
                    'customer_ip' => $order->get_customer_ip_address(),
                ],
            ];

            $res = wp_remote_post($this->api_base . '/api/v1/invoices', [
                'timeout' => 30,
                'headers' => [
                    'authorization' => 'Bearer ' . $this->api_key,
                    'content-type'  => 'application/json',
                ],
                'body'    => wp_json_encode($payload),
            ]);

            if (is_wp_error($res)) {
                wc_add_notice(__('Could not reach LibrePay. Please try again.', 'librepay-woo') . ' (' . $res->get_error_message() . ')', 'error');
                return ['result' => 'failure'];
            }

            $code = (int) wp_remote_retrieve_response_code($res);
            $body = json_decode(wp_remote_retrieve_body($res), true);

            if ($code !== 201 || empty($body['invoice']['id'])) {
                $msg = isset($body['error']) ? sanitize_text_field(wp_unslash($body['error'])) : __('Unexpected LibrePay response.', 'librepay-woo');
                wc_add_notice(__('Bitcoin payment error: ', 'librepay-woo') . $msg, 'error');
                return ['result' => 'failure'];
            }

            $invoice_id = sanitize_text_field($body['invoice']['id']);
            $checkout   = isset($body['checkoutUrl']) ? esc_url_raw($body['checkoutUrl']) : $this->api_base . '/pay/' . rawurlencode($invoice_id);

            $order->update_status('pending', __('Awaiting Bitcoin payment (LibrePay invoice ', 'librepay-woo') . $invoice_id . ')');
            $order->add_order_note(__('LibrePay invoice created: ', 'librepay-woo') . $invoice_id);
            $order->update_meta_data('_librepay_invoice_id', $invoice_id);
            $order->update_meta_data('_librepay_mark_paid_at', $this->mark_paid_at);
            $order->save();

            // empty the cart — buyer is leaving for the payment page
            if (WC()->cart) {
                WC()->cart->empty_cart();
            }

            return [
                'result'   => 'success',
                'redirect' => $checkout,
            ];
        }

        /** Verify HMAC signature of the raw body. */
        private function verify_signature($raw_body)
        {
            if (empty($this->webhook_secret)) {
                return false;
            }
            $sig = isset($_SERVER['HTTP_X_LIBREPAY_SIGNATURE']) ? sanitize_text_field(wp_unslash($_SERVER['HTTP_X_LIBREPAY_SIGNATURE'])) : '';
            if (strpos($sig, 'sha256=') !== 0) {
                return false;
            }
            $expected = 'sha256=' . hash_hmac('sha256', $raw_body, $this->webhook_secret);
            return hash_equals($expected, $sig);
        }

        public function handle_webhook()
        {
            $raw = file_get_contents('php://input');

            if (!$this->verify_signature($raw)) {
                status_header(401);
                nocache_woocommerce();
                echo json_encode(['error' => 'invalid_signature']);
                exit;
            }

            $event = json_decode($raw, true);
            if (!$event || empty($event['event']) || empty($event['invoiceId'])) {
                status_header(400);
                echo json_encode(['error' => 'bad_payload']);
                exit;
            }

            $name  = $event['event'];
            $invId = sanitize_text_field($event['invoiceId']);

            // find order by invoice meta (fast indexed-ish lookup)
            $orders = wc_get_orders([
                'limit'      => 5,
                'meta_key'   => '_librepay_invoice_id',
                'meta_value' => $invId,
            ]);
            if (empty($orders)) {
                echo json_encode(['ok' => true, 'unknown_order' => true]);
                exit;
            }
            /** @var WC_Order $order */
            $order = $orders[0];

            // idempotency
            if ($order->get_meta('_librepay_settled') === 'yes') {
                echo json_encode(['ok' => true, 'duplicate' => true]);
                exit;
            }

            $method = $order->get_meta('_librepay_mark_paid_at') ?: $this->mark_paid_at;
            $txid   = isset($event['data']['invoice']['txid']) ? sanitize_text_field($event['data']['invoice']['txid']) : '';
            $rail   = isset($event['data']['invoice']['paymentMethod']) ? sanitize_text_field($event['data']['invoice']['paymentMethod']) : 'onchain';

            switch ($name) {
                case 'invoice.confirmed':
                case 'invoice.settled':
                    $is_settled = ($name === 'invoice.settled');
                    if ($method === 'settled' && !$is_settled) {
                        // wait for settlement
                        echo json_encode(['ok' => true, 'waiting_settlement' => true]);
                        exit;
                    }
                    if (!$order->is_paid()) {
                        $order->payment_complete($txid ?: $invId);
                        $order->add_order_note(sprintf(
                            /* translators: 1: event name 2: payment rail */
                            __('LibrePay: payment %1$s via %2$s.', 'librepay-woo'),
                            $is_settled ? 'settled' : 'confirmed',
                            'lightning' === $rail ? 'Lightning ⚡' : 'on-chain'
                        ));
                        $order->update_meta_data('_librepay_settled', 'yes');
                        $order->save();
                    }
                    break;

                case 'invoice.expired':
                    if (!$order->is_paid() && $order->has_status('pending')) {
                        $order->update_status('failed', __('LibrePay: invoice expired unpaid.', 'librepay-woo'));
                    }
                    break;

                case 'invoice.underpaid':
                    $order->add_order_note(__('LibrePay: payment detected but underpaid — review in dashboard.', 'librepay-woo'));
                    break;

                default:
                    // refund.* events are informational: refunds are manual & non-custodial
                    break;
            }

            echo json_encode(['ok' => true]);
            exit;
        }

        public function thankyou_page($order_id)
        {
            $order = wc_get_order($order_id);
            if (!$order) {
                return;
            }
            echo '<section class="librepay-thankyou"><p>'
                . esc_html__('Paying with Bitcoin? Complete it in the payment window you were redirected to — on-chain takes minutes, Lightning seconds.', 'librepay-woo')
                . '</p></section>';
        }
    }

    add_filter('woocommerce_payment_gateways', function ($gateways) {
        $gateways[] = 'WC_Gateway_LibrePay';
        return $gateways;
    });
}
