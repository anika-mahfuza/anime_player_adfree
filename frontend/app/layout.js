import './globals.css';

export const metadata = {
  title: 'AniStream - Ad-Free Anime',
  description: 'Static anime frontend backed by a standalone streaming API.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-gray-950 text-white" suppressHydrationWarning>{children}</body>
    </html>
  );
}
