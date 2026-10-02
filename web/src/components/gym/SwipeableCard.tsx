import { useRef, useState, type ReactNode, type TouchEvent } from "react";

const ACTION_WIDTH = 88;
const OPEN_THRESHOLD = ACTION_WIDTH / 2;
const DIRECTION_THRESHOLD = 1.5;
const MOVEMENT_THRESHOLD = 10;
const EDGE_GUARD = 24;

type Direction = "undecided" | "horizontal" | "vertical";

interface Gesture {
  startX: number;
  startY: number;
  startOffset: number;
  offset: number;
  direction: Direction;
  dragged: boolean;
}

interface SwipeableCardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: () => void;
  children: ReactNode;
}

function clampOffset(offset: number) {
  return Math.max(-ACTION_WIDTH, Math.min(0, offset));
}

function SwipeableCard({ open, onOpenChange, onDelete, children }: SwipeableCardProps) {
  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const suppressClickRef = useRef(false);
  const suppressClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offset = dragOffset ?? (open ? -ACTION_WIDTH : 0);
  const actionVisible = offset < 0;

  function onTouchStart(event: TouchEvent<HTMLDivElement>) {
    suppressClickRef.current = false;
    if (suppressClickTimerRef.current !== null) {
      clearTimeout(suppressClickTimerRef.current);
      suppressClickTimerRef.current = null;
    }

    const touch = event.touches[0];
    if (!touch || touch.clientX <= EDGE_GUARD) {
      gestureRef.current = null;
      return;
    }

    gestureRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      startOffset: open ? -ACTION_WIDTH : 0,
      offset: open ? -ACTION_WIDTH : 0,
      direction: "undecided",
      dragged: false,
    };
  }

  function onTouchMove(event: TouchEvent<HTMLDivElement>) {
    const gesture = gestureRef.current;
    const touch = event.touches[0];
    if (!gesture || !touch || gesture.direction === "vertical") return;

    const dx = touch.clientX - gesture.startX;
    const dy = touch.clientY - gesture.startY;

    if (gesture.direction === "undecided") {
      if (Math.max(Math.abs(dx), Math.abs(dy)) <= MOVEMENT_THRESHOLD) return;
      gesture.direction = Math.abs(dx) > DIRECTION_THRESHOLD * Math.abs(dy) ? "horizontal" : "vertical";
      if (gesture.direction === "vertical") return;
    }

    gesture.dragged = true;
    gesture.offset = clampOffset(gesture.startOffset + dx);
    setDragOffset(gesture.offset);
  }

  function onTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!gesture) return;

    setDragOffset(null);
    if (gesture.direction !== "horizontal") return;

    if (gesture.dragged) {
      suppressClickRef.current = true;
      if (suppressClickTimerRef.current !== null) clearTimeout(suppressClickTimerRef.current);
      suppressClickTimerRef.current = setTimeout(() => {
        suppressClickRef.current = false;
        suppressClickTimerRef.current = null;
      }, 500);
    }

    const touch = event.changedTouches[0];
    const finalDx = touch ? touch.clientX - gesture.startX : gesture.offset - gesture.startOffset;
    const finalOffset = clampOffset(gesture.startOffset + finalDx);
    onOpenChange(!(open && finalDx > 0) && finalOffset < -OPEN_THRESHOLD);
  }

  function onTouchCancel() {
    gestureRef.current = null;
    setDragOffset(null);
  }

  function onClickCapture(event: React.MouseEvent<HTMLDivElement>) {
    if (!open && !suppressClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClickRef.current = false;
    if (suppressClickTimerRef.current !== null) {
      clearTimeout(suppressClickTimerRef.current);
      suppressClickTimerRef.current = null;
    }
    onOpenChange(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-hidden={!actionVisible}
        tabIndex={actionVisible ? 0 : -1}
        className={`absolute inset-y-0 right-0 z-0 w-[88px] rounded-r-2xl bg-red-600 text-sm font-semibold text-white transition-opacity active:bg-red-700 ${
          actionVisible ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onDelete}
      >
        Elimina
      </button>
      <div
        className="relative z-10"
        style={{
          transform: `translateX(${offset}px)`,
          transition: dragOffset === null ? "transform 200ms ease-out" : "none",
          touchAction: "pan-y",
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
        onClickCapture={onClickCapture}
      >
        {children}
      </div>
    </div>
  );
}

export default SwipeableCard;
