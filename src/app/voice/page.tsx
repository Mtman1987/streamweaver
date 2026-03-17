'use client';

import { VoiceCommander } from "@/app/(app)/dashboard/voice-commander";
import { useEffect } from 'react';

export default function VoiceCommanderPage() {
  useEffect(() => {
    // Resize window to widget size and set minimum size
    if (window.resizeTo) {
      window.resizeTo(300, 280);
    }
    // Try to set minimum window size
    if (window.outerWidth && window.outerHeight) {
      document.body.style.minWidth = '0px';
      document.documentElement.style.minWidth = '0px';
    }
  }, []);

  return (
    <div className="p-2 bg-background min-h-screen" style={{ minWidth: '0px', width: '100%' }}>
      <div style={{ minWidth: '0px', maxWidth: '100%', overflow: 'hidden' }}>
        <VoiceCommander variant="embedded" className="max-w-none" />
      </div>
    </div>
  );
}
