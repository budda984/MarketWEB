import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Market Monitor Pro',
  description: 'HMA 50 + Heikin Ashi scanner — web edition',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="it" className="dark">
      <body>{children}</body>
    </html>
  );
}
