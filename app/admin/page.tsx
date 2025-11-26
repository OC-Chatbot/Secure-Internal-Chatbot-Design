    'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type SystemSettings = {
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  retrievalDepth: number;
  rateLimit: number;
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

function normalizeSettings(obj: Partial<SystemSettings> | null): SystemSettings {
  if (!obj) return DEFAULT_SETTINGS;
  return {
    model: typeof obj.model === 'string' ? obj.model : DEFAULT_SETTINGS.model,
    systemPrompt:
      typeof obj.systemPrompt === 'string' ? obj.systemPrompt : DEFAULT_SETTINGS.systemPrompt,
    temperature: typeof obj.temperature === 'number' ? obj.temperature : DEFAULT_SETTINGS.temperature,
    maxTokens: typeof obj.maxTokens === 'number' ? obj.maxTokens : DEFAULT_SETTINGS.maxTokens,
    retrievalDepth:
      typeof obj.retrievalDepth === 'number' ? obj.retrievalDepth : DEFAULT_SETTINGS.retrievalDepth,
    rateLimit: typeof obj.rateLimit === 'number' ? obj.rateLimit : DEFAULT_SETTINGS.rateLimit,
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

  useEffect(() => {
    if (authed) {
      loadSettings();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  async function loadSettings() {
    setLoading(true);
    setError('');
    // Try backend first
    try {
      const res = await fetch('/api/admin/settings');
      if (res.ok) {
        const json = await res.json();
        const normalized = normalizeSettings(json);
        setSettings(normalized);
        // keep a local copy
        try {
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(normalized));
        } catch {}
        setLoading(false);
        return;
      }
    } catch {
      // ignore; fallback to localStorage
    }

    // Fallback to localStorage or defaults
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

  async function handleSave(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!settings) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        const saved = await res.json().catch(() => null);
        const normalized = normalizeSettings(saved || settings);
        setSettings(normalized);
        try {
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(normalized));
        } catch {}
        setMessage('Settings saved.');
        setTimeout(() => setMessage(''), 3000);
      } else {
        // Server returned error - fallback to localStorage
        try {
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(settings));
          setMessage('Saved to localStorage (server error).');
          setTimeout(() => setMessage(''), 3000);
        } catch {}
        setError(`Save failed: ${res.status} ${res.statusText}`);
      }
    } catch {
      // Network error - fallback to localStorage
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(settings));
        setMessage('Saved to localStorage (network error).');
        setTimeout(() => setMessage(''), 3000);
      } catch {}
      setError('Network error while saving settings.');
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
    setTesting(true);
    setTestResult(null);
    setError('');
    try {
      const res = await fetch('/api/admin/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: testPrompt, settings }),
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
      setMessage('Logged in (development only).');
      setTimeout(() => setMessage(''), 3000);
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
                      setSettings({ ...settings, temperature: parseFloat(e.target.value) || 0 })
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
                      setSettings({ ...settings, maxTokens: parseInt(e.target.value) || 1 })
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
                      setSettings({ ...settings, retrievalDepth: parseInt(e.target.value) || 0 })
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
                      setSettings({ ...settings, rateLimit: parseInt(e.target.value) || 1 })
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
                  The system prompt controls assistant behavior. Sanitize and validate all prompt
                  changes server-side before applying in production.
                </p>
              </div>

              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setSettings(DEFAULT_SETTINGS);
                    setMessage('Restored defaults (local only until saved).');
                    setTimeout(() => setMessage(''), 3000);
                  }}
                  className="px-4 py-2 border rounded"
                >
                  Reset to Defaults
                </button>
                <button
                  type="submit"
                  disabled={saving}
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
You pasted a lot of JSX again and asked "what line should i replace" earlier and then asked for revised code — you received the full code block. Now they pasted more part ending mid-sentence. They now ask: "give me the revised code so i can replace it" earlier assistant provided file. Now user pasted again chunk and likely expects final confirmation. The last message ends mid-sentence; user likely pasted to show current contents. They want revised code to replace file. We already provided full file earlier. But now must respond: provide the revised file again? The developer instruction: When proposing a file use file block syntax. So include the file again. But avoid duplicating too much. Provide the corrected file again (ensuring fix for typo and also ensure no other issues). Then give precise steps to replace file in repo (git add commit push). They already earlier did git mv and moved .bak back to page.tsx and committed; but user previously said they opened .bak and replaced old code and had typo fixed. Now they want revised code. I'll provide the full file block with the final corrected code. Then short guidance: Save file, git add commit push, run dev.

