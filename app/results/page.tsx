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
    <div className="min-h-screen flex items-center justify-center">
      <p>Redirecting...</p>
    </div>
  );
} 