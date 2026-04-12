import { API_CONFIG } from "../config/api";

function normalizeBaseURL(baseURL: string): string {
  return String(baseURL || "").trim().replace(/\/+$/, "");
}

function normalizePath(pathOrUrl: string): string {
  return String(pathOrUrl || "").trim();
}

export function buildAbsoluteApiUrl(pathOrUrl: string): string {
  const normalizedPathOrUrl = normalizePath(pathOrUrl);
  if (!normalizedPathOrUrl) {
    return "";
  }

  if (/^https?:\/\//i.test(normalizedPathOrUrl)) {
    return normalizedPathOrUrl;
  }

  const baseURL = normalizeBaseURL(API_CONFIG.baseURL);
  if (!baseURL) {
    return "";
  }

  return `${baseURL}/${normalizedPathOrUrl.replace(/^\/+/, "")}`;
}

export function extractFilenameFromUrl(pathOrUrl: string): string {
  const normalizedPathOrUrl = normalizePath(pathOrUrl);
  if (!normalizedPathOrUrl) {
    return "";
  }

  const urlWithoutQuery = normalizedPathOrUrl.split(/[?#]/, 1)[0];
  const segments = urlWithoutQuery.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return "";
  }

  const rawFilename = segments[segments.length - 1];

  try {
    return decodeURIComponent(rawFilename);
  } catch (error) {
    console.warn("Decode filename from URL failed", error);
    return rawFilename;
  }
}
