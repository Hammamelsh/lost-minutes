import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Lost Minutes — Manchester bus journeys", description: "Explore recorded Manchester bus movements, replay journeys and inspect the evidence behind every observation.", icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
