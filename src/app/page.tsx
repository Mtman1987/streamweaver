"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to dashboard after showing logo briefly
    const timer = setTimeout(() => {
      router.push('/dashboard');
    }, 2000);

    return () => clearTimeout(timer);
  }, [router]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        <Image 
          src="/StreamWeaver.png" 
          alt="StreamWeaver" 
          width={200} 
          height={200} 
          className="mx-auto mb-4"
        />
        <h1 className="text-4xl font-bold text-foreground mb-2">StreamWeaver</h1>
        <p className="text-muted-foreground">Loading dashboard...</p>
      </div>
    </div>
  );
}