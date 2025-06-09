"use client"
import React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/lib/hooks';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  clickable?: boolean;
  iconOnly?: boolean; // Force icon-only mode
  context?: 'navbar' | 'home' | 'general'; // Context for automatic mobile behavior
}

export function Logo({ 
  size = 'md', 
  className, 
  clickable = true, 
  iconOnly = false,
  context = 'general'
}: LogoProps) {
  const isMobile = useIsMobile();
  
  // Determine if we should show icon only
  const shouldShowIconOnly = iconOnly || (context === 'navbar' && isMobile);
  
  const sizeClasses = {
    sm: 'text-lg',
    md: 'text-2xl',
    lg: 'text-4xl',
    xl: 'text-6xl'
  };

  // Beautiful academic icon with proper aspect ratio
  const LogoIcon = ({ className: iconClassName }: { className?: string }) => (
    <div className={cn(
      'relative rounded-lg bg-gradient-to-r from-purple-600 via-pink-600 to-blue-600 text-white flex items-center justify-center shadow-lg',
      size === 'sm' && 'w-8 h-8',
      size === 'md' && 'w-10 h-10',
      size === 'lg' && 'w-12 h-12',
      size === 'xl' && 'w-16 h-16',
      iconClassName
    )}>
      {/* Academic/Scholar icon with proper aspect ratio */}
      <svg 
        className={cn(
          'text-white',
          size === 'sm' && 'w-4 h-4',
          size === 'md' && 'w-5 h-5',
          size === 'lg' && 'w-6 h-6',
          size === 'xl' && 'w-8 h-8'
        )} 
        viewBox="0 0 24 24" 
        fill="currentColor"
      >
        <path d="M12 3L1 9l4 2.18v6L12 21l7-3.82v-6l2-1.09V17h2V9L12 3zm6.82 6L12 12.72 5.18 9 12 5.28 18.82 9zM17 15.99l-5 2.73-5-2.73v-3.72L12 15l5-2.73v3.72z"/>
      </svg>
    </div>
  );

  const logoContent = (
    <div className={cn('flex items-center gap-3', className)}>
      <LogoIcon />
      {!shouldShowIconOnly && (
        <div className="flex flex-col">
          <span className={cn(
            'font-bold text-foreground leading-tight',
            sizeClasses[size]
          )}>
            OpenScholar
          </span>
          <span className={cn(
            'font-medium text-muted-foreground leading-tight -mt-1',
            size === 'sm' && 'text-xs',
            size === 'md' && 'text-sm',
            size === 'lg' && 'text-base',
            size === 'xl' && 'text-lg'
          )}>
            openscholar.ai
          </span>
        </div>
      )}
    </div>
  );

  if (clickable) {
    return (
      <Link href="/" className="transition-opacity hover:opacity-80">
        {logoContent}
      </Link>
    );
  }

  return logoContent;
} 