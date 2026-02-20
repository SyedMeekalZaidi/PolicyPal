"use client";

// TipTap-powered chat editor with @ mention autocomplete.
// Enter = submit, Shift+Enter = newline, @ = mention dropdown.
import { useCallback, useMemo, useRef, useState } from "react";
import { SendHorizonal } from "lucide-react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Mention from "@tiptap/extension-mention";
import { Extension } from "@tiptap/core";

import { Button } from "@/components/ui/button";
import { useDocuments } from "@/hooks/queries/use-documents";
import { useSets } from "@/hooks/queries/use-sets";
import type { JSONContent } from "@tiptap/core";
import {
  extractMentions,
  type ChatSubmitPayload,
} from "@/lib/chat/extract-mentions";
import {
  buildMentionItems,
  filterMentionItems,
  type MentionItem,
} from "@/lib/chat/mention-items";
import { createSuggestionRenderer } from "@/components/chat/mention-list";

// ─── Custom Mention extension with "category" attribute ─────────────────────

const CustomMention = Mention.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      category: { default: null },
    };
  },
});

// ─── Submit-on-Enter extension (created once, reads from ref) ───────────────

function buildSubmitExtension(onSubmit: React.RefObject<() => void>) {
  return Extension.create({
    name: "submitOnEnter",
    addKeyboardShortcuts() {
      return {
        Enter: () => {
          onSubmit.current();
          return true;
        },
      };
    },
  });
}

// ─── Component ──────────────────────────────────────────────────────────────

type Props = {
  /** payload = structured data for backend; doc = raw TipTap JSON for rich rendering */
  onSubmit: (payload: ChatSubmitPayload, doc: JSONContent) => void;
  disabled?: boolean;
};

export function ChatInput({ onSubmit, disabled = false }: Props) {
  const submitCallbackRef = useRef(onSubmit);
  submitCallbackRef.current = onSubmit;

  const editorRef = useRef<ReturnType<typeof useEditor>>(null);
  const [hasContent, setHasContent] = useState(false);

  // ── Data bridge: React Query → useRef → TipTap's suggestion.items ───────

  const { data: docs = [] } = useDocuments();
  const { data: sets = [] } = useSets();

  const mentionItems = useMemo(
    () => buildMentionItems(docs, sets),
    [docs, sets]
  );

  const mentionItemsRef = useRef<MentionItem[]>(mentionItems);
  mentionItemsRef.current = mentionItems;

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const text = editor.getText().trim();
    if (!text) return;

    const doc = editor.getJSON();
    const payload = extractMentions(doc, text);
    submitCallbackRef.current(payload, doc);

    editor.commands.clearContent(true);
    setHasContent(false);
  }, []);

  // ── Extensions (created once via useRef) ────────────────────────────────

  const handleSubmitRef = useRef(handleSubmit);
  handleSubmitRef.current = handleSubmit;

  const submitExt = useRef(buildSubmitExtension(handleSubmitRef));
  const suggestionRenderer = useRef(createSuggestionRenderer());

  const mentionExt = useRef(
    CustomMention.configure({
      renderHTML({ node }) {
        const category = node.attrs.category || "action";
        return [
          "span",
          {
            class: `mention-pill mention-${category}`,
            "data-category": category,
          },
          `@${node.attrs.label || node.attrs.id}`,
        ];
      },
      suggestion: {
        items: ({ query }: { query: string }) =>
          filterMentionItems(mentionItemsRef.current, query),

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        command: ({ editor, range, props: item }: any) => {
          const typedItem = item as MentionItem;
          if (!editor) return;
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              {
                type: "mention",
                attrs: {
                  id: typedItem.id,
                  label: typedItem.label,
                  category: typedItem.category,
                },
              },
              { type: "text", text: " " },
            ])
            .run();
        },

        render: suggestionRenderer.current,
      },
    })
  );

  // ── Editor ──────────────────────────────────────────────────────────────

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
      }),
      Placeholder.configure({
        placeholder: "Type a question… Use @ to tag actions, docs, or sets",
      }),
      mentionExt.current,
      submitExt.current,
    ],
    editorProps: {
      attributes: {
        class:
          "text-sm leading-relaxed max-h-32 overflow-y-auto px-3 py-2.5",
      },
    },
    onUpdate: ({ editor: e }) => setHasContent(!e.isEmpty),
    editable: !disabled,
    immediatelyRender: false,
  });

  editorRef.current = editor;

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex items-end gap-2">
      <div className="flex-1 rounded-xl bg-white/20 border border-white/10 transition-colors focus-within:border-primary/30 focus-within:bg-white/30">
        <EditorContent editor={editor} />
      </div>
      <Button
        size="icon"
        className="rounded-xl flex-shrink-0 mb-0.5"
        aria-label="Send message"
        disabled={disabled || !hasContent}
        onClick={handleSubmit}
      >
        <SendHorizonal className="h-4 w-4" />
      </Button>
    </div>
  );
}
