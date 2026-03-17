'use client';

import { Button } from '@/components/ui/button';
import { Terminal, Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';

export function ConsoleToggle() {
  const [isVisible, setIsVisible] = useState(true);

  const toggleConsole = () => {
    if (typeof window !== 'undefined' && window.require) {
      const { exec } = window.require('child_process');
      exec('powershell -Command "Add-Type -Name Window -Namespace Console -MemberDefinition \'[DllImport(\\"Kernel32.dll\\")] public static extern IntPtr GetConsoleWindow(); [DllImport(\\"user32.dll\\")] public static extern bool ShowWindow(IntPtr hWnd, Int32 nCmdShow);\'; $consolePtr = [Console.Window]::GetConsoleWindow(); if([Console.Window]::ShowWindow($consolePtr, 0)) { [Console.Window]::ShowWindow($consolePtr, 5) } else { [Console.Window]::ShowWindow($consolePtr, 0) }"');
      setIsVisible(!isVisible);
    }
  };

  // Only show in Electron environment
  if (typeof window === 'undefined' || !window.require) {
    return null;
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={toggleConsole}
      className="flex items-center gap-2"
    >
      <Terminal className="h-4 w-4" />
      {isVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      {isVisible ? 'Hide Console' : 'Show Console'}
    </Button>
  );
}