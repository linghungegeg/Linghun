import { Box, type DOMElement } from "@linghun/ink-runtime";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { computeScrollViewportOffset } from "../models/transcript-scroll-state.js";
import type {
  TranscriptScrollView,
  TranscriptViewportGeometryView,
  TranscriptVirtualRangeView,
} from "../types.js";

/**
 * D.14D-C2 — Measured, clamped scroll viewport (standard ink).
 *
 * 替换旧的无界 `marginTop={-scrollOffset}` trick。旧实现的缺陷：scrollOffset
 * 没有上界，用户可以一直向上滚动，把全部内容推出可视区域进入空白（"滚进虚空"）。
 *
 * 标准 ink 能做什么 / 不能做什么（诚实记录）：
 * - 标准 ink **没有** @anthropic/ink 那种行级裁剪的 ScrollBox；早期实现只能
 *   把整棵 React 树渲染成行，再由 Output 按 overflow="hidden" 的 clip 矩形
 *   丢弃不可见行。Phase 7.18 在现有 viewport 上增加 block-level
 *   virtualization：view-model 只传入可见窗口附近的 blocks，并用 virtualRange
 *   的总高度/top spacer 保持完整滚动语义。
 * - 因此正确的"测量视口"方案是：测出内容高度与可视高度 → 夹紧偏移
 *   → 用一个**有界的** translate（marginTop = -clampedOffset）把内容上移，
 *   外层 overflow="hidden" + minHeight=0 负责把溢出行裁掉。这与旧实现形似，
 *   但本质不同：偏移由测量结果夹紧、且支持 stickToBottom 自动吸底，
 *   不再是没有上界的裸 trick。
 * - measureElement 在 render 期返回 0；必须在 layout 之后（useEffect）读取
 *   yogaNode 的 computed layout，再 setState 触发一次重排。这对 UI 组件是
 *   可接受的（这是渲染状态，不是业务逻辑）。
 *
 * 行为：
 * - 测量 content（内层 Box）高度与 viewport（外层 Box）高度。
 * - maxOffset = max(0, contentHeight - viewportHeight)。
 * - clampTranscriptScroll 把 scroll.scrollOffset 夹到 [0, maxOffset]。
 * - stickToBottom=true 时强制 effectiveOffset=0（新内容保持最新可见 / 吸底）。
 * - effectiveMarginTop = -effectiveOffset（永远 <=0，且不会超过可滚动距离）。
 * - onOverflowChange(hasOverflow) 上报溢出状态，驱动 TranscriptScrollView.hasOverflow。
 */
export function TranscriptViewport({
  scroll,
  virtualRange,
  onOverflowChange,
  onMeasure,
  onGeometry,
  children,
}: {
  scroll: TranscriptScrollView | undefined;
  virtualRange?: TranscriptVirtualRangeView;
  onOverflowChange?: (hasOverflow: boolean) => void;
  onMeasure?: (measurement: { viewportHeight: number; contentHeight: number }) => void;
  onGeometry?: (geometry: TranscriptViewportGeometryView) => void;
  children: React.ReactNode;
}): React.ReactNode {
  const viewportRef = useRef<DOMElement | null>(null);
  const contentRef = useRef<DOMElement | null>(null);
  const [maxOffset, setMaxOffset] = useState(0);
  const maxOffsetRef = useRef(0);
  const lastReportedOverflow = useRef<boolean | undefined>(undefined);
  const lastReportedMeasure = useRef<string | undefined>(undefined);
  const lastReportedGeometry = useRef<string | undefined>(undefined);

  // Measure after layout. measureElement() returns 0 during render, so we read
  // the computed yoga layout in a post-render effect and store maxOffset. The
  // effect runs after every render (no deps) so content/terminal-size changes
  // re-measure; we only setState when the derived ceiling actually changes to
  // avoid a render loop.
  useEffect(() => {
    const viewportNode = viewportRef.current?.yogaNode;
    const contentNode = contentRef.current?.yogaNode;
    if (!viewportNode || !contentNode) return;
    const viewportHeight = viewportNode.getComputedHeight();
    const viewportWidth = viewportNode.getComputedWidth();
    const measuredContentHeight = contentNode.getComputedHeight();
    const contentHeight = virtualRange?.estimatedContentHeight ?? measuredContentHeight;
    const nextMax = Math.max(0, Math.floor(contentHeight - viewportHeight));
    const nextOffset = computeScrollViewportOffset(nextMax, scroll);
    const measureKey = `${viewportHeight}:${contentHeight}`;
    if (onMeasure && lastReportedMeasure.current !== measureKey) {
      lastReportedMeasure.current = measureKey;
      onMeasure({ viewportHeight, contentHeight });
    }
    if (onGeometry) {
      const origin = computeAbsolutePosition(viewportRef.current);
      const geometry: TranscriptViewportGeometryView = {
        x: Math.floor(origin.x),
        y: Math.floor(origin.y),
        width: Math.floor(viewportWidth),
        height: Math.floor(viewportHeight),
        contentHeight: Math.floor(contentHeight),
        topOffset: nextOffset.topOffset,
      };
      const geometryKey = `${geometry.x}:${geometry.y}:${geometry.width}:${geometry.height}:${geometry.contentHeight}:${geometry.topOffset}`;
      if (lastReportedGeometry.current !== geometryKey) {
        lastReportedGeometry.current = geometryKey;
        onGeometry(geometry);
      }
    }
    if (maxOffsetRef.current !== nextMax) {
      maxOffsetRef.current = nextMax;
      setMaxOffset(nextMax);
    }
    const hasOverflow = nextMax > 0;
    if (onOverflowChange && lastReportedOverflow.current !== hasOverflow) {
      lastReportedOverflow.current = hasOverflow;
      onOverflowChange(hasOverflow);
    }
  });

  const { marginTop } = computeScrollViewportOffset(maxOffset, scroll);
  const contentMarginTop =
    virtualRange && virtualRange.estimatedContentHeight > 0
      ? marginTop + virtualRange.topSpacer
      : marginTop;

  return (
    <Box ref={viewportRef} flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
      <Box ref={contentRef} flexDirection="column" flexShrink={0} marginTop={contentMarginTop}>
        {children}
      </Box>
    </Box>
  );
}

function computeAbsolutePosition(node: DOMElement | null): { x: number; y: number } {
  let current: DOMElement | undefined = node ?? undefined;
  let x = 0;
  let y = 0;
  while (current?.yogaNode) {
    x += current.yogaNode.getComputedLeft();
    y += current.yogaNode.getComputedTop();
    current = current.parentNode;
  }
  return { x, y };
}
