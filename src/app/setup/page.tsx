import type { Metadata } from "next";
import SetupWizard from "@/components/pay/setup-wizard";

export const metadata: Metadata = {
  title: "Setup — LibrePay Node",
  description: "First-run setup: five questions and your node is live.",
};

export const dynamic = "force-dynamic";

export default function SetupPage() {
  return <SetupWizard />;
}
