import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isConfigured } from "@/lib/server/settings";

export const dynamic = "force-dynamic";

export default function Home() {
  // brand-new node → straight into the first-run Setup Wizard
  if (!isConfigured()) redirect("/setup");

  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <div className="max-w-xl w-full space-y-8 text-center">
        <div className="flex justify-center">
          <Image
            src="/brand/logo-lockup.png"
            alt="LibrePay Node"
            width={300}
            height={85}
            priority
            className="h-auto w-[280px] sm:w-[300px]"
          />
        </div>
        <p className="text-lg text-muted-foreground">
          Self-hosted, non-custodial Bitcoin payment gateway. Your server. Your keys.
          On-chain stealth addresses + instant Lightning (phoenixd).
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link
            href="/docs"
            className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            API Documentation
          </Link>
          <Link
            href="/setup"
            className="rounded-md border px-5 py-2.5 text-sm font-medium hover:bg-muted"
          >
            Operator console
          </Link>
          <a
            href="https://github.com/radhwendalyhamdouni/librepay-node"
            className="rounded-md border px-5 py-2.5 text-sm font-medium hover:bg-muted"
          >
            Source (AGPL-3.0)
          </a>
        </div>
        <p className="text-xs text-muted-foreground">
          No accounts. No KYC. The node never holds a spending key — funds land
          directly in the wallet you configured. Encrypted backups, signed webhooks.
        </p>
      </div>
    </main>
  );
}
