/**
 * components/VirtualizedList.tsx
 * Renders a list of items normally until it crosses a configurable size
 * threshold, then switches to windowed rendering (react-window) so only the
 * rows visible in the viewport are mounted into the DOM.
 */

import { Fragment } from "react";
import type { ReactNode, RefObject } from "react";

import { FixedSizeList, ListOnItemsRenderedProps } from "react-window";

interface VirtualizedListProps<T> {
  items: T[];
  itemKey: (item: T, index: number) => string | number;
  renderItem: (item: T, index: number) => ReactNode;
  /** Fixed row height in px, required for windowed rendering. */
  itemHeight: number;
  /** Height of the scroll viewport once virtualized. */
  height: number;
  /** Item count above which windowed rendering kicks in. Defaults to 100. */
  threshold?: number;
  className?: string;
  listClassName?: string;
  onItemsRendered?: (props: ListOnItemsRenderedProps) => void;
  ariaLabel?: string;
  /** Ref to the underlying react-window list, only populated once virtualized. */
  listRef?: RefObject<FixedSizeList>;
}

function VirtualizedList<T>({
  items,
  itemKey,
  renderItem,
  itemHeight,
  height,
  threshold = 100,
  className,
  listClassName,
  onItemsRendered,
  ariaLabel,
  listRef,
}: VirtualizedListProps<T>) {
  if (items.length <= threshold) {
    return (
      <div role="list" aria-label={ariaLabel} className={className}>
        {items.map((item, index) => (
          <Fragment key={itemKey(item, index)}>{renderItem(item, index)}</Fragment>
        ))}
      </div>
    );
  }

  return (
    <div role="list" aria-label={ariaLabel} className={listClassName}>
      <FixedSizeList
        ref={listRef}
        height={height}
        width="100%"
        itemCount={items.length}
        itemSize={itemHeight}
        onItemsRendered={onItemsRendered}
      >
        {({ index, style }) => (
          <div key={itemKey(items[index], index)} style={style}>
            {renderItem(items[index], index)}
          </div>
        )}
      </FixedSizeList>
    </div>
  );
}

export default VirtualizedList;
