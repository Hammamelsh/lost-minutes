import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Lost Minutes — Manchester bus journeys", description: "Follow reported Manchester bus positions, replay a recorded sample and inspect the evidence behind every observation.", icons: { icon: "/favicon.svg", shortcut: "/favicon.svg", apple: "/apple-touch-icon.png" }, manifest: "/manifest.webmanifest", appleWebApp: { capable: true, title: "Lost Minutes", statusBarStyle: "black-translucent" } };
export const viewport: Viewport = { themeColor: "#0d1b26", width: "device-width", initialScale: 1, viewportFit: "cover" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
