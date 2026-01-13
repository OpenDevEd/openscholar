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

  // Orange branded academic icon
  const LogoIcon = ({ className: iconClassName }: { className?: string }) => (
    <div className={cn(
      'relative flex items-center justify-center',
      iconClassName
    )}>
      <img
        src="/icon.svg"
        alt="OpenScholar.ai"
        className={cn(
          'object-contain flex',
          size === 'sm' && 'w-8 h-8',
          size === 'md' && 'w-10 h-10',
          size === 'lg' && 'w-12 h-12',
          size === 'xl' && 'w-16 h-16'
        )}
      />
    </div>
  );

  const logoContent = (
    <div className={cn('flex items-center gap-2 sm:gap-3', className)}>
      <LogoIcon />
      {!shouldShowIconOnly && (
        <div className="flex items-baseline min-w-0">
          <span className={cn(
            'font-bold text-foreground leading-tight whitespace-nowrap',
            sizeClasses[size]
          )}>
            OpenScholar
          </span>
          <span className={cn(
            'font-medium text-muted-foreground leading-tight whitespace-nowrap',
            size === 'sm' && 'text-xs',
            size === 'md' && 'text-sm',
            size === 'lg' && 'text-base',
            size === 'xl' && 'text-lg'
          )}>
            .ai
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
