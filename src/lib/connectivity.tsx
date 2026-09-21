import { useEffect, useRef } from 'react';
import { useSyncExternalStore } from 'react';
import { onlineManager, useQueryClient } from '@tanstack/react-query';

/** Mirrors React-Query's online state into the banner and refetch on reconnect. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (onChange) => onlineManager.subscribe(onChange),
    () => onlineManager.isOnline(),
  );
}

/** Offline banner; refetches the active feed when the connection returns. */
export function ConnectivityBanner() {
  const queryClient = useQueryClient();
  const online = useOnline();
  const wasOnline = useRef(online);

  useEffect(() => {
    if (online && !wasOnline.current) {
      void queryClient.refetchQueries({ queryKey: ['assets'], type: 'active' });
    }
    wasOnline.current = online;
  }, [online, queryClient]);

  if (online) return null;
  return (
    <p className="notice notice--offline" role="status" aria-live="polite">
      You're offline — showing what was already loaded. Reconnect and I'll refresh the list.
    </p>
  );
}