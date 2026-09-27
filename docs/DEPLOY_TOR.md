# Deploying LibrePay Node on Tor

Yes — the node is a standard HTTP server, so it runs perfectly as a Tor v3
hidden service. You get: no domain to buy, no CA, no DNS, hosting
takedown-resistance, and buyers/operators who never reveal their IP to the
node's network position. This guide covers both realistic architectures and
the small details that matter (cookies, webhooks, chain-data privacy).

---

## 1. Pick your architecture

| | A — clearnet + onion mirror ⭐ recommended | B — onion-only |
|---|---|---|
| Buyers pay via | clearnet domain (fast) **or** .onion | .onion only (Tor Browser) |
| Console access | .onion mirror (censorship-proof admin) | .onion |
| Webhooks to shops | normal clearnet HTTP | needs clearnet egress or tor DNS (§4) |
| Fits | normal stores that want a hardened admin | high-risk merchants, donation pages |

**A** is what BTCPay deployments typically do and what we recommend: keep the
public checkout on clearnet HTTPS for speed, and expose the same node on an
onion address that only you (and optionally privacy-minded buyers) use.

**B** is fully supported — the node generates `checkoutUrl` from the incoming
request host when `LP_BASE_URL` is unset, so invoices created via the onion
address automatically carry onion checkout links.

---

## 2. Quick start (architecture A or B)

```bash
apt install tor

# drop in the hidden service config
cp deploy/torrc.example /etc/tor/torrc.d/librepay.conf   # or append to /etc/tor/torrc
systemctl reload tor

# your onion address (56 chars, v3)
cat /var/lib/tor/librepay-node/hostname
# → e.g. lptn7x…uyjkyd.onion
```

Point tor at the node's local port (already in the example config):

```
HiddenServiceDir /var/lib/tor/librepay-node/
HiddenServicePort 80 127.0.0.1:3000
```

Then make sure the node itself is NOT reachable from the internet directly:

```bash
ufw deny 3000/tcp        # only tor (localhost) may talk to the node
```

Open `http://<your-56-char-onion>/` in Tor Browser — you should see the
landing page. The console, checkout, and docs all work identically.

### Cookies & sessions — already Tor-safe

- Session cookies are `HttpOnly; SameSite=Lax` and the `Secure` attribute is
  added **only** when the request arrived over https. Over `http://….onion`
  the cookie is still set correctly, and that is fine: Tor v3 transport is
  end-to-end encrypted and authenticated by the onion protocol itself —
  the "http" inside Tor is **not** cleartext.
- Operators should always use **Tor Browser** for console access over onion.

### Console hardening for onion-only admins

- Enable **TOTP 2FA** in the console (Security card) — mandatory habit for
  onion-only setups.
- Consider v3 **client authorization** (uncomment in torrc + `tor --keygen`):
  then even the *existence* of your node is hidden from anyone without your
  client key. Your console becomes a secret service, not just a private one.

---

## 3. Onion-Location (auto-offer the mirror)

If you run architecture A, set in `.env`:

```
LP_ONION_URL=http://lptn7x…uyjkyd.onion
```

Every clearnet page response then carries `Onion-Location`, and Tor Browser
will offer to switch to the onion version automatically (same behavior as
BTCPay's onion mirror). Restart the node after changing the env.

---

## 4. Webhooks when the shop or the node lives on Tor

Outbound webhook destinations accept **both** `https://….onion` and
`http://….onion` (the SSRF guard treats v3 onion hosts as safe-by-design —
the hostname is the public key; there is no DNS to rebind). Reaching them
depends on where the node runs:

- **Node on clearnet, shop on Tor** → the node must resolve `.onion`. Enable
  tor's local DNS resolver:

  ```
  # /etc/tor/torrc
  DNSPort 127.0.0.1:5353
  AutomapHostsOnResolve 1
  ```

  and route the node's DNS through it (systemd-resolved drop-in, or set the
  VPS resolver to 127.0.0.1:5353 for the node's service). Simpler alternative:
  run architecture A and register the shop's **clearnet** webhook URL.
- **Node onion-only** → give the node clearnet egress *just* for webhooks
  (most Tor-hosted VPS providers offer this), or the merchant shop must also
  be reachable as `.onion`.

Failed deliveries are retried with the normal backoff (1m → 24h, ~8 attempts)
and land in the security log if they die — nothing is silently lost.

---

## 5. Chain-data privacy (the detail everyone forgets)

The node polls an Esplora API for confirmations and prices
(`ESPLORA_API`, default `https://mempool.space/api`). On an onion-only server
that traffic either fails or deanonymizes you to the explorer. Fix it with
one of:

1. **Self-host the explorer** (best guarantee): bitcoind + Fulcrum/ElectRS +
   mempool — then `ESPLORA_API=http://127.0.0.1:…/api`. Fully independent,
   zero third parties. This is the gold standard BTCPay itself uses.
2. **Onion Esplora**: point `ESPLORA_API` at a `.onion` Esplora endpoint
   (mempool.space publishes an official v3 address — verify it on their site)
   and let the node resolve it via tor DNS from §4.
3. **Architecture A**: keep the clearnet VPS as-is (explorer traffic goes out
   normal HTTPS; your node IP is a datacenter IP anyway, not your identity).

---

## 6. Threat model — what Tor does and doesn't buy you

| Protected by Tor | Still your responsibility |
|---|---|
| Server IP hidden from buyers & observers | API key / console password / 2FA hygiene |
| No domain registration trail, no CA | A compromised browser (use Tor Browser) |
| Hosting takedown-resistance (content, not legal) | Legal reality of your jurisdiction |
| Buyer IP hidden from the merchant & node network | Chain analysis of payment flows (use BIP47 stealth mode / own explorer) |
| Webhook payloads in transit (onion crypto) | Merchant-side webhook signature checks |

Tor protects transport and location. The crypto hygiene (keys, 2FA, signature
verification, step-up) is layered on top by the node itself — see
[SECURITY.md](SECURITY.md).

---

## 7. systemd wiring

Use [deploy/librepay-node.service](../deploy/librepay-node.service). For
architecture B add `After=tor.service` / `Wants=tor.service` so the node only
starts once the onion service is up. The unit runs with `ProtectSystem=strict`,
no capabilities and a private `/tmp`; the only writable path is the data dir.
