import type { JSONContent } from "@tiptap/core";

export type MentionCategory = "action" | "set" | "document" | "web";

export type ChatSubmitPayload = {
  text: string;
  action: string | null;
  tagged_doc_ids: string[];
  tagged_set_ids: string[];
  enable_web_search: boolean;
};

/**
 * Walks TipTap document JSON, extracts mention nodes, and returns a
 * structured payload ready for the backend.
 *
 * Mention nodes are expected to have attrs: { id, label, category }.
 * Category determines which bucket the mention falls into.
 */
export function extractMentions(
  doc: JSONContent,
  plainText: string
): ChatSubmitPayload {
  const tagged_doc_ids: string[] = [];
  const tagged_set_ids: string[] = [];
  let action: string | null = null;
  let enable_web_search = false;

  function walk(node: JSONContent) {
    if (node.type === "mention" && node.attrs) {
      const { id, category } = node.attrs as {
        id: string;
        category: MentionCategory;
      };

      switch (category) {
        case "document":
          if (!tagged_doc_ids.includes(id)) tagged_doc_ids.push(id);
          break;
        case "set":
          if (!tagged_set_ids.includes(id)) tagged_set_ids.push(id);
          break;
        case "action":
          action = id;
          break;
        case "web":
          enable_web_search = true;
          break;
      }
    }

    node.content?.forEach(walk);
  }

  walk(doc);

  return { text: plainText, action, tagged_doc_ids, tagged_set_ids, enable_web_search };
}

/** Counts how many document mentions currently exist in a TipTap document. */
export function countDocMentions(doc: JSONContent): number {
  let count = 0;
  function walk(node: JSONContent) {
    if (node.type === "mention" && node.attrs?.category === "document") count++;
    node.content?.forEach(walk);
  }
  walk(doc);
  return count;
}
