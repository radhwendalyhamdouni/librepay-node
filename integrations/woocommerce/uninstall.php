<?php
/**
 * LibrePay for WooCommerce — uninstall cleanup.
 * Removes the gateway settings; order meta is history and stays.
 */

if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}

delete_option('woocommerce_librepay_settings');
