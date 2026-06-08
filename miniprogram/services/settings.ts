import { createLogger } from "../utils/logger/logger";
import { STORAGE_KEYS } from "../utils/storage/storage-keys";

export type SettingsFontSize = "standard" | "large";
export type SettingsDisplayDensity = "comfortable" | "compact";

export type FormulaImageScalePreset = {
  label: string;
  value: number;
};

export type AppSettings = {
  fontSize: SettingsFontSize;
  displayDensity: SettingsDisplayDensity;
  saveSearchHistory: boolean;
  wifiOnlyDownload: boolean;
  formulaImageScale: number;
};

export const FORMULA_IMAGE_SCALE_MIN = 0.75;
export const FORMULA_IMAGE_SCALE_MAX = 1.8;
export const FORMULA_IMAGE_SCALE_DEFAULT = 1;
export const FORMULA_IMAGE_SCALE_STEP = 0.05;
export const FORMULA_IMAGE_SCALE_PRESETS: FormulaImageScalePreset[] = [
  { label: "小", value: 0.85 },
  { label: "标准", value: 1 },
  { label: "大", value: 1.2 },
  { label: "特大", value: 1.4 },
];

export const DEFAULT_SETTINGS: AppSettings = {
  fontSize: "standard",
  displayDensity: "comfortable",
  saveSearchHistory: true,
  wifiOnlyDownload: true,
  formulaImageScale: FORMULA_IMAGE_SCALE_DEFAULT,
};

export function getFontSizeText(fontSize: SettingsFontSize): string {
  return fontSize === "large" ? "较大" : "标准";
}

export function getDisplayDensityText(displayDensity: SettingsDisplayDensity): string {
  return displayDensity === "compact" ? "紧凑" : "舒适";
}

const SETTINGS_STORAGE_KEY = STORAGE_KEYS.APP_SETTINGS;
const settingsLogger = createLogger("settings-service");

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function hasStoredValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
      return true;
    }

    if (normalized === "false" || normalized === "0") {
      return false;
    }
  }

  return fallback;
}

function normalizeFontSize(value: unknown): SettingsFontSize {
  return value === "large" ? "large" : "standard";
}

function normalizeDisplayDensity(value: unknown): SettingsDisplayDensity {
  return value === "compact" ? "compact" : "comfortable";
}

export function normalizeFormulaImageScale(value: unknown): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number(value.trim())
      : Number.NaN;

  if (!Number.isFinite(parsed)) {
    return FORMULA_IMAGE_SCALE_DEFAULT;
  }

  const clamped = Math.min(
    FORMULA_IMAGE_SCALE_MAX,
    Math.max(FORMULA_IMAGE_SCALE_MIN, parsed),
  );
  return Number((Math.round(clamped / FORMULA_IMAGE_SCALE_STEP) * FORMULA_IMAGE_SCALE_STEP).toFixed(2));
}

export function getFormulaImageScaleText(value: unknown): string {
  const scale = normalizeFormulaImageScale(value);
  if (Math.abs(scale - FORMULA_IMAGE_SCALE_DEFAULT) < 0.001) {
    return "标准";
  }

  return `${Math.round(scale * 100)}%`;
}

function tryParseRawSettings(raw: unknown): unknown {
  if (typeof raw !== "string") {
    return raw;
  }

  const text = raw.trim();
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    settingsLogger.warn("settings_parse_failed", {
      error,
    });
    return raw;
  }
}

function normalizeSettings(raw: unknown): {
  settings: AppSettings;
  shouldPersist: boolean;
} {
  if (!isPlainObject(raw)) {
    return {
      settings: { ...DEFAULT_SETTINGS },
      shouldPersist: true,
    };
  }

  const settings: AppSettings = {
    fontSize: normalizeFontSize(raw.fontSize),
    displayDensity: normalizeDisplayDensity(raw.displayDensity),
    saveSearchHistory: toBoolean(raw.saveSearchHistory, DEFAULT_SETTINGS.saveSearchHistory),
    wifiOnlyDownload: toBoolean(raw.wifiOnlyDownload, DEFAULT_SETTINGS.wifiOnlyDownload),
    formulaImageScale: normalizeFormulaImageScale(raw.formulaImageScale),
  };

  const shouldPersist = (
    raw.fontSize !== settings.fontSize
    || raw.displayDensity !== settings.displayDensity
    || raw.saveSearchHistory !== settings.saveSearchHistory
    || raw.wifiOnlyDownload !== settings.wifiOnlyDownload
    || raw.formulaImageScale !== settings.formulaImageScale
  );

  return {
    settings,
    shouldPersist,
  };
}

function writeSettingsToStorage(
  settings: AppSettings,
  reason: "update" | "repair" | "reset",
): void {
  try {
    wx.setStorageSync(SETTINGS_STORAGE_KEY, settings);
  } catch (error) {
    settingsLogger.warn("settings_write_failed", {
      reason,
      error,
    });
    throw error;
  }
}

export function getSettings(): AppSettings {
  let raw: unknown;

  try {
    raw = wx.getStorageSync(SETTINGS_STORAGE_KEY);
  } catch (error) {
    settingsLogger.warn("settings_read_failed", {
      error,
    });
    return { ...DEFAULT_SETTINGS };
  }

  const parsedRaw = tryParseRawSettings(raw);
  if (!hasStoredValue(parsedRaw)) {
    return { ...DEFAULT_SETTINGS };
  }

  const normalized = normalizeSettings(parsedRaw);

  if (normalized.shouldPersist) {
    try {
      writeSettingsToStorage(normalized.settings, "repair");
    } catch (_error) {
      // Keep running with normalized in-memory values.
    }
  }

  return normalized.settings;
}

export function updateSettings(partialSettings: Partial<AppSettings>): AppSettings {
  const current = getSettings();

  const merged: AppSettings = {
    fontSize: partialSettings.fontSize ?? current.fontSize,
    displayDensity: partialSettings.displayDensity ?? current.displayDensity,
    saveSearchHistory: partialSettings.saveSearchHistory ?? current.saveSearchHistory,
    wifiOnlyDownload: partialSettings.wifiOnlyDownload ?? current.wifiOnlyDownload,
    formulaImageScale: partialSettings.formulaImageScale ?? current.formulaImageScale,
  };

  const nextSettings = normalizeSettings(merged).settings;
  writeSettingsToStorage(nextSettings, "update");
  return nextSettings;
}

export function resetSettings(): AppSettings {
  try {
    wx.removeStorageSync(SETTINGS_STORAGE_KEY);
  } catch (error) {
    settingsLogger.warn("settings_reset_failed", {
      error,
    });
    throw error;
  }

  return { ...DEFAULT_SETTINGS };
}

export function getFormulaImageScale(): number {
  return getSettings().formulaImageScale;
}
