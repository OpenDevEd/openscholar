"use client";

import { createContext, useState } from "react";

interface ConfigProviderContextType {
  isLoadingConfig: boolean;
}

const ConfigProviderContext = createContext<ConfigProviderContextType>({
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
