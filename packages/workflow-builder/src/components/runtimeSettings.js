const STORAGE_KEY = "9router.runtimeSettings";
export const RUNTIME_SETTINGS_EVENT = "runtime-settings-changed";

export const DEFAULT_RUNTIME_SETTINGS = {
  baseUrl: "",
  apiKey: "",
};

export const getRuntimeSettings = () => {
  if (typeof window === "undefined") return DEFAULT_RUNTIME_SETTINGS;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_RUNTIME_SETTINGS;

    const parsed = JSON.parse(raw);
    return {
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "",
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
    };
  } catch (error) {
    console.error("Failed to read runtime settings", error);
    return DEFAULT_RUNTIME_SETTINGS;
  }
};

export const saveRuntimeSettings = (settings) => {
  if (typeof window === "undefined") return DEFAULT_RUNTIME_SETTINGS;

  const next = {
    baseUrl: settings?.baseUrl?.trim() || "",
    apiKey: settings?.apiKey?.trim() || "",
  };

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(RUNTIME_SETTINGS_EVENT, { detail: next }));
  return next;
};

export const clearRuntimeSettings = () => {
  if (typeof window === "undefined") return DEFAULT_RUNTIME_SETTINGS;
  window.localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(RUNTIME_SETTINGS_EVENT, { detail: DEFAULT_RUNTIME_SETTINGS }));
  return DEFAULT_RUNTIME_SETTINGS;
};

export const getRuntimeSettingsHeaders = (settingsOverride = null) => {
  const settings = settingsOverride || getRuntimeSettings();
  const headers = {};

  if (settings.baseUrl) headers["X-KeyWorkflow-Router-URL"] = settings.baseUrl;
  if (settings.apiKey) headers["X-KeyWorkflow-Router-Key"] = settings.apiKey;

  return headers;
};

export const hasRuntimeSettings = () => {
  const settings = getRuntimeSettings();
  return Boolean(settings.baseUrl && settings.apiKey);
};
