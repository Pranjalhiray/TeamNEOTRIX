import * as React from 'react';
import { cn } from '../../utils/cn';

interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'risk-high' | 'risk-medium' | 'risk-low' | 'accent' | 'neutral';
}

const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant = 'default', ...props }, ref) => {
    const variantClasses = {
      default: 'bg-[var(--color-accent)] text-[var(--color-primary-foreground)]',
      secondary: 'bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)]',
      destructive: 'bg-[var(--color-risk-high)] text-[var(--color-primary-foreground)]',
      outline: 'border border-[var(--color-border)] bg-transparent',
      'risk-high': 'bg-[var(--color-risk-high-subtle)] text-[var(--color-risk-high)] border border-[var(--color-risk-high)]/30',
      'risk-medium': 'bg-[var(--color-risk-medium-subtle)] text-[var(--color-risk-medium)] border border-[var(--color-risk-medium)]/30',
      'risk-low': 'bg-[var(--color-risk-low-subtle)] text-[var(--color-risk-low)] border border-[var(--color-risk-low)]/30',
      'accent': 'bg-[var(--color-accent-subtle)] text-[var(--color-accent)] border border-[var(--color-accent)]/30',
      'neutral': 'bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)] border border-[var(--color-border)]',
    };

    return (
      <div
        ref={ref}
        className={cn(
          'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
          variantClasses[variant],
          className
        )}
        {...props}
      />
    );
  }
);
Badge.displayName = 'Badge';

export { Badge };
