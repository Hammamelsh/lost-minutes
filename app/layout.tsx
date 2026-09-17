import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Lost Minutes — Manchester bus journeys", description: "Follow reported Manchester bus positions, replay a recorded sample and inspect the evidence behind every observation.", icons: { icon: "/favicon.svg", shortcut: "/favicon.svg", apple: "/apple-touch-icon.png" }, manifest: "/manifest.webmanifest", appleWebApp: { capable: true, title: "Lost Minutes", statusBarStyle: "black-translucent" } };
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
