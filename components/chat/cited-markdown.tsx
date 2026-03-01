"use client";

// Markdown renderer with Perplexity-style inline citation bubbles.
//
// Parsing pipeline:
//   1. react-markdown + remark-gfm renders the response as semantic HTML
//   2. Custom `p` and `li` component overrides walk their children
//   3. String children are split on consecutive [N][M]... marker groups
//   4. Each text segment + its trailing citation group becomes:
//      - <span data-cite-group="msgId-gN" className={active? highlight}>text</span>
//      - <CitationBubble groupId="msgId-gN" citationIds=[N,M] .../>
//   5. Bottom "View All" pill shows total citation count; clears highlight via context
//
// groupIds are prefixed with messageId ("msg123-g0") to prevent cross-message
// highlight collisions when multiple AI messages are on screen simultaneously.
//
// Citation state (highlightedGroup, setHighlightedGroup, setActiveCitations) is read
// from CitationContext so ChatPanel doesn't need to thread these as props.

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText } from "lucide-react";

import { CitationBubble } from "@/components/chat/citation-bubble";
import { useCitationContext } from "@/context/citation-context";
import type { Citation } from "@/lib/types/chat";

type Props = {
  content: string;
  citations: Citation[];
  messageId: string;
};

// Matches one or more consecutive [N] markers with no space between, e.g. "[1][2][3]"
const CITATION_SPLIT_RE = /(\[\d+\](?:\[\d+\])*)/g;

