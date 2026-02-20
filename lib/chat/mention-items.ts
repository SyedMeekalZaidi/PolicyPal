import type { MentionCategory } from "./extract-mentions";
import type { DocumentWithSet, SetRow } from "@/lib/types/documents";

export type MentionItem = {
  id: string;
  label: string;
  category: MentionCategory;
  docType?: string;
  setColor?: string;
  /** Document's set_id — used by filter to include docs whose set name matches */
  setId?: string;
};

export const STATIC_ACTIONS: MentionItem[] = [
  { id: "summarize", label: "Summarize", category: "action" },
  { id: "inquire", label: "Inquire", category: "action" },
  { id: "compare", label: "Compare", category: "action" },
  { id: "audit", label: "Audit", category: "action" },
];

const WEB_SEARCH_ITEM: MentionItem = {
  id: "web_search",
  label: "Web Search",
  category: "web",
};

export function buildMentionItems(
  docs: DocumentWithSet[],
  sets: SetRow[]
): MentionItem[] {
  const setItems: MentionItem[] = sets.map((s) => ({
    id: s.id,
    label: s.name,
    category: "set" as const,
    setColor: s.color ?? undefined,
  }));

  const docItems: MentionItem[] = docs
    .filter((d) => d.status === "ready")
    .map((d) => ({
      id: d.id,
      label: d.title,
      category: "document" as const,
      docType: d.doc_type,
      setColor: d.sets?.color ?? undefined,
      setId: d.set_id ?? undefined,
    }));

  return [...STATIC_ACTIONS, ...setItems, ...docItems, WEB_SEARCH_ITEM];
}

/**
 * Filters mention items by query. Matches same pattern as DocumentPanel:
 * - Direct label substring match (case-insensitive)
 * - Sets whose names match → also include all their documents
 */
export function filterMentionItems(
  items: MentionItem[],
  query: string
): MentionItem[] {
  if (!query.trim()) return items;
  const q = query.toLowerCase();

  const matchingSetIds = new Set(
    items
      .filter((i) => i.category === "set" && i.label.toLowerCase().includes(q))
      .map((i) => i.id)
  );

  return items.filter((item) => {
    if (item.label.toLowerCase().includes(q)) return true;
    if (
      item.category === "document" &&
      item.setId &&
      matchingSetIds.has(item.setId)
    )
      return true;
    return false;
  });
}
