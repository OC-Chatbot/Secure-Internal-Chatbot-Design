/**
 * Admin API endpoints
 */

import { apiClient } from "./client";
import { User } from "./auth";

export interface AdminStats {
  totalUsers: number;
  totalConversations: number;
  totalMessages: number;
  activeUsers: number;
}

export interface SystemSettings {
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  rateLimit: number;
}

export interface ApiKey {
  id: string;
  name: string;
  key: string;
  createdAt: string;
  lastUsed: string | null;
}

export const adminApi = {
  async getStats(): Promise<AdminStats> {
    return apiClient.get<AdminStats>("/admin/stats");
  },

  async getUsers(): Promise<User[]> {
    return apiClient.get<User[]>("/admin/users");
  },

  async getUser(userId: string): Promise<User> {
    return apiClient.get<User>(`/admin/users/${userId}`);
  },

  async updateUser(userId: string, data: Partial<User>): Promise<User> {
    return apiClient.put<User>(`/admin/users/${userId}`, data);
  },

  async deleteUser(userId: string): Promise<void> {
    return apiClient.delete(`/admin/users/${userId}`);
  },

  async getSystemSettings(): Promise<SystemSettings> {
    return apiClient.get<SystemSettings>("/admin/settings");
  },

  async updateSystemSettings(
    settings: Partial<SystemSettings>
  ): Promise<SystemSettings> {
    return apiClient.put<SystemSettings>("/admin/settings", settings);
  },

  async getAvailableModels(): Promise<string[]> {
    const { models } = await apiClient.get<{ models: string[] }>(
      "/admin/models"
    );
    return models;
  },

  async getApiKeys(): Promise<ApiKey[]> {
    return apiClient.get<ApiKey[]>("/admin/api-keys");
  },

  async createApiKey(name: string): Promise<ApiKey & { fullKey: string }> {
    return apiClient.post<ApiKey & { fullKey: string }>("/admin/api-keys", {
      name,
    });
  },

  async revokeApiKey(keyId: string): Promise<void> {
    return apiClient.delete(`/admin/api-keys/${keyId}`);
  },

  async createUser(data: {
    name: string;
    email: string;
    role: string;
    password: string;
  }): Promise<User> {
    return apiClient.post<User>("/admin/users", data);
  },
};
