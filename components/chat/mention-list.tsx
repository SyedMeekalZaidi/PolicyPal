"use client";

// Mention dropdown: 4 categorized sections (Actions, Sets, Documents, Web).
// Rendered by TipTap's ReactRenderer inside a fixed-position popup.
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import {
  ArrowLeftRight,
  ClipboardList,
  FileText,
  FolderOpen,
  Globe,
  Search,
  ShieldCheck,
} from "lucide-react";
import type { Editor } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { hexToRgba } from "@/lib/constants/colors";
import { countActionMentions, countDocMentions } from "@/lib/chat/extract-mentions";
import type { MentionItem } from "@/lib/chat/mention-items";

// ─── Types ──────────────────────────────────────────────────────────────────

export type MentionListRef = {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
};

type MentionListProps = {
  items: MentionItem[];
  command: (item: MentionItem) => void;
  editor: Editor;
};

type SectionDef = {
  label: string;
  category: string;
  items: MentionItem[];
  offset: number;
};

// ─── Constants ──────────────────────────────────────────────────────────────

const DOC_TYPE_ACCENT: Record<string, string> = {
  regulatory_source: "#FEC872",
  company_policy: "#10B981",
};

const ACTION_ICONS: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  summarize: ClipboardList,
  inquire: Search,
  compare: ArrowLeftRight,
  audit: ShieldCheck,
};

// ─── MentionList ────────────────────────────────────────────────────────────

