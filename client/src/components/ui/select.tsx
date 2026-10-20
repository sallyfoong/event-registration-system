import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';

// A real Select is needed for picking an event / handler.
//
// Why not a native <select>: the OS draws the expanded list, so it's
// impossible to style and looks different on every platform. Radix renders
// the list itself and already implements keyboard navigation and screen
// reader semantics - we only own the visuals.

const Select = SelectPrimitive.Root;
const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm',
      'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
      'disabled:cursor-not-allowed disabled:opacity-50',
      '[&>span]:truncate [&>span]:text-left',
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      // z-50 is required: the list renders in a Portal and gets covered by
      // page content without an explicit stacking level.
      //
      // max-w is what keeps the popup on screen. Radix sizes the popper to its
      // content, and an option like "Tech Innovation Summit 2026 — November
      // 19, 2026" is wider than a phone: without a ceiling the list runs off
      // the right edge and the tail of every option is unreachable.
      className={cn(
        'relative z-50 min-w-[8rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border bg-card text-card-foreground shadow-md',
        position === 'popper' && 'data-[side=bottom]:translate-y-1',
        className,
      )}
      {...props}
    >
      {/* The scroll container is the viewport, not the content box: with
          overflow-hidden on the content (needed for the rounded corners) a
          long list would simply be clipped with no way to reach the rest. */}
      <SelectPrimitive.Viewport className="max-h-72 overflow-y-auto p-1">
        {children}
      </SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex w-full cursor-pointer select-none items-center rounded-sm py-2 pl-8 pr-2 text-sm outline-none',
      // whitespace-normal: an option is "name — date" and can be longer than a
      // phone is wide. Wrapping to a second line keeps the whole label
      // readable; nowrap would either clip it or push the popup off screen.
      'whitespace-normal text-left',
      'focus:bg-accent focus:text-accent-foreground',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
