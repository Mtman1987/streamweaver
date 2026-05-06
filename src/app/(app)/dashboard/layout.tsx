import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'StreamWeaver Dashboard',
  description: 'AI-powered streaming dashboard',
};

export function generateViewport() {
  return {
    themeColor: '#667eea',
  };
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}