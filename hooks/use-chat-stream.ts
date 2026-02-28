"use client";

// Custom hook for reading the chat SSE stream.
// Handles both /api/chat (new message) and /api/chat/resume (PalAssist response).
//
// Why NOT React Query: React Query mutations expect a single response. SSE emits
// multiple events over time. This hook uses fetch() + ReadableStream to call
// React setState on each event, giving ChatPanel fine-grained control via callbacks.
//
// Buffer pattern: network chunks don't align with SSE boundaries (\n\n), so we
// maintain a string buffer, split on \n\n, and carry the incomplete tail forward.

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatSubmitPayload } from "@/lib/chat/extract-mentions";
import type {
  ChatRequest,
  ChatResponse,
  ChatStreamEvent,
  InterruptResponse,
  ResumeRequest,
  ResumeValue,
  StatusEvent,
} from "@/lib/types/chat";

const STREAM_TIMEOUT_MS = 30_000;

type ChatStreamCallbacks = {
  onStatus?: (event: StatusEvent) => void;
  onResponse?: (event: ChatResponse) => void;
  onInterrupt?: (event: InterruptResponse) => void;
  onError?: (error: string) => void;
};

export function useChatStream(callbacks: ChatStreamCallbacks) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [reasoningStatus, setReasoningStatus] = useState<StatusEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Always call the latest callbacks — avoids stale closures in the async stream loop
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  // Abort stream and clear timeout on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // ── Timeout helpers ──────────────────────────────────────────────────────

  const _clearTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const _resetTimeout = useCallback(() => {
    _clearTimeout();
    timeoutRef.current = setTimeout(() => {
      abortControllerRef.current?.abort();
      setError("Connection timed out");
      setReasoningStatus(null);
      setIsStreaming(false);
      callbacksRef.current.onError?.("Connection timed out");
    }, STREAM_TIMEOUT_MS);
  }, [_clearTimeout]);

  // ── Core stream reader (shared between sendMessage + resumeGraph) ────────

  const _startStream = useCallback(
    async (url: string, body: unknown) => {
      // Cancel any in-flight stream before starting a new one
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsStreaming(true);
      setError(null);
      setReasoningStatus(null);
      _resetTimeout();

      // ── Fetch ──────────────────────────────────────────────────────────────
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        if ((err as Error).name === "AbortError") return; // intentional cancel
        const msg = "Connection lost";
        setError(msg);
        setIsStreaming(false);
        _clearTimeout();
        callbacksRef.current.onError?.(msg);
        return;
      }

      // Non-2xx before streaming starts (auth, validation, etc.)
      if (!response.ok) {
        let msg = "Request failed";
        try {
          const errorData = await response.json();
          msg = (errorData as { error?: string; message?: string }).error
            ?? (errorData as { message?: string }).message
            ?? msg;
        } catch { /* ignore parse errors */ }
        setError(msg);
        setIsStreaming(false);
        _clearTimeout();
        callbacksRef.current.onError?.(msg);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        const msg = "No response stream";
        setError(msg);
        setIsStreaming(false);
        _clearTimeout();
        callbacksRef.current.onError?.(msg);
        return;
      }

      // ── SSE read loop ──────────────────────────────────────────────────────
      const decoder = new TextDecoder();
      let buffer = "";
      let receivedTerminal = false;

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Split on SSE event boundary — \n\n
          // parts.pop() returns the incomplete trailing data; carry it forward
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";

          for (const part of parts) {
            const trimmed = part.trim();
            if (!trimmed.startsWith("data: ")) continue;

            const jsonStr = trimmed.slice(6); // strip "data: "
            let event: ChatStreamEvent;
            try {
              event = JSON.parse(jsonStr) as ChatStreamEvent;
            } catch {
              console.error("[useChatStream] Malformed SSE event:", jsonStr);
              continue;
            }

            _resetTimeout(); // activity received — push the timeout forward

            switch (event.type) {
              case "status":
                setReasoningStatus(event);
                callbacksRef.current.onStatus?.(event);
                break;

              case "response":
                receivedTerminal = true;
                setReasoningStatus(null);
                setIsStreaming(false);
                _clearTimeout();
                callbacksRef.current.onResponse?.(event);
                break;

              case "interrupt":
                receivedTerminal = true;
                setReasoningStatus(null);
                setIsStreaming(false);
                _clearTimeout();
                callbacksRef.current.onInterrupt?.(event);
                break;

              default: {
                // Backend error event: { type: "error", message: "..." }
                const errEvent = event as unknown as { type: string; message?: string };
                const errMsg = errEvent.message ?? "Stream error";
                setError(errMsg);
                setReasoningStatus(null);
                setIsStreaming(false);
                _clearTimeout();
                callbacksRef.current.onError?.(errMsg);
                break;
              }
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return; // intentional cancel/timeout
        const msg = "Connection lost";
        setError(msg);
        setReasoningStatus(null);
        setIsStreaming(false);
        _clearTimeout();
        callbacksRef.current.onError?.(msg);
        return;
      }

      // Stream closed by server without sending a terminal event
      if (!receivedTerminal) {
        const msg = "Unexpected stream end";
        setError(msg);
        setReasoningStatus(null);
        setIsStreaming(false);
        _clearTimeout();
        callbacksRef.current.onError?.(msg);
      }
    },
    [_resetTimeout, _clearTimeout]
  );

  // ── Public API ────────────────────────────────────────────────────────────

  const sendMessage = useCallback(
    ({ payload, threadId }: { payload: ChatSubmitPayload; threadId: string }) => {
      const chatRequest: ChatRequest = {
        message: payload.text,
        tiptap_json: payload.tiptap_json,
        thread_id: threadId,
        tagged_doc_ids: payload.tagged_doc_ids,
        tagged_set_ids: payload.tagged_set_ids,
        action: payload.action,
        enable_web_search: payload.enable_web_search,
      };
      _startStream("/api/chat", chatRequest);
    },
    [_startStream]
  );

  const resumeGraph = useCallback(
    (threadId: string, resumeValue: ResumeValue) => {
      const resumeRequest: ResumeRequest = {
        thread_id: threadId,
        resume_value: resumeValue,
      };
      _startStream("/api/chat/resume", resumeRequest);
    },
    [_startStream]
  );

  /** Abort the active stream. Safe to call when nothing is streaming. */
  const cancel = useCallback(() => {
    abortControllerRef.current?.abort();
    _clearTimeout();
    setIsStreaming(false);
    setReasoningStatus(null);
  }, [_clearTimeout]);

  return {
    isStreaming,
    reasoningStatus,
    error,
    sendMessage,
    resumeGraph,
    cancel,
  };
}
