import "./globals.css";

export const metadata = { title: "DisruptionIQ", description: "From delivery delays to recovery plans" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
