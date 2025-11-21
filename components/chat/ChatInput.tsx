'use client';

import { KeyboardEvent, useEffect, useRef } from 'react';

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void | Promise<void>;
  disabled?: boolean;
}

export function ChatInput({ value, onChange, onSend, disabled = false }: ChatInputProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const focusInput = () => {
    if (!disabled) {
      inputRef.current?.focus();
    }
  };

  useEffect(() => {
    focusInput();
  }, []);

  useEffect(() => {
    if (!disabled) {
      focusInput();
    }
  }, [disabled]);

  const handleSend = () => {
    if (disabled || !value.trim()) return;

    const result = onSend();
    Promise.resolve(result).finally(focusInput);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex items-end gap-3 bg-gray-50 dark:bg-gray-800 rounded-full px-4 py-3 border border-gray-200 dark:border-gray-700 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 transition-all">
      <textarea
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder="Type your message..."
        rows={1}
        className="flex-1 bg-transparent border-none outline-none text-gray-900 dark:text-white placeholder-gray-400 resize-none max-h-32 overflow-y-auto"
        style={{ minHeight: '24px', height: 'auto' }}
      />
      <button
        onClick={handleSend}
        disabled={disabled || !value.trim()}
        className="w-8 h-8 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 flex items-center justify-center hover:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
      >
        <svg
          className="w-5 h-5 text-white"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
          />
        </svg>
      </button>
    </div>
  );
}
