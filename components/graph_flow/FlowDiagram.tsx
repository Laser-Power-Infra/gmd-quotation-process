"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlowNodeCard } from "./FlowNodeCard";
import { FlowEdges } from "./FlowEdges";
import {
  layoutFlow,
  layoutRail,
  FLOW_MODE_MIN_WIDTH,
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
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
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

  const layouts = useMemo(
    () =>
      trees.map(({ tree }) =>
        containerWidth < FLOW_MODE_MIN_WIDTH
          ? layoutRail(tree, containerWidth)
          : layoutFlow(tree),
      ),
    [trees, containerWidth],
  );

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

  if (trees.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="h-full min-h-0 overflow-auto scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent hover:scrollbar-thumb-white/30 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-track]:bg-transparent"
    >
      <div className="flex min-w-max items-center gap-8 p-3">
        {trees.map(({ tree, heading, tone }, index) => {
          const layout: FlowLayout = layouts[index];
          return (
            <div key={tree.id} className="flex flex-col gap-1.5">
              <span
                className={`text-[10px] font-bold uppercase tracking-wider ${tone}`}
              >
                {heading}
              </span>
              <div
                style={{ width: layout.width, height: layout.height }}
                className="relative"
              >
                <FlowEdges
                  layout={layout}
                  edgeColors={edgeColors}
                  activeIds={activeIds}
                  emptyIds={emptyIds}
                  hoveredId={hoveredId}
                />
                {layout.nodes.map((positioned) => {
                  const node = positioned.node;
                  const parentId =
                    tree.id === node.id
                      ? null
                      : parentOf(tree, node.id);
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
              </div>
            </div>
          );
        })}
      </div>
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