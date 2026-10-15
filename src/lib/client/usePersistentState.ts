"use client";

import { useEffect, useRef, useState } from "react";

/**
 * useState, который сохраняет значение в localStorage
 * и восстанавливает его при монтировании.
 * Безопасен для SSR: на сервере возвращает initialValue.
 */
export function usePersistentState<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initialValue;
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? initialValue : (JSON.parse(raw) as T);
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* quota exceeded — игнорируем */
    }
  }, [key, value]);

  return [value, setValue] as const;
}
