"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
}

// Mock auth mode - bypasses authentication checks
const USE_MOCK_AUTH =
  process.env.NEXT_PUBLIC_USE_MOCK_AUTH === "true" ||
  process.env.NODE_ENV === "development";

export function ProtectedRoute({
  children,
  requireAdmin = false,
}: ProtectedRouteProps) {
  const { user, loading, isAuthenticated, isAdmin } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // Skip auth checks in testing mode
    if (USE_MOCK_AUTH) {
      return;
    }

    if (!loading) {
      if (!isAuthenticated) {
        router.push("/login");
      } else if (requireAdmin && !isAdmin) {
        router.push("/chat");
      }
    }
  }, [loading, isAuthenticated, isAdmin, requireAdmin, router]);

  // In testing mode, still wait for auth to initialize
  if (USE_MOCK_AUTH) {
    if (loading) {
      return (
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      );
    }
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!isAuthenticated || (requireAdmin && !isAdmin)) {
    return null;
  }

  return <>{children}</>;
}
