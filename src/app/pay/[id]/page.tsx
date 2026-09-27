import type { Metadata } from "next";
import { CheckoutPage } from "@/components/pay/checkout-page";

export const metadata: Metadata = {
  title: "Bitcoin payment",
  robots: { index: false, follow: false },
};

export default async function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CheckoutPage invoiceId={id} />;
}
