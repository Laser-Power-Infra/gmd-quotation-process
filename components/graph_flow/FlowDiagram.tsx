"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlowNodeCard } from "./FlowNodeCard";
import { FlowEdges } from "./FlowEdges";
import {
  layoutFlow,
  layoutFlowFill,
  type FlowLayout,
} from "./layout";
import type { FlowNode } from "./tree";

interface FlowDiagramProps {
  trees: { tree: FlowNode; heading: string; tone: string }[];
  /** Row count per node id, keyed by FlowNode.id. */
  counts: Record<string, number>;
  /** Optional pre-formatted display values per node id (e.g. summed amounts). */
  values?: Record<string, string>;
  /** Node ids currently selected, root first (the active path). */
  activePath: string[];
  /** Toggle a node on/off; receives the node id. */
  onToggle: (id: string) => void;
}

export function FlowDiagram({
  trees,
  counts,
  values,
  activePath,
  onToggle,
}: FlowDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);
  const [containerHeight, setContainerHeight] = useState(400);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
        setContainerHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleHover = useCallback((id: string | null) => {
    setHoveredId(id);
  }, []);

  const activeIds = useMemo(
    () => new Set<string>(activePath),
    [activePath],
  );

  const layouts = useMemo(() => {
    if (trees.length === 0) return [];
    const W = containerWidth > 0 ? containerWidth : 800;
    const H = containerHeight > 0 ? containerHeight : 400;
    const HEADING = 24;
    const PAD_Y = 8;
    // Trees after the first render below at their natural size.
    const restLayouts = trees.slice(1).map(({ tree }) => layoutFlow(tree));
    const restHeight =
      restLayouts.reduce((s, l) => s + l.height , 0) +
      (restLayouts.length > 0 ? PAD_Y : 0);
    const liveHeight = Math.max(120, H - restHeight);
    // First tree (Live) fills the full width + remaining height.
    const first = layoutFlowFill(trees[0].tree, W, liveHeight);
    return [first, ...restLayouts];
  }, [trees, containerWidth, containerHeight]);

  const emptyIds = useMemo(
    () =>
      new Set<string>(
        Object.entries(counts)
          .filter(([, count]) => count === 0)
          .map(([id]) => id),
      ),
    [counts],
  );

  const edgeColors = useMemo(() => {
    const colors: Record<string, string> = {};
    for (const layout of layouts) {
      for (const positioned of layout.nodes) {
        colors[positioned.node.id] = positioned.node.edge;
      }
    }
    return colors;
  }, [layouts]);

  const renderTreeNodes = (layout: FlowLayout, tree: FlowNode) => (
    <>
      <FlowEdges
        layout={layout}
        edgeColors={edgeColors}
        activeIds={activeIds}
        emptyIds={emptyIds}
        hoveredId={hoveredId}
      />
      {layout.nodes.map((positioned) => {
        const node = positioned.node;
        const parentId = tree.id === node.id ? null : parentOf(tree, node.id);
        const parentCount =
          parentId === null ? null : counts[parentId] ?? 0;
        const count = counts[node.id] ?? 0;
        const share =
          parentId === null || !parentCount
            ? null
            : Math.round((count / parentCount) * 100);
        return (
          <FlowNodeCard
            key={node.id}
            positioned={positioned}
            mode={layout.mode}
            count={count}
            share={share}
            displayValue={values?.[node.id]}
            active={activeIds.has(node.id)}
            onSelect={() => onToggle(node.id)}
            onHover={handleHover}
          />
        );
      })}
    </>
  );

  if (trees.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="h-full min-h-0 overflow-hidden flex flex-col"
    >
      {layouts[0] && (
        <div
          className="relative shrink-0 mt-1"
          style={{ width: layouts[0].width, height: layouts[0].height }}
        >
          {renderTreeNodes(layouts[0], trees[0].tree)}
        </div>
      )}
      {trees.slice(1).length > 0 && (
        <div className="flex items-center gap-8 px-8 pb-2 pt-0">
          {trees.slice(1).map(({ tree,  tone }, index) => {
            const layout: FlowLayout = layouts[index + 1];
            return (
              <div key={tree.id} className="flex flex-col gap-1.5">
                {/* <span
                  className={`text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${tone}`}
                >
                  {heading}
                </span> */}
                <div
                  style={{ width: layout.width, height: layout.height }}
                  className="relative"
                >
                  {renderTreeNodes(layout, tree)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function parentOf(root: FlowNode, id: string): string | null {
  const walk = (node: FlowNode, parent: string | null): string | null => {
    if (node.id === id) return parent;
    for (const kid of node.children ?? []) {
      const found = walk(kid, node.id);
      if (found !== null) return found;
    }
    return null;
  };
  return walk(root, null);
}