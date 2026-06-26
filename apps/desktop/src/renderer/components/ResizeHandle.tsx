import { useCallback, useRef } from "react";

type Props = {
  // 当前宽度（px），由父级状态持有
  width: number;
  min: number;
  max: number;
  // 拖拽方向：left 表示把手在被调整栏的右缘（向右拖变宽）
  // right 表示把手在被调整栏的左缘（向左拖变宽，用于右侧 review 栏）
  edge: "left" | "right";
  onResize: (next: number) => void;
};

// 纯指针拖拽的栏宽把手，不依赖第三方库。
export function ResizeHandle({ width, min, max, edge, onResize }: Props) {
  const startX = useRef(0);
  const startW = useRef(0);

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const delta = e.clientX - startX.current;
      const signed = edge === "left" ? delta : -delta;
      const next = Math.min(max, Math.max(min, startW.current + signed));
      onResize(next);
    },
    [edge, max, min, onResize],
  );

  const onPointerUp = useCallback(() => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, [onPointerMove]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      startX.current = e.clientX;
      startW.current = width;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [width, onPointerMove, onPointerUp],
  );

  return (
    <div
      className="resize-handle"
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
    />
  );
}
