import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_MS = 180;

/** For panels with internal open state (Filters, Route). */
export function useAnimatedOpen(durationMs = DEFAULT_MS) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (!closing) {
      return;
    }
    const timer = window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, durationMs);
    return () => window.clearTimeout(timer);
  }, [closing, durationMs]);

  const requestOpen = useCallback(() => {
    setClosing(false);
    setOpen(true);
  }, []);

  const requestClose = useCallback(() => {
    if (!open || closing) {
      return;
    }
    setClosing(true);
  }, [open, closing]);

  return { open, closing, requestOpen, requestClose };
}

/** For parent-controlled panels: keep open until close animation finishes, then call onExited. */
export function useCloseAnimation(durationMs = DEFAULT_MS) {
  const [closing, setClosing] = useState(false);
  const onExitedRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!closing) {
      return;
    }
    const timer = window.setTimeout(() => {
      const onExited = onExitedRef.current;
      onExitedRef.current = null;
      onExited?.();
      setClosing(false);
    }, durationMs);
    return () => window.clearTimeout(timer);
  }, [closing, durationMs]);

  const beginClose = useCallback(
    (onExited: () => void) => {
      if (closing) {
        return;
      }
      onExitedRef.current = onExited;
      setClosing(true);
    },
    [closing],
  );

  return { closing, beginClose };
}
