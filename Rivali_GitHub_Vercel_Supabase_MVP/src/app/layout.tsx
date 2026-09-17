import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rivali — Turn Data Into Speed",
  description: "Data-driven crew chief tools for dirt oval kart racers.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
