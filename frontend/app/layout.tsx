import type { Metadata } from 'next';
import './globals.css';
import { LocaleLayoutWrapper } from './LocaleLayoutWrapper';

export const metadata: Metadata = {
  title: 'Chatbot - Powered by Claude',
  description: 'A layered architecture chatbot with MVVM pattern',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <head>
        {/* Inter font from Google Fonts */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>
        <LocaleLayoutWrapper>{children}</LocaleLayoutWrapper>
      </body>
    </html>
  );
}
