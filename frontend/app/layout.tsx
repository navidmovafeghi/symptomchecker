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
        {/* Vazirmatn Persian font from Google Fonts */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <LocaleLayoutWrapper>{children}</LocaleLayoutWrapper>
      </body>
    </html>
  );
}
