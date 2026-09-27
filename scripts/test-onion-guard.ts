/** Sanity test for the v3-onion allowance in the SSRF guard (run: bun scripts/test-onion-guard.ts). */
import { guardOutboundUrl } from "../src/lib/server/ssrf-guard";

const ONION = "a".repeat(55) + "b"; // exactly 56 base32 chars
if ((ONION + ".onion").length !== 62 || !/^[a-z2-7]{56}$/.test(ONION)) throw new Error("bad test fixture");

const cases: Array<[string, boolean]> = [
  // valid v3 onion, http + https + port → allowed (transport = onion protocol)
  [`http://${ONION}.onion/api/webhooks`, true],
  [`https://${ONION}.onion/api/webhooks`, true],
  [`http://${ONION}.onion:8080/hook`, true],
  // clearnet http → still rejected
  ["http://shop.example.com/webhook", false],
  // private IP / loopback → still rejected (outside dev)
  ["http://192.168.1.10/webhook", false],
  ["http://localhost:8080/webhook", false],
  // impostor hosts that merely END in .onion → rejected (not real v3 addresses)
  ["https://internal.local.onion/webhook", false],
  ["http://169.254.169.254.onion/", false],
  ["http://short.onion/", false],
  // a normal https domain that merely CONTAINS ".onion" in its name is a
  // perfectly legal webhook destination (same as https://shop.example.com)
  [`https://${ONION}.onion.evil.example.com/`, true],
];

let failed = 0;
for (const [url, expectOk] of cases) {
  const g = guardOutboundUrl(url);
  const ok = g.ok === expectOk;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${g.ok ? "allowed " : "blocked "} ← ${url.slice(0, 80)}`);
}
console.log(failed === 0 ? "ALL PASS" : `${failed} FAILURES`);
process.exit(failed === 0 ? 0 : 1);
