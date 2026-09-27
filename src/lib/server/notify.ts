/**
 * Notification stub — LibrePay Node has no merchant bell, no email.
 * The invoice engine calls these fire-and-forget hooks after settlement;
 * here they are honest no-ops that leave one line in the server log.
 */

export async function notifyMerchant(
  _merchantId: string,
  kind: string,
  _data: Record<string, unknown>,
  _url?: string
): Promise<void> {
  console.log(`[notify] ${kind}`);
}

export async function notifyAdmins(
  kind: string,
  _data: Record<string, unknown>,
  _url?: string
): Promise<void> {
  console.log(`[notify] ${kind}`);
}
