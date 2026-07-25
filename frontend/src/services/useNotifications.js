import { useState, useEffect, useCallback, useRef } from 'react';

let globalListeners = [];
let globalNotifs = [];
let globalUnread = 0;

function notifyListeners() {
  globalListeners.forEach(fn => fn([...globalNotifs], globalUnread));
}

export function pushNotification(notif) {
  globalNotifs = [{ id: Date.now() + Math.random(), time: new Date(), ...notif }, ...globalNotifs].slice(0, 80);
  globalUnread += 1;
  notifyListeners();
}

export function clearNotifications() {
  globalNotifs = [];
  globalUnread = 0;
  notifyListeners();
}

export function markRead() {
  globalUnread = 0;
  notifyListeners();
}

export function useNotifications() {
  const [notifs, setNotifs] = useState(globalNotifs);
  const [unread, setUnread] = useState(globalUnread);

  useEffect(() => {
    function listener(n, u) { setNotifs(n); setUnread(u); }
    globalListeners.push(listener);
    return () => { globalListeners = globalListeners.filter(l => l !== listener); };
  }, []);

  return { notifs, unread };
}