export const MentionList = forwardRef<MentionListRef, MentionListProps>(
  (props, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);

    const grouped = useMemo(() => {
      const a: MentionItem[] = [];
      const s: MentionItem[] = [];
      const d: MentionItem[] = [];
      const w: MentionItem[] = [];
      for (const item of props.items) {
        if (item.category === "action") a.push(item);
        else if (item.category === "set") s.push(item);
        else if (item.category === "document") d.push(item);
        else if (item.category === "web") w.push(item);
      }
      return { actions: a, sets: s, docs: d, web: w };
    }, [props.items]);

    const sections = useMemo(() => {
      const result: SectionDef[] = [];
      let offset = 0;
      const { actions, sets, docs, web } = grouped;
      if (actions.length) {
        result.push({ label: "Actions", category: "action", items: actions, offset });
        offset += actions.length;
      }
      if (sets.length) {
        result.push({ label: "Sets", category: "set", items: sets, offset });
        offset += sets.length;
      }
      if (docs.length) {
        result.push({ label: "Documents", category: "document", items: docs, offset });
        offset += docs.length;
      }
      if (web.length) {
        result.push({ label: "Web", category: "web", items: web, offset });
        offset += web.length;
      }
      return result;
    }, [grouped]);

    const flatCount = useMemo(
      () => sections.reduce((sum, s) => sum + s.items.length, 0),
      [sections]
    );

    useEffect(() => {
      setSelectedIndex(0);
    }, [props.items]);

    const selectItem = useCallback(
      (index: number) => {
        const item = findFlatItem(sections, index);
        if (!item) return;

        if (item.category === "action") {
          const actionCount = countActionMentions(props.editor.getJSON());
          if (actionCount >= 1) {
            toast.warning("Only one action per query — remove the existing one first");
            return;
          }
        }

        if (item.category === "document") {
          const docCount = countDocMentions(props.editor.getJSON());
          if (docCount >= 5) {
            toast.warning("Maximum 5 documents per query");
            return;
          }
        }

        props.command(item);
      },
      [props, sections]
    );

    useImperativeHandle(
      ref,
      () => ({
        onKeyDown: ({ event }) => {
          if (event.key === "ArrowUp") {
            setSelectedIndex((p) => (p + flatCount - 1) % flatCount);
            return true;
          }
          if (event.key === "ArrowDown") {
            setSelectedIndex((p) => (p + 1) % flatCount);
            return true;
          }
          if (event.key === "Enter" || event.key === "Tab") {
            selectItem(selectedIndex);
            return true;
          }
          return false;
        },
      }),
      [flatCount, selectItem, selectedIndex]
    );

    if (flatCount === 0) {
      return (
        <div className="rounded-xl bg-popover border border-border shadow-lg p-3 min-w-[240px]">
          <p className="text-xs text-muted-foreground text-center">
            No matches
          </p>
        </div>
      );
    }

    return (
      <div className="rounded-xl bg-popover border border-border shadow-lg p-1.5 min-w-[280px] max-w-[340px] max-h-[320px] overflow-y-auto">
        {sections.map((section) => (
          <div key={section.category} className="mb-1 last:mb-0">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide px-2 py-1">
              {section.label}
            </p>

            {section.category === "action" ? (
              <div className="grid grid-cols-2 gap-0.5">
                {section.items.map((item, i) => {
                  const flatIdx = section.offset + i;
                  const Icon = ACTION_ICONS[item.id] ?? ClipboardList;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={cn(
                        "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                        flatIdx === selectedIndex
                          ? "bg-primary/10 text-primary"
                          : "text-foreground hover:bg-accent"
                      )}
                      onMouseEnter={() => setSelectedIndex(flatIdx)}
                      onClick={() => selectItem(flatIdx)}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {section.items.map((item, i) => {
                  const flatIdx = section.offset + i;
                  return (
                    <MentionRow
                      key={item.id}
                      item={item}
                      isSelected={flatIdx === selectedIndex}
                      onMouseEnter={() => setSelectedIndex(flatIdx)}
                      onClick={() => selectItem(flatIdx)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }
);

MentionList.displayName = "MentionList";

// ─── Row renderers ──────────────────────────────────────────────────────────

function MentionRow({
  item,
  isSelected,
  onMouseEnter,
  onClick,
}: {
  item: MentionItem;
  isSelected: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
}) {
  if (item.category === "document") {
    const accent = DOC_TYPE_ACCENT[item.docType ?? ""] ?? "#4A9EFF";
    const bgTint = item.setColor ? hexToRgba(item.setColor, 0.08) : undefined;
    return (
      <button
        type="button"
        className={cn(
          "relative flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors overflow-hidden",
          isSelected ? "bg-primary/10" : "hover:bg-accent"
        )}
        style={
          bgTint && !isSelected ? { backgroundColor: bgTint } : undefined
        }
        onMouseEnter={onMouseEnter}
        onClick={onClick}
      >
        <span
          className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-lg"
          style={{ backgroundColor: accent }}
        />
        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground ml-1" />
        <span className="truncate font-medium text-foreground">
          {item.label}
        </span>
      </button>
    );
  }

  if (item.category === "set") {
    const bgTint = item.setColor ? hexToRgba(item.setColor, 0.12) : undefined;
    return (
      <button
        type="button"
        className={cn(
          "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors",
          isSelected ? "bg-primary/10" : "hover:bg-accent"
        )}
        style={
          bgTint && !isSelected ? { backgroundColor: bgTint } : undefined
        }
        onMouseEnter={onMouseEnter}
        onClick={onClick}
      >
        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium text-foreground">
          {item.label}
        </span>
      </button>
    );
  }

  if (item.category === "web") {
    return (
      <button
        type="button"
        className={cn(
          "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors",
          isSelected ? "bg-primary/10" : "hover:bg-accent"
        )}
        onMouseEnter={onMouseEnter}
        onClick={onClick}
      >
        <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium text-foreground">
          {item.label}
        </span>
      </button>
    );
  }

  return null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function findFlatItem(
  sections: SectionDef[],
  flatIdx: number
): MentionItem | null {
  for (const section of sections) {
    if (flatIdx >= section.offset && flatIdx < section.offset + section.items.length) {
      return section.items[flatIdx - section.offset];
    }
  }
  return null;
}

// ─── Suggestion renderer (TipTap lifecycle) ─────────────────────────────────

function positionPopup(
  popup: HTMLDivElement,
  clientRect: (() => DOMRect | null) | null | undefined
) {
  if (!clientRect) return;
  const rect = clientRect();
  if (!rect) return;

  popup.style.left = `${rect.left}px`;
  popup.style.bottom = `${window.innerHeight - rect.top + 4}px`;
  popup.style.top = "auto";
}

export function createSuggestionRenderer() {
  return () => {
    let component: ReactRenderer<MentionListRef> | null = null;
    let popup: HTMLDivElement | null = null;

    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onStart: (props: any) => {
        component = new ReactRenderer(MentionList, {
          props,
          editor: props.editor,
        });

        popup = document.createElement("div");
        popup.style.position = "fixed";
        popup.style.zIndex = "50";
        document.body.appendChild(popup);
        popup.appendChild(component.element);

        positionPopup(popup, props.clientRect);
      },

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onUpdate: (props: any) => {
        component?.updateProps(props);
        if (popup) positionPopup(popup, props.clientRect);
      },

      onKeyDown: (props: { event: KeyboardEvent }) => {
        if (props.event.key === "Escape") {
          component?.destroy();
          component = null;
          popup?.remove();
          popup = null;
          return true;
        }
        return component?.ref?.onKeyDown(props) ?? false;
      },

      onExit: () => {
        component?.destroy();
        component = null;
        popup?.remove();
        popup = null;
      },
    };
  };
}
