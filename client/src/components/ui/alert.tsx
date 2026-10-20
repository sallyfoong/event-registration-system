import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';

import { cn } from '@/lib/utils';

/** The alert's tones.
 *
 *  Separate variants instead of one red box, because "you typed something
 *  wrong" and "the server is down" ask the user to do completely different
 *  things: fix the input vs. retry or report. Rendering both in the same
 *  red makes users think they made the mistake. */
const alertVariants = cva('flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-sm', {
  variants: {
    variant: {
      default: 'bg-card text-card-foreground',
      destructive: 'border-destructive/40 bg-destructive/5 text-destructive',
      success: 'border-success/40 bg-success/5 text-emerald-800',
      info: 'border-primary/30 bg-primary/5 text-primary',
    },
  },
  defaultVariants: { variant: 'default' },
});

// Why flex instead of the more common "absolute icon + padding on siblings":
// the padding approach needs a selector like [&>svg~*] to push the text past
// the icon, and that selector only matches *elements*. Callers pass plain
// strings ("{banner}"), which React renders as a text node - nothing to match,
// no padding applied, and the text starts at px-4 directly under the
// absolutely positioned icon. The result is the first characters of the
// message disappearing behind the icon. A flex row has no such dependency:
// the icon is a flex item, the content is a flex item, and neither can
// overlap the other regardless of what the caller passes.

const iconFor = (variant: VariantProps<typeof alertVariants>['variant']) => {
  if (variant === 'destructive') return AlertCircle;
  if (variant === 'success') return CheckCircle2;
  return Info;
};

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {}

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant, children, ...props }, ref) => {
    // role="alert" makes screen readers announce the message immediately,
    // without the user having to move focus over. Without it a screen reader
    // user never learns their submission failed.
    const Icon = iconFor(variant);
    return (
      <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props}>
        {/* shrink-0: the icon keeps its 16px square even when the message is
            long. aria-hidden: the text already carries the meaning, so the
            icon would only be noise in the announcement. */}
        <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        {/* The wrapper exists so that both shapes of children work: a bare
            string (the common case) and structured content such as
            <AlertTitle /> + <AlertDescription />. min-w-0 is what lets a long
            unbroken token (a URL, an email) wrap instead of forcing the alert
            wider than its container; flex-1 takes the remaining width. */}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    );
  },
);
Alert.displayName = 'Alert';

const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5 ref={ref} className={cn('mb-1 font-medium leading-none', className)} {...props} />
  ),
);
AlertTitle.displayName = 'AlertTitle';

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('text-sm [&_p]:leading-relaxed', className)} {...props} />
));
AlertDescription.displayName = 'AlertDescription';

export { Alert, AlertTitle, AlertDescription };
