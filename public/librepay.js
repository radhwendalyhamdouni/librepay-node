/**
 * LibrePay embed widget — one <script> + one <button> on any site.
 *
 *   <script src="https://your-domain.com/librepay.js" data-api="https://your-domain.com"></script>
 *   <button class="librepay-button" data-amount-sats="42000" data-order-id="o-42"
 *           data-description="Coffee" data-currency="USD" data-amount-fiat="27.5">Pay</button>
 *
 * Creates the invoice through the merchant's API key (server-side proxy) and
 * opens the hosted checkout in a popup. No customer data is collected here.
 */
(function () {
  "use strict";

  var script =
    document.currentScript ||
    (function () {
      var all = document.getElementsByTagName("script");
      for (var i = all.length - 1; i >= 0; i--) if (all[i].src.indexOf("librepay.js") !== -1) return all[i];
      return null;
    })();

  var API = (script && script.getAttribute("data-api")) || "";

  function openCheckout(invoiceId) {
    var base = API || window.location.origin;
    var w = 460, h = 720;
    var y = window.top.outerHeight / 2 + window.top.screenY - h / 2;
    var x = window.top.outerWidth / 2 + window.top.screenX - w / 2;
    window.open(base + "/pay/" + invoiceId, "librepay-checkout", "popup=yes,width=" + w + ",height=" + h + ",left=" + x + ",top=" + y);
  }

  function createInvoice(btn) {
    var body = {};
    if (btn.getAttribute("data-amount-sats")) body.amountSats = parseInt(btn.getAttribute("data-amount-sats"), 10);
    if (btn.getAttribute("data-amount-fiat")) body.amountFiat = parseFloat(btn.getAttribute("data-amount-fiat"));
    if (btn.getAttribute("data-currency")) body.currency = btn.getAttribute("data-currency");
    if (btn.getAttribute("data-order-id")) body.orderId = btn.getAttribute("data-order-id");
    if (btn.getAttribute("data-description")) body.description = btn.getAttribute("data-description");
    if (btn.getAttribute("data-expires")) body.expiresInMinutes = parseInt(btn.getAttribute("data-expires"), 10);
    if (btn.getAttribute("data-lang")) body.buyerLang = btn.getAttribute("data-lang");

    // The widget calls the public invoice creation through the merchant's own
    // site backend URL (set data-api-endpoint="/api/librepay/create-invoice"
    // on a server route that forwards with the API key — keeps keys private).
    var endpoint = btn.getAttribute("data-api-endpoint") || "/api/librepay/create-invoice";
    var base = btn.getAttribute("data-api-base") || "";

    fetch(base + endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (d) {
        if (d.checkoutUrl) window.open(d.checkoutUrl, "_blank");
        else if (d.invoice && d.invoice.id) openCheckout(d.invoice.id);
        else throw new Error("bad response");
      })
      .catch(function (err) {
        console.error("[librepay] invoice creation failed:", err);
      });
  }

  function bind() {
    var buttons = document.querySelectorAll(".librepay-button");
    for (var i = 0; i < buttons.length; i++) {
      (function (btn) {
        if (btn.__librepayBound) return;
        btn.__librepayBound = true;
        btn.addEventListener("click", function (e) {
          e.preventDefault();
          createInvoice(btn);
        });
      })(buttons[i]);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
  window.__librepayRebind = bind;
})();
