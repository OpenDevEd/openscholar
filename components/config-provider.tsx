"use client";

import { getAPIConfig } from "@/app/actions/api-key";
import { useAIConfigStore } from "@/lib/store";
import { createContext, useEffect, useState } from "react";

interface ConfigProviderContextType {
  isDemoMode: boolean;
  isLoadingConfig: boolean;
}

export const ConfigProviderContext = createContext<ConfigProviderContextType>({
  isDemoMode: false,
  isLoadingConfig: false,
});

export default function ConfigProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { setProvider, setApiKey } = useAIConfigStore();
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);

  useEffect(() => {
    const loadAPIConfig = async () => {
      try {
        const config = await getAPIConfig();
        if (config.isDemo && config.provider && config.apiKey) {
          setProvider(config.provider);
          setApiKey(config.apiKey);
          setIsDemoMode(true);
        }
      } catch (error) {
        console.error("Failed to load API config:", error);
      } finally {
        setIsLoadingConfig(false);
      }
    };

    loadAPIConfig();
  }, [setProvider, setApiKey]);

  return (
    <ConfigProviderContext.Provider value={{ isDemoMode, isLoadingConfig }}>
      {children}
    </ConfigProviderContext.Provider>
  );
}
