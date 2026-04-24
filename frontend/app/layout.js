import { Fraunces, Instrument_Sans } from 'next/font/google';
import 'react-loading-skeleton/dist/skeleton.css';
import './globals.css';
import { AppSkeletonTheme } from '@/components/skeletons';

const displayFont = Fraunces({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['400', '500', '600', '700'],
});

const bodyFont = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  weight: ['400', '500', '600', '700'],
});

export const metadata = {
  title: 'AniStream',
  description: 'A premium anime discovery and streaming frontend backed by a standalone API.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${displayFont.variable} ${bodyFont.variable} h-full antialiased`}>
      <body className="min-h-full bg-[var(--color-obsidian)] text-[var(--color-mist)]" suppressHydrationWarning>
        <AppSkeletonTheme>{children}</AppSkeletonTheme>
      </body>
    </html>
  );
}
