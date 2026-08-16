import type {Metadata} from 'next';
import Script from 'next/script';
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${spaceGrotesk.variable}`}>
      <body>
        <div className="sw-starfield sw-starfield-a" />
        <div className="sw-starfield sw-starfield-b" />
        <div className="sw-starfield sw-starfield-c" />
        <OverlayDocumentMode />
        <SpaceMountainEmbedBridge />
        <Script src="https://spmt.live/shared/ecosystem-header.js" data-app="streamweaver" strategy="afterInteractive" />
        <Script src="https://spmt.live/shared/workspace-controller.js" strategy="afterInteractive" />
        {/* <DashboardConnection /> */}
        <SidebarProvider>
        {children}
        </SidebarProvider>
        <Toaster />
      </body>
    </html>
  );
}
