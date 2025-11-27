'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type SystemSettings = {
  model: string;
  systemPrompt: string;
  temperature: number; // 0–2
  maxTokens: number; // >=1
  retrievalDepth: number; // >=0
  rateLimit: number; // >=1 (requests/min)
};

const DEFAULT_SETTINGS: SystemSettings = {
  model: 'gpt-4o-mini',
  systemPrompt:
    'You are an internal assistant. Answer concisely and follow safety and privacy policies. Do not reveal secrets.',
  temperature: 0.2,
  maxTokens: 1024,
  retrievalDepth: 5,
  rateLimit: 60,
};

const HARD_CODED_USERNAME = 'admin';
const HARD_CODED_PASSWORD = 'secret';
const ADMIN_TOKEN_KEY = 'admin_token';
const LOCAL_STORAGE_KEY = 'admin_settings_v1';

// Safe normalization + bounds
function normalizeSettings(obj: Partial<SystemSettings> | null): SystemSettings {
  const s = obj ?? {};
  const temperature =
    typeof s.temperature === 'number' ? Math.min(2, Math.max(0, s.temperature)) : DEFAULT_SETTINGS.temperature;
  const maxTokens =
    typeof s.maxTokens === 'number' ? Math.max(1, Math.floor(s.maxTokens)) : DEFAULT_SETTINGS.maxTokens;
  const retrievalDepth =
    typeof s.retrievalDepth === 'number' ? Math.max(0, Math.floor(s.retrievalDepth)) : DEFAULT_SETTINGS.retrievalDepth;
  const rateLimit =
    typeof s.rateLimit === 'number' ? Math.max(1, Math.floor(s.rateLimit)) : DEFAULT_SETTINGS.rateLimit;

  return {
    model: typeof s.model === 'string' && s.model.trim() ? s.model.trim() : DEFAULT_SETTINGS.model,
    systemPrompt:
      typeof s.systemPrompt === 'string' && s.systemPrompt.trim()
        ? s.systemPrompt
        : DEFAULT_SETTINGS.systemPrompt,
    temperature,
    maxTokens,
    retrievalDepth,
    rateLimit,
  };
}

