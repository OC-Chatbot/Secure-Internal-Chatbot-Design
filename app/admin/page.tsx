"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";
import { adminApi, AdminStats, SystemSettings, User } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/client";
import { UserManagement } from "@/components/admin/UserManagement";
import { Header } from "@/components/layout/Header";
import { ApiKeyManagement } from "@/components/admin/ApiKeyManagement";

type TabKey = "stats" | "users" | "settings" | "api-keys";
const DEFAULT_MODELS = [
  "GPT-2 (Local)",
  "GPT-3.5 Turbo",
  "GPT-4",
  "GPT-4o Mini",
];

const TAB_CONFIG: { key: TabKey; label: string; description: string }[] = [
  {
    key: "stats",
    label: "Overview",
    description: "Metrics and usage",
  },
  {
    key: "users",
    label: "Users",
    description: "Manage accounts and roles",
  },
  {
    key: "settings",
    label: "LLM Settings",
    description: "Control model, tokens, limits",
  },
  {
    key: "api-keys",
    label: "API Keys",
    description: "Manage access keys",
  },
];

function AdminPageContent() {
  const { logout } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabKey>("stats");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [modelOptions, setModelOptions] = useState<string[]>(DEFAULT_MODELS);
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const navButtons = useMemo(() => TAB_CONFIG, []);

  useEffect(() => {
    const tabParam = searchParams.get("tab") as TabKey | null;
    if (
      tabParam &&
      ["stats", "users", "settings", "api-keys"].includes(tabParam)
    ) {
      setActiveTab(tabParam);
    }
  }, [searchParams]);

  useEffect(() => {
    loadData();
  }, [activeTab]);

  const loadData = async () => {
    setLoading(true);
    setError("");
    try {
      if (activeTab === "stats") {
        const data = await adminApi.getStats();
        setStats(data);
      } else if (activeTab === "users") {
        const data = await adminApi.getUsers();
        setUsers(data);
      } else if (activeTab === "settings") {
        const [settingsData, modelsData] = await Promise.all([
          adminApi.getSystemSettings(),
          adminApi.getAvailableModels().catch(() => DEFAULT_MODELS),
        ]);
        const mergedModels = Array.from(
          new Set([...(modelsData || DEFAULT_MODELS), settingsData.model])
        );
        setSettings(settingsData);
        setModelOptions(mergedModels);
      } else if (activeTab === "api-keys") {
        const keys = await adminApi.getApiKeys();
        setApiKeys(keys);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || "Failed to load data");
      } else {
        setError("An unexpected error occurred");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleTabChange = (tab: TabKey) => {
    setActiveTab(tab);
    router.replace(`/admin?tab=${tab}`);
  };

  const handleUpdateSettings = async (
    updatedSettings: Partial<SystemSettings>
  ) => {
    if (!settings) return;
    try {
      const updated = await adminApi.updateSystemSettings(updatedSettings);
      setSettings(updated);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || "Failed to update settings");
      } else {
        setError("An unexpected error occurred");
      }
    }
  };

  const handleLogout = async () => {
    await logout();
    router.push("/login");
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Header />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Dashboard Header */}
        <div className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Admin Dashboard
            </h1>
            <p className="mt-2 text-gray-600 dark:text-gray-400">
              Central control center for the platform
            </p>
          </div>
        </div>

        {/* Dashboard Menu */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          {navButtons.map((item) => {
            const isActive = activeTab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => handleTabChange(item.key)}
                className={`group text-left rounded-xl border transition-all duration-200 p-5 bg-white dark:bg-gray-800 ${
                  isActive
                    ? "border-blue-500 shadow-lg shadow-blue-500/10"
                    : "border-gray-200 dark:border-gray-700 hover:border-blue-400 hover:shadow-lg hover:shadow-blue-500/10"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-gray-900 dark:text-white">
                    {item.label}
                  </div>
                  <span
                    className={`text-xs px-2 py-1 rounded-full ${
                      isActive
                        ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200"
                        : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                    }`}
                  >
                    {isActive ? "Active" : "Inactive"}
                  </span>
                </div>
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                  {item.description}
                </p>
              </button>
            );
          })}
        </div>

        {/* Tabs */}
        <div className="mb-6 border-b border-gray-200 dark:border-gray-700">
          <nav className="flex space-x-8">
            {TAB_CONFIG.map((tab) => (
              <button
                key={tab.key}
                onClick={() => handleTabChange(tab.key)}
                className={`py-4 px-1 border-b-2 font-medium text-sm capitalize transition-colors ${
                  activeTab === tab.key
                    ? "border-blue-500 text-blue-600 dark:text-blue-400"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
            {activeTab === "stats" &&
              (stats ? (
                <div>
                  <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-6">
                    Statistics
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <div className="bg-blue-50 dark:bg-blue-900/20 p-6 rounded-lg">
                      <div className="text-sm text-blue-600 dark:text-blue-400 font-medium mb-2">
                        Total Users
                      </div>
                      <div className="text-3xl font-bold text-blue-900 dark:text-blue-100">
                        {stats.totalUsers}
                      </div>
                    </div>
                    <div className="bg-indigo-50 dark:bg-indigo-900/20 p-6 rounded-lg">
                      <div className="text-sm text-indigo-600 dark:text-indigo-400 font-medium mb-2">
                        Total Conversations
                      </div>
                      <div className="text-3xl font-bold text-indigo-900 dark:text-indigo-100">
                        {stats.totalConversations}
                      </div>
                    </div>
                    <div className="bg-purple-50 dark:bg-purple-900/20 p-6 rounded-lg">
                      <div className="text-sm text-purple-600 dark:text-purple-400 font-medium mb-2">
                        Total Messages
                      </div>
                      <div className="text-3xl font-bold text-purple-900 dark:text-purple-100">
                        {stats.totalMessages}
                      </div>
                    </div>
                    <div className="bg-green-50 dark:bg-green-900/20 p-6 rounded-lg">
                      <div className="text-sm text-green-600 dark:text-green-400 font-medium mb-2">
                        Active Users
                      </div>
                      <div className="text-3xl font-bold text-green-900 dark:text-green-100">
                        {stats.activeUsers}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                  No statistics data available
                </div>
              ))}

            {activeTab === "users" && (
              <UserManagement initialUsers={users} onUpdate={loadData} />
            )}

            {activeTab === "settings" &&
              (settings ? (
                <SystemSettingsForm
                  settings={settings}
                  availableModels={modelOptions}
                  onUpdate={handleUpdateSettings}
                />
              ) : (
                <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                  No settings data available
                </div>
              ))}

            {activeTab === "api-keys" && (
              <ApiKeyManagement apiKeys={apiKeys} onKeysUpdated={loadData} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SystemSettingsForm({
  settings,
  availableModels,
  onUpdate,
}: {
  settings: SystemSettings;
  availableModels: string[];
  onUpdate: (settings: Partial<SystemSettings>) => Promise<void>;
}) {
  const [formData, setFormData] = useState(settings);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(" ");

  useEffect(() => {
    setFormData(settings);
  }, [settings]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSaved(" ");
    try {
      const payload = {
        ...formData,
        temperature: Math.min(2, Math.max(0, formData.temperature)),
        maxTokens: Math.min(4096, Math.max(1, formData.maxTokens)),
      };
      await onUpdate(payload);
      setSaved("Settings saved");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
            LLM Control Settings
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Configure model, temperature, tokens, and limits
          </p>
        </div>
        {saved.trim() && (
          <span className="text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-full px-3 py-1">
            {saved}
          </span>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Model
            </label>
            <select
              value={formData.model}
              onChange={(e) =>
                setFormData({ ...formData, model: e.target.value })
              }
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              {(availableModels && availableModels.length > 0
                ? Array.from(new Set([...availableModels, formData.model]))
                : Array.from(new Set([...DEFAULT_MODELS, formData.model]))
              ).map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Select the deployed LLM backend
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Temperature
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="0"
                max="2"
                step="0.05"
                value={formData.temperature}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    temperature: parseFloat(e.target.value),
                  })
                }
                className="flex-1"
              />
              <span className="w-14 text-sm text-gray-700 dark:text-gray-300 text-right">
                {formData.temperature.toFixed(2)}
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Controls randomness (0 = deterministic, 2 = creative)
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Max Tokens
            </label>
            <input
              type="number"
              min="1"
              max="4096"
              value={formData.maxTokens}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  maxTokens: parseInt(e.target.value) || 0,
                })
              }
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Limit generated tokens (1 - 4096)
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Rate Limit (requests/min)
            </label>
            <input
              type="number"
              min="1"
              value={formData.rateLimit}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  rateLimit: parseInt(e.target.value) || 0,
                })
              }
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Throttle requests to protect the service
            </p>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            System Prompt
          </label>
          <textarea
            value={formData.systemPrompt}
            onChange={(e) =>
              setFormData({ ...formData, systemPrompt: e.target.value })
            }
            rows={4}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
        </div>

        <div className="flex justify-end gap-3">
          {saved.trim() && (
            <span className="text-sm text-green-600 dark:text-green-400">
              {saved}
            </span>
          )}
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
          >
            {loading ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function AdminPage() {
  return (
    <ProtectedRoute>
      <AdminPageContent />
    </ProtectedRoute>
  );
}
