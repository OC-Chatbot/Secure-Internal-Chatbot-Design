/**
 * Authentication API endpoints
 */

import { apiClient } from "./client";

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  email: string;
  password: string;
  name: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: "user" | "admin" | "super-admin";
  createdAt: string;
}

export const authApi = {
  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    const response = await apiClient.post<AuthResponse>(
      "/auth/login",
      credentials
    );
    apiClient.setToken(response.token);
    apiClient.setUserId(response.user.id);
    return response;
  },

  async register(data: RegisterData): Promise<AuthResponse> {
    const response = await apiClient.post<AuthResponse>("/auth/register", data);
    apiClient.setToken(response.token);
    apiClient.setUserId(response.user.id);
    return response;
  },

  async logout(): Promise<void> {
    await apiClient.post("/auth/logout");
    apiClient.setToken(null);
    apiClient.setUserId(null);
  },

  async getCurrentUser(): Promise<User> {
    return apiClient.get<User>("/auth/me");
  },

  async refreshToken(): Promise<AuthResponse> {
    const response = await apiClient.post<AuthResponse>("/auth/refresh");
    apiClient.setToken(response.token);
    return response;
  },
};
