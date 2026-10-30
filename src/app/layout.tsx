// Root layout for any future React pages. The current UI is served from public/index.html.
export const metadata = { title: "DisruptionIQ" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
