import type { ReactNode } from "react";

export const metadata = { title: "Aftercall", description: "Verify an Aftercall meeting proof" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#141311", color: "#ede9e1", fontFamily: "system-ui, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