export default function AdminPageClient() {
  const router = useRouter();

  const [authed, setAuthed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(ADMIN_TOKEN_KEY) === 'ok';
    } catch {
      return false;
    }
  });
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [testPrompt, setTestPrompt] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  // Derived validation state
  const validation = useMemo(() => {
    const issues: string[] = [];
    if (!settings) return issues;
    if (!settings.model.trim()) issues.push('Model is required.');
    if (settings.temperature < 0 || settings.temperature > 2) issues.push('Temperature must be between 0 and 2.');
    if (!Number.isFinite(settings.maxTokens) || settings.maxTokens < 1) issues.push('Max tokens must be >= 1.');
    if (!Number.isFinite(settings.retrievalDepth) || settings.retrievalDepth < 0)
      issues.push('Retrieval depth must be >= 0.');
    if (!Number.isFinite(settings.rateLimit) || settings.rateLimit < 1)
      issues.push('Rate limit must be >= 1 requests/min.');
    if (!settings.systemPrompt.trim()) issues.push('System prompt is required.');
    return issues;
  }, [settings]);

  useEffect(() => {
    if (authed) {
      loadSettings();
    }
  }, [authed]);

  async function loadSettings() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/settings');
      if (res.ok) {
        const json = await res.json();
        const normalized = normalizeSettings(json);
        setSettings(normalized);
        try {
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(normalized));
        } catch {}
        setLoading(false);
        return;
      } else {
        setError(`Failed to load from server: ${res.status} ${res.statusText}`);
      }
    } catch {
      // ignore; fallback below
    }

    try {
      const local = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (local) {
        setSettings(normalizeSettings(JSON.parse(local)));
      } else {
        setSettings(DEFAULT_SETTINGS);
      }
    } catch {
      setSettings(DEFAULT_SETTINGS);
    } finally {
      setLoading(false);
    }
  }

  function notify(msg: string) {
    setMessage(msg);
    setTimeout(() => setMessage(''), 3000);
  }

  async function handleSave(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!settings) return;

    // Block save if invalid
    if (validation.length > 0) {
      setError(validation.join(' '));
      return;
    }

    setSaving(true);
    setError('');
    const payload = normalizeSettings(settings);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const saved = await res.json().catch(() => null);
        const normalized = normalizeSettings(saved || payload);
        setSettings(normalized);
        try {
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(normalized));
        } catch {}
        notify('Settings saved.');
      } else {
        // Persist locally on server error
        try {
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(payload));
        } catch {}
        setError(`Save failed: ${res.status} ${res.statusText}`);
        notify('Saved to localStorage (server error).');
      }
    } catch {
      // Persist locally on network error
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(payload));
      } catch {}
      setError('Network error while saving settings.');
      notify('Saved to localStorage (network error).');
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!settings) return;
    if (!testPrompt || testPrompt.trim().length === 0) {
      setError('Test prompt cannot be empty.');
      return;
    }
    if (validation.length > 0) {
      setError('Fix settings validation issues before running a test.');
      return;
    }
    setTesting(true);
    setTestResult(null);
    setError('');
    try {
      const res = await fetch('/api/admin/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: testPrompt, settings: normalizeSettings(settings) }),
      });
      if (res.ok) {
        const json = await res.json().catch(() => null);
        if (json && typeof json.output === 'string') {
          setTestResult(json.output);
        } else if (typeof json === 'string') {
          setTestResult(json);
        } else {
          setTestResult(JSON.stringify(json, null, 2));
        }
      } else {
        setError(`Test failed: ${res.status} ${res.statusText}`);
      }
    } catch {
      setError('Network error while running test.');
    } finally {
      setTesting(false);
    }
  }

  function handleLogin(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (username === HARD_CODED_USERNAME && password === HARD_CODED_PASSWORD) {
      try {
        sessionStorage.setItem(ADMIN_TOKEN_KEY, 'ok');
      } catch {}
      setAuthed(true);
      notify('Logged in (development only).');
    } else {
      setError('Invalid username or password.');
    }
  }

  function handleLogout() {
    try {
      sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    } catch {}
    setAuthed(false);
    setUsername('');
    setPassword('');
    setSettings(null);
    setMessage('');
    setError('');
    setTestPrompt('');
    setTestResult(null);
  }

  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-md bg-white rounded shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Admin Login (dev only)</h2>
          {error && <div className="mb-3 text-red-600">{error}</div>}
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full border rounded px-3 py-2"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                className="w-full border rounded px-3 py-2"
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-500">username: admin / password: secret</div>
              <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded">
                Login
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">Admin — Prompt & Model Settings</h1>
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/')} className="px-3 py-2 border rounded bg-white">
              Back to Chat
            </button>
            <button onClick={handleLogout} className="px-3 py-2 border rounded bg-white">
              Logout
            </button>
          </div>
        </div>

        {loading || !settings ? (
          <div className="p-6 bg-white rounded shadow text-gray-500">Loading settings...</div>
        ) : (
          <div className="bg-white rounded shadow p-6 space-y-6">
            {error && <div className="text-red-600">{error}</div>}
            {message && <div className="text-green-600">{message}</div>}

            <form onSubmit={handleSave} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Model</label>
                  <input
                    value={settings.model}
                    onChange={(e) => setSettings({ ...settings, model: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Temperature</label>
                  <input
                    type="number"
                    step="0.1"
                    min={0}
                    max={2}
                    value={settings.temperature}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        temperature: Math.min(2, Math.max(0, parseFloat(e.target.value) || 0)),
                      })
                    }
                    className="w-full border rounded px-3 py-2"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Max Tokens</label>
                  <input
                    type="number"
                    min={1}
                    value={settings.maxTokens}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        maxTokens: Math.max(1, parseInt(e.target.value || '1')),
                      })
                    }
                    className="w-full border rounded px-3 py-2"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Retrieval Depth</label>
                  <input
                    type="number"
                    min={0}
                    value={settings.retrievalDepth}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        retrievalDepth: Math.max(0, parseInt(e.target.value || '0')),
                      })
                    }
                    className="w-full border rounded px-3 py-2"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Rate Limit (requests/min)</label>
                  <input
                    type="number"
                    min={1}
                    value={settings.rateLimit}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        rateLimit: Math.max(1, parseInt(e.target.value || '1')),
                      })
                    }
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">System Prompt</label>
                <textarea
                  rows={6}
                  value={settings.systemPrompt}
                  onChange={(e) => setSettings({ ...settings, systemPrompt: e.target.value })}
                  className="w-full border rounded px-3 py-2"
                />
                <p className="mt-2 text-sm text-gray-500">
                  The system prompt controls assistant behavior. Sanitize and validate all prompt changes
                  server-side before applying in production.
                </p>
              </div>

              {validation.length > 0 && (
                <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
                  <ul className="list-disc pl-5">
                    {validation.map((v, i) => (
                      <li key={i}>{v}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setSettings(DEFAULT_SETTINGS);
                    notify('Restored defaults (local only until saved).');
                  }}
                  className="px-4 py-2 border rounded"
                >
                  Reset to Defaults
                </button>
                <button
                  type="submit"
                  disabled={saving || validation.length > 0}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </form>

            <div className="border-t pt-6">
              <h3 className="text-lg font-medium mb-2">Real-time Test</h3>
              <p className="text-sm text-gray-600 mb-3">
                Send a single test prompt using the current settings to validate behavior.
                Keep inputs safe and policy-compliant.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Test Prompt</label>
                  <textarea
                    rows={4}
                    value={testPrompt}
                    onChange={(e) => setTestPrompt(e.target.value)}
                    className="w-full border rounded px-3 py-2"
                  />
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      onClick={handleTest}
                      disabled={testing || validation.length > 0}
                      className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                    >
                      {testing ? 'Testing...' : 'Run Test'}
                    </button>
                    <button
                      onClick={() =>
                        setTestPrompt(
                          `Please summarize the following system instructions in one sentence: ${settings.systemPrompt}`
                        )
                      }
                      className="px-3 py-2 border rounded"
                    >
                      Auto-fill
                    </button>
                    <div className="text-sm text-gray-500">Model: {settings.model}</div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Test Output</label>
                  <div className="min-h-[140px] p-3 bg-gray-50 border rounded text-sm">
                    {testing && <div className="text-gray-500">Running test...</div>}
                    {!testing && testResult && <pre className="whitespace-pre-wrap">{testResult}</pre>}
                    {!testing && testResult === null && <div className="text-gray-400">No test run yet.</div>}
                  </div>
                </div>
              </div>
            </div>

            <div className="text-xs text-gray-500">
              Note: This temporary admin uses hardcoded credentials and client-side sessionStorage.
              Replace with proper authentication and authorization, and ensure server-side validation and
              auditing of all setting changes before use in production.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
