/**
 * Shared type definitions
 */

export interface OAuthAuthDetails {
  type: "oauth";
  refresh: string;
  access: string;
  expires?: number;
  apiKey?: string;
}

export interface StoredCredentials {
  accessToken: string;
  refreshToken: string;
  expiryDate: number;
  tokenType: string;
}

export interface TokenResponse {
  success: boolean;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  api_key?: string;
  error?: string;
}

export interface DeviceAuthorization {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
  verifier: string;
}

export type RequestInfoType = string | URL | Request;

export interface FetchInterceptor {
  (input: RequestInfoType, init?: RequestInit): Promise<Response>;
}
