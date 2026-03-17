"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

interface LogPanelContextValue {
  visible: boolean;
  setVisible: (v: boolean) => void;
}

const LogPanelContext = createContext<LogPanelContextValue>({
  visible: false,
  setVisible: () => {},
});

export function LogPanelProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  return (
    <LogPanelContext.Provider value={{ visible, setVisible }}>
      {children}
    </LogPanelContext.Provider>
  );
}

export function useLogPanel() {
  return useContext(LogPanelContext);
}
