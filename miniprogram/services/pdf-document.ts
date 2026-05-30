import { buildAbsoluteApiUrl, extractFilenameFromUrl } from "../utils/api-url";
import { RequestError } from "../utils/request";
import { getAccessToken, getSession } from "../utils/storage/token-storage";
import { authService } from "./auth/auth-service";

type DownloadAndOpenPdfOptions = {
  pdfUrl: string;
  filename?: string;
  authMode?: "none" | "required";
};

const DEFAULT_PDF_FILENAME = "document.pdf";

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function resolvePdfFilename(pdfUrl: string, filename?: string): string {
  const explicitFilename = normalizeText(filename);
  if (explicitFilename) {
    return explicitFilename;
  }

  const filenameFromUrl = normalizeText(extractFilenameFromUrl(pdfUrl));
  if (filenameFromUrl) {
    return filenameFromUrl;
  }

  return DEFAULT_PDF_FILENAME;
}

function resolveDownloadHeader(authMode: "none" | "required"): Record<string, string> {
  if (authMode === "none") {
    return {};
  }

  const accessToken = getAccessToken();
  if (!accessToken) {
    authService.onAuthExpired();
    throw new RequestError("Please login first", {
      statusCode: 401,
      code: "AUTH_REQUIRED_NO_TOKEN",
    });
  }

  const tokenType = getSession()?.tokenType || "Bearer";
  return {
    Authorization: `${tokenType} ${accessToken}`,
  };
}

function downloadPdfTempFile(
  fullPdfUrl: string,
  authMode: "none" | "required",
): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url: fullPdfUrl,
      header: resolveDownloadHeader(authMode),
      success: (res) => {
        if (res.statusCode === 401) {
          authService.onAuthExpired();
          reject(new RequestError("Please login first", {
            statusCode: 401,
            code: 401,
            data: res,
          }));
          return;
        }

        if (res.statusCode !== 200 || !res.tempFilePath) {
          reject(new RequestError(`Download failed (HTTP ${res.statusCode})`, {
            statusCode: res.statusCode,
            data: res,
          }));
          return;
        }

        resolve(res.tempFilePath);
      },
      fail: (error) => {
        reject(new RequestError(String(error.errMsg || "Network request failed"), {
          data: error,
        }));
      },
    });
  });
}

function openPdfDocument(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    wx.openDocument({
      filePath,
      fileType: "pdf",
      showMenu: true,
      success: () => {
        resolve();
      },
      fail: (error) => {
        reject(new RequestError(String(error.errMsg || "Open PDF failed"), {
          data: error,
        }));
      },
    });
  });
}

export async function downloadAndOpenPdfDocument(
  options: DownloadAndOpenPdfOptions,
): Promise<void> {
  const rawPdfUrl = normalizeText(options.pdfUrl);
  if (!rawPdfUrl) {
    throw new RequestError("PDF url is empty");
  }

  const fullPdfUrl = buildAbsoluteApiUrl(rawPdfUrl);
  if (!fullPdfUrl) {
    throw new RequestError("PDF url is invalid");
  }

  const authMode = options.authMode || "required";
  const pdfFilename = resolvePdfFilename(rawPdfUrl, options.filename);
  const tempFilePath = await downloadPdfTempFile(fullPdfUrl, authMode);

  try {
    await openPdfDocument(tempFilePath);
  } catch (error) {
    throw new RequestError(`${pdfFilename} open failed`, {
      data: error,
    });
  }
}
