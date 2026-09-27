import type { Metadata } from "next";
import { ColdWallet } from "@/components/pay/cold-wallet";

export const metadata: Metadata = {
  title: "Cold Wallet — LibrePay Node",
  description:
    "Generate a cold receiving wallet entirely in your browser. No server, no account, no internet needed after this page loads.",
  robots: { index: false, follow: false },
};

export default function ColdPage() {
  return <ColdWallet />;
}
