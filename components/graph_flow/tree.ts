/**
 * A node in the contract-review flow diagram.
 *
 * `id` doubles as the key into the counts record built by the chart, so it is
 * unique across the whole diagram; `filter` is the column/value constraint the
 * node applies to the table (path-based: clicking a node ANDs the whole
 * ancestor chain with the node's own filter).
 */
export interface FlowFilter {
  /** Display header the filter targets, e.g. "STATUS". */
  column: string;
  /** Exact trimmed cell values. "(Blank)" matches the empty string. */
  values: string[];
}

export interface FlowNode {
  id: string;
  filter: FlowFilter;
  label: string;
  /** Tailwind text colour for the count. */
  accent: string;
  /** Stroke colour used for this node's incoming edge when the path is live. */
  edge: string;
  children?: FlowNode[];
}

export const LIVE_TREE: FlowNode = {
  id: "live",
  filter: { column: "STATUS", values: ["(Blank)"] },
  label: "Live",
  accent: "text-cyan-300",
  edge: "rgb(103 232 249)",
  children: [
    {
      id: "liveApproved",
      filter: { column: "CLEARANCE STATUS", values: ["APPROVED"] },
      label: "Approved",
      accent: "text-emerald-300",
      edge: "rgb(110 231 183)",
      children: [
        {
          id: "mcreceived",
          filter: { column: "MC Received/Pending", values: ["RECEIVED"] },
          label: "MC Received",
          accent: "text-emerald-300",
          edge: "rgb(110 231 183)",
          children: [
            {
              id: "mcreceivedRma",
              filter: { column: "RM AVAIL", values: ["SA"] },
              label: "RMA",
              accent: "text-emerald-300",
              edge: "rgb(110 231 183)",
              children: [
                {
                  id: "inspectionDone",
                  filter: { column: "Inspection", values: ["DONE"] },
                  label: "Inspection Done",
                  accent: "text-emerald-300",
                  edge: "rgb(110 231 183)",
                },
              ]
            },
            {
              id: "mcreceivedRmna",
              filter: { column: "RM AVAIL", values: ["Not available"] },
              label: "RMNA",
              accent: "text-rose-300",
              edge: "rgb(253 164 175)",
            },
          ],
        },
        {
          id: "mcpending",
          filter: { column: "MC Received/Pending", values: ["PENDING"] },
          label: "MC Pending",
          accent: "text-amber-300",
          edge: "rgb(252 211 77)",
          children: [
            {
              id: "mcpendingRma",
              filter: { column: "RM AVAIL", values: ["SA"] },
              label: "RMA",
              accent: "text-emerald-300",
              edge: "rgb(110 231 183)",
            },
            {
              id: "mcpendingRmna",
              filter: { column: "RM AVAIL", values: ["Not available"] },
              label: "RMNA",
              accent: "text-rose-300",
              edge: "rgb(253 164 175)",
            },
          ]
        },
      ],
    },
    {
      id: "livePending",
      filter: { column: "CLEARANCE STATUS", values: ["PENDING", ""] },
      label: "Pending",
      accent: "text-amber-300",
      edge: "rgb(252 211 77)",
      children: [
        {
          id: "pendingRma",
          filter: { column: "RM AVAIL", values: ["SA"] },
          label: "RMA",
          accent: "text-emerald-300",
          edge: "rgb(110 231 183)",
        },
        {
          id: "pendingRmna",
          filter: { column: "RM AVAIL", values: ["Not available"] },
          label: "RMNA",
          accent: "text-rose-300",
          edge: "rgb(253 164 175)",
        },
      ],
    },
  ],
};

export const CLOSED_TREE: FlowNode = {
  id: "closed",
  filter: { column: "STATUS", values: ["CLOSED", "closed"] },
  label: "Closed",
  accent: "text-rose-300",
  edge: "rgb(253 164 175)",
};

export const CONTRACT_REVIEW_TREES: {
  tree: FlowNode;
  heading: string;
  tone: string;
}[] = [
  { tree: LIVE_TREE, heading: "Live", tone: "text-cyan-300/80" },
  { tree: CLOSED_TREE, heading: "Closed", tone: "text-rose-300/80" },
];

/** Every node of a tree, depth-first. */
export function flatten(node: FlowNode): FlowNode[] {
  const out: FlowNode[] = [node];
  for (const kid of node.children ?? []) out.push(...flatten(kid));
  return out;
}

/**
 * Ancestor chain for a node id, root first, excluding the node itself.
 * Replaces the two hand-maintained parentMap/childrenMap tables the old chart
 * carried, which had drifted out of sync with the rendered tree.
 */
export function ancestorsOf(root: FlowNode, id: string): FlowNode[] {
  const trail: FlowNode[] = [];
  const walk = (node: FlowNode): boolean => {
    if (node.id === id) return true;
    for (const kid of node.children ?? []) {
      trail.push(node);
      if (walk(kid)) return true;
      trail.pop();
    }
    return false;
  };
  return walk(root) ? trail : [];
}

/** Every descendant of a node id, excluding the node itself. */
export function descendantsOf(root: FlowNode, id: string): FlowNode[] {
  const found = flatten(root).find((n) => n.id === id);
  if (!found) return [];
  return (found.children ?? []).flatMap((kid) => flatten(kid));
}

/** Full path for a node id, root first, including the node itself. */
export function pathTo(root: FlowNode, id: string): FlowNode[] {
  return [...ancestorsOf(root, id), findById(root, id)].filter(
    (n): n is FlowNode => !!n,
  );
}

function findById(node: FlowNode, id: string): FlowNode | null {
  if (node.id === id) return node;
  for (const kid of node.children ?? []) {
    const found = findById(kid, id);
    if (found) return found;
  }
  return null;
}
