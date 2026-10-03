import { memo } from 'react';
import type { ReactNode } from 'react';

export interface OrderSummaryProps {
  /** The heading above the summary. */
  title: string;
  /** How much of the order shows. */
  variant?: 'compact' | 'full';
  /** Whether totals show beneath the lines. */
  showTotals?: boolean;
  /** Most lines shown before the rest fold away. */
  limit: number;
  /** Which columns show, in order. */
  columns: ('sku' | 'quantity' | 'price')[];
  tags: string[];
  /** The tone of the status line. @default 'neutral' */
  tone?: 'neutral' | 'warning' | null;
  /** Called when a line is chosen. */
  onSelect?: (id: string) => void;
  footer?: ReactNode;
  order: { id: string; total: number };
}

/** A compact summary of an order: its lines, totals and status. */
export function OrderSummary({
  title,
  variant = 'compact',
  showTotals = true,
  limit,
  columns,
  tags,
  tone,
  footer,
}: OrderSummaryProps) {
  return (
    <section data-variant={variant} data-tone={tone ?? 'neutral'}>
      <h2>{title}</h2>
      <p>
        {columns.join(', ')} {tags.join(', ')} {limit} {showTotals ? 'totals' : ''}
      </p>
      {footer}
    </section>
  );
}

/** A small label for a status. */
export const StatusBadge = memo(function StatusBadge(props: {
  label: string;
  kind: 'info' | 'success' | 'error';
}) {
  return <span data-kind={props.kind}>{props.label}</span>;
});

export function Ambiguous(props: { value: string | number }) {
  return <span>{String(props.value)}</span>;
}
