"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { authApi, User, LoginCredentials, RegisterData } from "@/lib/api/auth";
import { ApiError, apiClient } from "@/lib/api/client";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  login: (credentials: LoginCredentials) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Mock user for testing - set to true to bypass authentication
const USE_MOCK_AUTH =
  process.env.NEXT_PUBLIC_USE_MOCK_AUTH === "true" ||
  process.env.NODE_ENV === "development";

const MOCK_USER: User = {
  id: "test-user",
  email: "test@example.com",
  name: "Test User",
  role: "admin",
  createdAt: "2024-01-01T00:00:00Z",
};

const MOCK_TOKEN = "mock-test-token";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastActivity, setLastActivity] = useState<number>(Date.now());

  const applyUser = useCallback((nextUser: User | null) => {
    setUser(nextUser);
    apiClient.setUserId(nextUser?.id ?? null);
    if (USE_MOCK_AUTH) {
      apiClient.setToken(nextUser ? MOCK_TOKEN : null);
    }
    if (nextUser) {
      setLastActivity(Date.now());
    }
  }, []);

  const refreshUser = useCallback(async () => {
    // In testing mode, automatically set mock user
    if (USE_MOCK_AUTH) {
      applyUser(MOCK_USER);
      setLoading(false);
      return;
    }

    try {
      const currentUser = await authApi.getCurrentUser();
      applyUser(currentUser);
    } catch (error) {
      applyUser(null);
      if (error instanceof ApiError && error.status !== 401) {
        console.error("Failed to fetch user:", error);
      }
    } finally {
      setLoading(false);
    }
  }, [applyUser]);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  // Session timeout handler
  useEffect(() => {
    if (!user || USE_MOCK_AUTH) return;

    const SESSION_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes
    const WARNING_TIME_MS = 5 * 60 * 1000; // 5 minutes before timeout

    const checkTimeout = () => {
      const now = Date.now();
      const timeSinceActivity = now - lastActivity;

      if (timeSinceActivity >= SESSION_TIMEOUT_MS) {
        // Session expired
        logout();
        if (typeof window !== "undefined") {
          window.location.href = "/login?reason=timeout";
        }
      } else if (timeSinceActivity >= SESSION_TIMEOUT_MS - WARNING_TIME_MS) {
        // Show warning (could implement a toast notification here)
        console.warn("Session will expire soon");
      }
    };

    // Check every minute
    const interval = setInterval(checkTimeout, 60 * 1000);

    // Update activity on user interactions
    const updateActivity = () => setLastActivity(Date.now());
    const events = ["mousedown", "keydown", "scroll", "touchstart"];
    events.forEach((event) => window.addEventListener(event, updateActivity));

    return () => {
      clearInterval(interval);
      events.forEach((event) =>
        window.removeEventListener(event, updateActivity)
      );
    };
  }, [user, lastActivity]);

  const login = async (credentials: LoginCredentials) => {
    // In testing mode, automatically succeed with mock user
    if (USE_MOCK_AUTH) {
      applyUser(MOCK_USER);
      return;
    }

    try {
      const response = await authApi.login(credentials);
      applyUser(response.user);
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new Error("Login failed");
    }
  };

  const register = async (data: RegisterData) => {
    // In testing mode, automatically succeed with mock user
    if (USE_MOCK_AUTH) {
      applyUser(MOCK_USER);
      return;
    }

    try {
      const response = await authApi.register(data);
      applyUser(response.user);
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new Error("Registration failed");
    }
  };

  const logout = async () => {
    // In testing mode, just clear the user
    if (USE_MOCK_AUTH) {
      applyUser(null);
      return;
    }

    try {
      await authApi.logout();
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      applyUser(null);
    }
  };

  const value: AuthContextType = {
    user,
    loading,
    isAuthenticated: !!user,
    isAdmin: user?.role === "admin" || user?.role === "super-admin",
    login,
    register,
    logout,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
