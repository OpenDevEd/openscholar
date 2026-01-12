"use client";

import { createContext, useEffect, useState } from "react";

interface ConfigProviderContextType {
  isLoadingConfig: boolean;
}

export const ConfigProviderContext = createContext<ConfigProviderContextType>({
  isLoadingConfig: false,
});

export default function ConfigProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);

  return (
    <ConfigProviderContext.Provider value={{ isLoadingConfig }}>
      {children}
    </ConfigProviderContext.Provider>
  );
}
