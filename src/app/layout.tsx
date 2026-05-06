import type {Metadata} from 'next';
import './globals.css';
import { SidebarProvider } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/toaster';

// import { applyUserConfigToProcessEnvSync } from '@/lib/user-config';
// import { DashboardConnection } from '@/components/dashboard-connection';

// applyUserConfigToProcessEnvSync();

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
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Code+Pro:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body>
        {/* <DashboardConnection /> */}
        <SidebarProvider>
        {children}
        </SidebarProvider>
        <Toaster />
      </body>
    </html>
  );
}
