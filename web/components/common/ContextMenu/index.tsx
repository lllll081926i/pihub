import React from 'react';
import { createPortal } from 'react-dom';

import styles from './index.module.less';

export interface ContextMenuItem {
  key: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export interface ContextMenuPosition {
  x: number;
  y: number;
}

interface ContextMenuProps {
  position: ContextMenuPosition;
  items: ContextMenuItem[];
  onClose: () => void;
}

const MENU_WIDTH = 184;
const VIEWPORT_MARGIN = 8;
const ITEM_HEIGHT = 34;

/**
 * Lightweight right-click menu rendered in a portal at the cursor position.
 * Closes on outside pointer down, Escape, or window blur.
 */
const ContextMenu: React.FC<ContextMenuProps> = ({ position, items, onClose }) => {
  React.useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(`.${styles.menu}`)) {
        return;
      }
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    const handleBlur = () => onClose();

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', handleBlur);
    };
  }, [onClose]);

  const menuStyle = React.useMemo(() => {
    const estimatedHeight = items.length * ITEM_HEIGHT;
    const left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(position.x, window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN),
    );
    const top = Math.max(
      VIEWPORT_MARGIN,
      Math.min(position.y, window.innerHeight - estimatedHeight - VIEWPORT_MARGIN),
    );
    return { left, top };
  }, [items.length, position]);

  return createPortal(
    <div className={styles.menu} style={menuStyle} role="menu">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          className={`${styles.item}${item.danger ? ` ${styles.itemDanger}` : ''}`}
          disabled={item.disabled}
          onClick={() => {
            onClose();
            item.onClick();
          }}
        >
          {item.icon ? <span className={styles.itemIcon}>{item.icon}</span> : null}
          <span>{item.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
};

/** Hook managing the open position of a context menu for one surface. */
export const useContextMenu = () => {
  const [position, setPosition] = React.useState<ContextMenuPosition | null>(null);

  const openMenu = React.useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setPosition({ x: event.clientX, y: event.clientY });
  }, []);

  const closeMenu = React.useCallback(() => setPosition(null), []);

  return { position, openMenu, closeMenu };
};

export default ContextMenu;