export function CitedMarkdown({ content, citations, messageId }: Props) {
  const { highlightedGroup, setHighlightedGroup, setActiveCitations } = useCitationContext();

  // groupCounter resets to 0 each render; incremented synchronously during ReactMarkdown's
  // component overrides (single render pass) — produces stable, deterministic span IDs.
  const groupCounter = { current: 0 };

  // ---------------------------------------------------------------------------
  // Bubble click: update context so Sources Panel and text highlight both react
  // ---------------------------------------------------------------------------

  function handleBubbleClick(group: { spanId: string; citationIds: number[] } | null) {
    if (group) {
      // Replace active citations with this message's citations and highlight the group
      setActiveCitations(citations);
      setHighlightedGroup(group);
    } else {
      // "View All" — clear highlight but keep citations visible
      setHighlightedGroup(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Core citation text parser
  // ---------------------------------------------------------------------------

  function processCitationText(text: string): React.ReactNode[] {
    // Split by citation marker groups (capture group → alternating text/marker array)
    // e.g. "Capital [1][2]. FSA [3]." → ["Capital ", "[1][2]", ". FSA ", "[3]", "."]
    const parts = text.split(CITATION_SPLIT_RE);
    const elements: React.ReactNode[] = [];

    for (let i = 0; i < parts.length; i += 2) {
      const textPart = parts[i];      // even index: plain text (may be empty string)
      const markerPart = parts[i + 1]; // odd index: citation marker group or undefined

      if (markerPart) {
        const citationIds = markerPart.match(/\d+/g)?.map(Number) ?? [];
        const groupId = `${messageId}-g${groupCounter.current++}`;
        const isActive = highlightedGroup?.spanId === groupId;

        // Wrap preceding text in a highlighted span (the text this citation supports)
        if (textPart) {
          elements.push(
            <span
              key={`s-${groupId}`}
              data-cite-group={groupId}
              className={
                isActive
                  ? "bg-primary/10 rounded-sm px-0.5 transition-colors"
                  : "transition-colors"
              }
            >
              {textPart}
            </span>
          );
        }

        elements.push(
          <CitationBubble
            key={`b-${groupId}`}
            groupId={groupId}
            citationIds={citationIds}
            count={citationIds.length}
            isActive={isActive}
            onClick={handleBubbleClick}
          />
        );
      } else if (textPart) {
        // Trailing text with no following citation marker
        elements.push(<span key={`t-${i}`}>{textPart}</span>);
      }
    }

    return elements;
  }

  // ---------------------------------------------------------------------------
  // Children walker — handles string and mixed content (bold, italic, links, etc.)
  // ---------------------------------------------------------------------------

  function processReactChildren(children: React.ReactNode): React.ReactNode {
    if (typeof children === "string") {
      const result = processCitationText(children);
      if (result.length === 0) return null;
      return result.length === 1 ? result[0] : <>{result}</>;
    }

    if (Array.isArray(children)) {
      return (
        <>
          {children.map((child, i) => {
            if (typeof child === "string") {
              const result = processCitationText(child);
              return <React.Fragment key={i}>{result}</React.Fragment>;
            }
            return <React.Fragment key={i}>{child}</React.Fragment>;
          })}
        </>
      );
    }

    // null, undefined, boolean, number, single React element — pass through
    return children;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-1.5">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Block elements — main citation injection targets
          p: ({ node: _node, children, ...props }) => (
            <p className="leading-relaxed" {...props}>
              {processReactChildren(children)}
            </p>
          ),
          li: ({ node: _node, children, ...props }) => (
            <li {...props}>{processReactChildren(children)}</li>
          ),

          // Lists
          ul: ({ node: _node, children, ...props }) => (
            <ul className="list-disc list-outside ml-4 space-y-0.5 my-1.5" {...props}>
              {children}
            </ul>
          ),
          ol: ({ node: _node, children, ...props }) => (
            <ol className="list-decimal list-outside ml-4 space-y-0.5 my-1.5" {...props}>
              {children}
            </ol>
          ),

          // Headings
          h1: ({ node: _node, children, ...props }) => (
            <h1 className="text-base font-bold mt-3 mb-1" {...props}>{children}</h1>
          ),
          h2: ({ node: _node, children, ...props }) => (
            <h2 className="text-sm font-semibold mt-3 mb-1" {...props}>{children}</h2>
          ),
          h3: ({ node: _node, children, ...props }) => (
            <h3 className="text-sm font-medium mt-2 mb-0.5" {...props}>{children}</h3>
          ),

          // Inline formatting
          strong: ({ node: _node, children, ...props }) => (
            <strong className="font-semibold text-foreground" {...props}>{children}</strong>
          ),
          em: ({ node: _node, children, ...props }) => (
            <em className="italic" {...props}>{children}</em>
          ),
          code: ({ node: _node, children, ...props }) => (
            <code className="rounded bg-black/5 px-1 py-0.5 font-mono text-xs" {...props}>
              {children}
            </code>
          ),

          // Block code
          pre: ({ node: _node, children, ...props }) => (
            <pre
              className="rounded-lg bg-black/5 p-3 overflow-x-auto text-xs font-mono my-2"
              {...props}
            >
              {children}
            </pre>
          ),

          // Tables — horizontal scroll wrapper for Compare mode
          table: ({ node: _node, children, ...props }) => (
            <div className="overflow-x-auto my-2">
              <table
                className="min-w-full text-xs border-collapse border border-white/20"
                {...props}
              >
                {children}
              </table>
            </div>
          ),
          th: ({ node: _node, children, ...props }) => (
            <th
              className="border border-white/20 bg-primary/5 px-2.5 py-1.5 text-left font-semibold text-xs"
              {...props}
            >
              {children}
            </th>
          ),
          td: ({ node: _node, children, ...props }) => (
            <td className="border border-white/20 px-2.5 py-1.5 text-xs" {...props}>
              {children}
            </td>
          ),

          // Blockquote
          blockquote: ({ node: _node, children, ...props }) => (
            <blockquote
              className="border-l-2 border-primary/40 pl-3 italic text-muted-foreground my-2"
              {...props}
            >
              {children}
            </blockquote>
          ),

          hr: ({ node: _node, ...props }) => (
            <hr className="border-white/20 my-3" {...props} />
          ),
        }}
      >
        {content}
      </ReactMarkdown>

      {/* View All pill — clears highlight so Sources Panel shows all citations */}
      {citations.length > 0 && (
        <button
          type="button"
          onClick={() => handleBubbleClick(null)}
          className="mt-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium bg-white/50 border border-white/60 text-muted-foreground hover:bg-white/70 hover:text-foreground transition-all duration-150"
        >
          <FileText className="h-3 w-3 text-primary" />
          {citations.length} source{citations.length !== 1 ? "s" : ""}
        </button>
      )}
    </div>
  );
}
