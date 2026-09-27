import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Providers } from "@/components/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = process.env.LP_BASE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "LibrePay Node — self-hosted, non-custodial Bitcoin payments",
    template: "%s · LibrePay Node",
  },
  description:
    "Accept Bitcoin with zero custody, zero KYC and zero percentage fees. Keys are generated in your browser; funds flow buyer → merchant directly. Fixed SaaS pricing paid in sats.",
  keywords: [
    "bitcoin payments", "non-custodial", "no kyc", "crypto payment gateway",
    "bip47", "stealth addresses", "self-sovereign", "merchant bitcoin", "librepay",
  ],
  applicationName: "LibrePay Node",
  authors: [{ name: "LibrePay" }],
  creator: "LibrePay",
  publisher: "LibrePay",
  formatDetection: { telephone: false, email: false },
  openGraph: {
    title: "LibrePay — Non-custodial Bitcoin payments",
    description:
      "Privacy-first Bitcoin checkout: stealth addresses per invoice, browser-generated keys, no KYC, flat SaaS pricing in sats.",
    url: SITE_URL,
    siteName: "LibrePay",
    type: "website",
    locale: "en_US",
    alternateLocale: ["ar_AR", "fr_FR", "es_ES", "pt_BR", "fil_PH"],
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "LibrePay — non-custodial Bitcoin payments. Accept Bitcoin, keep your keys.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "LibrePay — Non-custodial Bitcoin payments",
    description: "Accept Bitcoin. Keep your keys. No KYC. No percentage fees.",
    images: ["/og.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 },
  },
  alternates: { canonical: SITE_URL, languages: { en: SITE_URL, ar: `${SITE_URL}?lang=ar`, fr: `${SITE_URL}?lang=fr`, es: `${SITE_URL}?lang=es`, pt: `${SITE_URL}?lang=pt` } },
};

export const viewport: Viewport = {
  themeColor: "#09090b",
  width: "device-width",
  initialScale: 1,
};

/**
 * Rich structured data — Organization + WebSite (sitelinks searchbox signals)
 * + the product offer. The landing FAQ adds FAQPage markup from the server
 * layout so search engines can render FAQ rich results.
 */
const jsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "LibrePay",
    url: SITE_URL,
    logo: `${SITE_URL}/icon.svg`,
    description:
      "Non-custodial, no-KYC Bitcoin payment acceptance SaaS with per-invoice stealth addresses and fixed subscription pricing in sats.",
    foundingDate: "2025",
    founder: { "@type": "Person", name: "radhwen daly hamdouni" },
    sameAs: ["https://github.com/radhwendalyhamdouni/librepay-private-bitcoin-payments"],
  },
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "LibrePay",
    url: SITE_URL,
    inLanguage: ["en", "ar", "fr", "es", "pt", "fil"],
    publisher: { "@type": "Organization", name: "LibrePay" },
  },
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "LibrePay",
    applicationCategory: "FinanceApplication",
    operatingSystem: "Web",
    description:
      "Non-custodial, no-KYC Bitcoin payment acceptance SaaS with BIP47-style stealth addresses and fixed subscription pricing in sats.",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    featureList: [
      "Non-custodial wallets (keys generated in the browser)",
      "One-time stealth addresses per invoice (ECDH)",
      "On-chain + Lightning (merchant's own phoenixd node)",
      "Signed webhooks with retry queue",
      "Hosted checkout, HTML snippet, WooCommerce plugin, REST API",
      "Six interface languages",
    ],
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "How do you confirm payments without holding our keys?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "We only watch the public blockchain via mempool.space. When a transaction hits your invoice's unique stealth address, we track confirmations and fire webhooks. The funds themselves move directly on-chain to your wallet — we merely observe.",
        },
      },
      {
        "@type": "Question",
        name: "What happens if your platform disappears?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Nothing. Your wallet lives in your browser — the seed phrase works in any compatible wallet. You can export per-invoice spending keys as WIF into Electrum or any wallet. Losing us only means losing the dashboard.",
        },
      },
      {
        "@type": "Question",
        name: "Why a different address per invoice?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Address reuse publicly links your payments and exposes your revenue. Every invoice derives a unique one-time stealth address via ECDH from your single payment code — the blockchain cannot link them.",
        },
      },
      {
        "@type": "Question",
        name: "How do you cover costs without a cut of transactions?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "A flat monthly subscription paid in Bitcoin. Our incentive is aligned with yours: we sell software, not your payment flow.",
        },
      },
    ],
  },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} min-h-screen antialiased bg-background text-foreground`}>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
