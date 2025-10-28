// app/providers/StoreProvider.tsx
import React from 'react';
import { hydrateAll } from '@/db/actions';
import ClientStoreHydrator from '@/components/client-store-hydrator';

type Props = {
  children: React.ReactNode;
};

// Server Component: fetches the initial data and passes it to the client hydrator.
// Place this provider near the root (e.g., in app/layout.tsx).
export default async function StoreProvider({ children }: Props) {
  const data = await hydrateAll();
  return <ClientStoreHydrator data={data}>{children}</ClientStoreHydrator>;
}