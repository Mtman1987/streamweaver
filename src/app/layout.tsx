import type {Metadata} from 'next';
import Script from 'next/script';
import { headers } from 'next/headers';
import './globals.css';
import './workspace-parity.css';
import { SidebarProvider } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/toaster';
import { Inter, Space_Grotesk } from 'next/font/google';
import { OverlayDocumentMode } from '@/components/overlay-document-mode';
import { SpaceMountainEmbedBridge } from '@/components/spacemountain-embed-bridge';

// import { applyUserConfigToProcessEnvSync } from '@/lib/user-config';
// import { DashboardConnection } from '@/components/dashboard-connection';

// applyUserConfigToProcessEnvSync();

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
});

export const metadata: Metadata = {
  title: 'StreamWeaver',
  description: 'The AI-powered streaming bot for creators.',
  manifest: '/manifest.json',
  icons: {
    icon: '/app-icon.png',
    apple: '/app-icon.png',
    shortcut: '/app-icon.png',
  },
};

export const viewport = {
  themeColor: '#667eea',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const requestHeaders = await headers();
  const overlayDocument = requestHeaders.get('x-streamweaver-overlay-document') === '1';

  return (
    <html lang="en" className={`dark ${inter.variable} ${spaceGrotesk.variable}`}>
      <body className={overlayDocument ? 'overlay-document' : undefined}>
        {!overlayDocument && (
          <>
            <div className="sw-starfield sw-starfield-a" />
            <div className="sw-starfield sw-starfield-b" />
            <div className="sw-starfield sw-starfield-c" />
            <SpaceMountainEmbedBridge />
            <Script src="https://spmt.live/shared/ecosystem-header.js" data-app="streamweaver" strategy="afterInteractive" />
            <Script src="https://spmt.live/shared/workspace-controller.js" strategy="afterInteractive" />
          </>
        )}
        <OverlayDocumentMode />
        {/* <DashboardConnection /> */}
        <SidebarProvider>
        {children}
        </SidebarProvider>
        {!overlayDocument && <Toaster />}
      </body>
    </html>
  );
}
