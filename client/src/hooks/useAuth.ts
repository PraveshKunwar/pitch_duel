import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  api,
  getAccessToken,
  refreshAccessToken,
  setAccessToken,
} from "../services/api";
import type { User } from "../types/game";

type AuthState = {
  user: User | null;
  loading: boolean;
  error: string | null;
};

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
    error: null,
  });

  const bootstrap = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      if (!getAccessToken()) {
        await refreshAccessToken();
      }
      if (!getAccessToken()) {
        setState({ user: null, loading: false, error: null });
        return;
      }
      const user = await api.me();
      setState({ user, loading: false, error: null });
    } catch {
      setAccessToken(null);
      setState({ user: null, loading: false, error: null });
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const login = useCallback(async (email: string, password: string) => {
    setState((s) => ({ ...s, error: null, loading: true }));
    try {
      const { user } = await api.login({ email, password });
      setState({ user, loading: false, error: null });
      return user;
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : "Login failed";
      setState((s) => ({ ...s, loading: false, error: message }));
      throw error;
    }
  }, []);

  const register = useCallback(
    async (email: string, username: string, password: string) => {
      setState((s) => ({ ...s, error: null, loading: true }));
      try {
        await api.register({ email, username, password });
        const { user } = await api.login({ email, password });
        setState({ user, loading: false, error: null });
        return user;
      } catch (error) {
        const message =
          error instanceof ApiError ? error.message : "Registration failed";
        setState((s) => ({ ...s, loading: false, error: message }));
        throw error;
      }
    },
    [],
  );

  const logout = useCallback(async () => {
    await api.logout();
    setState({ user: null, loading: false, error: null });
  }, []);

  const refreshUser = useCallback(async () => {
    const user = await api.me();
    setState((s) => ({ ...s, user }));
    return user;
  }, []);

  const applyRating = useCallback((rating: number) => {
    setState((s) =>
      s.user ? { ...s, user: { ...s.user, rating } } : s,
    );
  }, []);

  return {
    user: state.user,
    loading: state.loading,
    error: state.error,
    login,
    register,
    logout,
    refreshUser,
    applyRating,
    clearError: () => setState((s) => ({ ...s, error: null })),
  };
}
