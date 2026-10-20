import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merges Tailwind class names.
 *
 *  Plain concatenation doesn't work: which of `p-2 p-4` wins is decided by
 *  the order in the generated CSS file, not the order in the class
 *  attribute - so the result is effectively undefined. twMerge knows
 *  conflicting groups and keeps only the last one; clsx handles the
 *  conditional classes. */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
