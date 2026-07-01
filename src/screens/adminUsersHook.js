// Hook shared between AdminUsersBar / AdminUsersTable / AdminUsers.
// Single mount on EventsDashboard = single Firebase call.

import { useEffect, useState, useCallback } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';

export function useAdminUsers(autoLoad = true) {
  const [users, setUsers] = useState([]);
  const [nextPageToken, setNextPageToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadPage = useCallback(async (token) => {
    setLoading(true);
    setError(null);
    try {
      const fn = httpsCallable(getFunctions(), 'admin_listUsers');
      const res = await fn({ pageSize: 50, pageToken: token || undefined });
      const data = res.data;
      setUsers(data.users || []);
      setNextPageToken(data.nextPageToken || null);
    } catch (err) {
      setError(err?.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (autoLoad) loadPage(null);
  }, [autoLoad, loadPage]);

  return { users, setUsers, nextPageToken, loading, error, loadPage };
}

export function computeAdminStats(users) {
  const total = users.length;
  const admins = users.filter((u) => u.customClaims?.admin).length;
  const disabled = users.filter((u) => u.disabled).length;
  const verified = users.filter((u) => u.emailVerified).length;
  return { total, admins, disabled, verified };
}
