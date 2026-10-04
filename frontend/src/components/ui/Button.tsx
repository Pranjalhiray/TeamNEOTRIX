import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '../../utils/cn';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';

    const variantClasses = {
      default: 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:bg-[#272b32] focus:ring-[var(--accent)]',
      destructive: 'bg-[var(--risk-high)] text-white hover:bg-[var(--risk-high)]/90 focus:ring-[var(--risk-high)]',
      outline: 'border border-[var(--border)] bg-white text-[var(--color-text-primary)] hover:bg-[var(--surface-elevated)] focus:ring-[var(--accent)]',
      secondary: 'bg-[var(--surface-elevated)] text-[var(--color-text-primary)] border border-[var(--border)] hover:bg-[var(--surface-hover)] focus:ring-[var(--accent)]',
      ghost: 'hover:bg-[var(--border)] focus:ring-[var(--accent)]',
      link: 'text-[var(--accent)] underline-offset-4 hover:underline focus:ring-[var(--accent)]',
    };

    const sizeClasses = {
      default: 'h-10 px-4 py-2',
      sm: 'h-9 rounded-lg px-3',
      lg: 'h-11 rounded-lg px-8',
      icon: 'h-10 w-10',
    };

    return (
      <Comp
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center rounded-lg text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] disabled:pointer-events-none disabled:opacity-50',
          variantClasses[variant],
          sizeClasses[size],
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button };
