import * as React from 'react';
import { cn } from '../../utils/cn';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        ref={ref}
        className={cn(
          'flex h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--text-muted)]',
          'focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)]',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'transition-all duration-200',
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

export { Input };