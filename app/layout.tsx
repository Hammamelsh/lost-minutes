import type { Metadata, Viewport } from "next";
import "./globals.css";
// What a shared link shows (LinkedIn, Slack, messages): the title, one line, and a 1200 x 630 card of the served site
// (public/og-image.png, made 9 October 2026 from the served site at Piccadilly Gardens, Stop L, real data). Until then a
// shared link showed a bare address: the page carried no Open Graph tags. The image address must be absolute, so the
// public address is the base; a build served elsewhere still points its cards at the public site.
const SITE = "https://lost-minutes.duckdns.org";
const TITLE = "Lost Minutes — live Manchester buses";
const DESCRIPTION = "Live Manchester buses, each drawn from its own position reports; journeys planned from the operators’ timetables; and the auditable data pipeline behind them.";
const CARD = { url: "/og-image.png", width: 1200, height: 630, alt: "Lost Minutes, live Manchester buses: the site on a phone at Piccadilly Gardens, with buses on the map and the stop’s timetabled departures." };
export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { type: "website", url: "/", siteName: "Lost Minutes", locale: "en_GB", title: TITLE, description: DESCRIPTION, images: [CARD] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: [CARD] },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg", apple: "/apple-touch-icon.png" },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Lost Minutes", statusBarStyle: "black-translucent" },
};
export const viewport: Viewport = { themeColor: "#0d1b26", width: "device-width", initialScale: 1, viewportFit: "cover" };
// Both faces are asked for with the page itself. They are 48 KB and 22 KB, served from here
// (scripts/vendor-fonts.mjs), and the first screen is almost entirely set in them; waiting for
// the CSS to discover them costs a visible round trip on a phone.
const FONTS = ["/fonts/inter-variable.woff2", "/fonts/space-grotesk-variable.woff2"];
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en">
    <head>{FONTS.map(href => <link key={href} rel="preload" href={href} as="font" type="font/woff2" crossOrigin="anonymous" />)}</head>
    <body>{children}</body>
  </html>;
}
