"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ResultsPage() {
  const router = useRouter();
  
  useEffect(() => {
    // Redirect to home page since we now use dynamic routes with search IDs
    router.replace('/');
  }, [router]);

  return (
    <div className="flex items-center justify-center py-20">
      <p>Redirecting...</p>
    </div>
  );
} 