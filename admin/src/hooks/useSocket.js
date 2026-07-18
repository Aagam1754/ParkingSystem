import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || window.location.origin;

export function useSocket(handlers = {}) {
  const [live, setLive] = useState(false);

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
    socket.on('connect', () => setLive(true));
    socket.on('disconnect', () => setLive(false));

    Object.entries(handlers).forEach(([event, fn]) => {
      if (typeof fn === 'function') socket.on(event, fn);
    });

    return () => {
      Object.entries(handlers).forEach(([event, fn]) => {
        if (typeof fn === 'function') socket.off(event, fn);
      });
      socket.disconnect();
    };
    // handlers intentionally stable via caller useCallback/useMemo when needed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { live };
}