Keep concise.

Let's output the file.
```typescript name=app/admin/page.tsx
'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type SystemSettings = {
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  retrievalDepth: number;
  rateLimit: number;
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

function normalizeSettings(obj: Partial<SystemSettings> | null): SystemSettings {
  if (!obj) return DEFAULT_SETTINGS;
  return {
    model: typeof obj.model === 'string' ? obj.model : DEFAULT_SETTINGS.model,
    systemPrompt:
      typeof obj.systemPrompt === 'string' ? obj.systemPrompt : DEFAULT_SETTINGS.systemPrompt,
    temperature: typeof obj.temperature === 'number' ? obj.temperature : DEFAULT_SETTINGS.temperature,
    maxTokens: typeof obj.maxTokens === 'number' ? obj.maxTokens : DEFAULT_SETTINGS.maxTokens,
    retrievalDepth:
      typeof obj.retrievalDepth === 'number' ? obj.retrievalDepth : DEFAULT_SETTINGS.retrievalDepth,
    rateLimit: typeof obj.rateLimit === 'number' ? obj.rateLimit : DEFAULT_SETTINGS.rateLimit,
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

  useEffect(() => {
    if (authed) {
      loadSettings();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  async function loadSettings() {
    setLoading(true);
    setError('');
    // Try backend first
    try {
      const res = await fetch('/api/admin/settings');
      if (res.ok) {
        const json = await res.json();
        const normalized = normalizeSettings(json);
        setSettings(normalized);
        // keep a local copy
        try {
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(normalized));
        } catch {}
        setLoading(false);
        return;
      }
    } catch {
      // ignore; fallback to localStorage
    }

    // Fallback to localStorage or defaults
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

  async function handleSave(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!settings) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        const saved = await res.json().catch(() => null);
        const normalized = normalizeSettings(saved || settings);
        setSettings(normalized);
        try {
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(normalized));
        } catch {}
        setMessage('Settings saved.');
        setTimeout(() => setMessage(''), 3000);
      } else {
        // Server returned error - fallback to localStorage
        try {
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(settings));
          setMessage('Saved to localStorage (server error).');
          setTimeout(() => setMessage(''), 3000);
        } catch {}
        setError(`Save failed: ${res.status} ${res.statusText}`);
      }
    } catch {
      // Network error - fallback to localStorage
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(settings));
        setMessage('Saved to localStorage (network error).');
        setTimeout(() => setMessage(''), 3000);
      } catch {}
      setError('Network error while saving settings.');
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
    setTesting(true);
    setTestResult(null);
    setError('');
    try {
      const res = await fetch('/api/admin/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: testPrompt, settings }),
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
      setMessage('Logged in (development only).');
      setTimeout(() => setMessage(''), 3000);
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
                      setSettings({ ...settings, temperature: parseFloat(e.target.value) || 0 })
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
                      setSettings({ ...settings, maxTokens: parseInt(e.target.value) || 1 })
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
                      setSettings({ ...settings, retrievalDepth: parseInt(e.target.value) || 0 })
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
                      setSettings({ ...settings, rateLimit: parseInt(e.target.value) || 1 })
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
                  The system prompt controls assistant behavior. Sanitize and validate all prompt
                  changes server-side before applying in production.
                </p>
              </div>

              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setSettings(DEFAULT_SETTINGS);
                    setMessage('Restored defaults (local only until saved).');
                    setTimeout(() => setMessage(''), 3000);
                  }}
                  className="px-4 py-2 border rounded"
                >
                  Reset to Defaults
                </button>
                <button
                  type="submit"
                  disabled={saving}
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
                      disabled={testing}
                      className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                    >
                      {testing ? 'Testing...' : 'Run Test'}
                    </button>
                    <button
                      onClick={() =>
                        setTestPrompt(
                          'Please summarize the following system instructions in one sentence: ' +
                            settings.systemPrompt
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
              Replace with a proper authentication and authorization mechanism and ensure server-side
              validation and auditing of all setting changes before use in production.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}