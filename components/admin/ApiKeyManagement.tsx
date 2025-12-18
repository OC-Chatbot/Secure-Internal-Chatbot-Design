"use client";

import { useState } from "react";
import { adminApi, ApiKey } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/client";

export function ApiKeyManagement({
  apiKeys,
  onKeysUpdated,
}: {
  apiKeys: ApiKey[];
  onKeysUpdated: () => Promise<void>;
}) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [newKeyDisplayed, setNewKeyDisplayed] = useState<{
    key: string;
    name: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      const response = await adminApi.createApiKey(keyName || "Unnamed Key");
      setNewKeyDisplayed({
        key: response.fullKey,
        name: response.name,
      });
      setKeyName("");
      setSuccess(
        "API key created successfully! Copy it now (shown only once)."
      );
      await onKeysUpdated();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || "Failed to create API key");
      } else {
        setError("An unexpected error occurred");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRevokeKey = async (keyId: string) => {
    if (!confirm("Are you sure you want to revoke this API key?")) return;

    setError("");
    setLoading(true);

    try {
      await adminApi.revokeApiKey(keyId);
      setSuccess("API key revoked successfully");
      await onKeysUpdated();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || "Failed to revoke API key");
      } else {
        setError("An unexpected error occurred");
      }
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const maskKey = (key: string) => {
    if (key.length <= 4) return "*".repeat(key.length);
    return "*".repeat(key.length - 4) + key.slice(-4);
  };

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
              API Key Management
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Create and manage access keys for API calls
            </p>
          </div>
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            + Add Key
          </button>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 px-4 py-3 rounded-lg">
            {success}
          </div>
        )}

        {showCreateForm && (
          <form
            onSubmit={handleCreateKey}
            className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg border border-gray-200 dark:border-gray-700 mb-4"
          >
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Key Name (optional)
              </label>
              <input
                type="text"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                placeholder="e.g., Production API Key"
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
              >
                {loading ? "Creating..." : "Create Key"}
              </button>
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-lg"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {newKeyDisplayed && (
        <div className="mb-6 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
          <div className="mb-3">
            <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
              New API Key (copy now, won't be shown again):
            </p>
            <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">
              Name: {newKeyDisplayed.name}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white dark:bg-gray-800 px-3 py-2 rounded border border-yellow-200 dark:border-yellow-700 text-sm font-mono text-gray-900 dark:text-gray-100 break-all">
              {newKeyDisplayed.key}
            </code>
            <button
              onClick={() => copyToClipboard(newKeyDisplayed.key)}
              className="px-3 py-2 text-sm font-medium text-white bg-yellow-600 hover:bg-yellow-700 rounded-lg"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-100 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
            <tr>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">
                Name
              </th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">
                Key
              </th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">
                Created
              </th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">
                Last Used
              </th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900 dark:text-white">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {apiKeys.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-6 py-8 text-center text-gray-500 dark:text-gray-400"
                >
                  No API keys yet. Create one to get started.
                </td>
              </tr>
            ) : (
              apiKeys.map((apiKey) => (
                <tr
                  key={apiKey.id}
                  className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  <td className="px-6 py-4 text-sm text-gray-900 dark:text-white font-medium">
                    {apiKey.name}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400 font-mono">
                    {maskKey(apiKey.key)}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                    {new Date(apiKey.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                    {apiKey.lastUsed
                      ? new Date(apiKey.lastUsed).toLocaleDateString()
                      : "Never"}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <button
                      onClick={() => handleRevokeKey(apiKey.id)}
                      disabled={loading}
                      className="px-3 py-1 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded disabled:opacity-50"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
