import axios from "axios";
import { getRuntimeSettingsHeaders } from "./runtimeSettings";

export const runtimeAxiosConfig = (config = {}, settings = null) => ({
  ...config,
  headers: {
    ...(config.headers || {}),
    ...getRuntimeSettingsHeaders(settings),
  },
});

export const runtimeApi = {
  get: (url, config, settings) => axios.get(url, runtimeAxiosConfig(config, settings)),
  post: (url, data, config, settings) => axios.post(url, data, runtimeAxiosConfig(config, settings)),
  delete: (url, config, settings) => axios.delete(url, runtimeAxiosConfig(config, settings)),
};

export const getApiErrorDetail = (error) => error?.response?.data?.detail;

export const isRuntimeSettingsRequired = (error) => {
  const detail = getApiErrorDetail(error);
  return Boolean(detail && typeof detail === "object" && detail.code === "runtime_settings_required");
};

export const getErrorMessage = (error, fallback = "Request failed") => {
  const detail = getApiErrorDetail(error);
  if (Array.isArray(detail)) return detail.map((item) => item?.msg || String(item)).join("; ");
  if (detail && typeof detail === "object") return detail.message || JSON.stringify(detail);
  return detail || error?.response?.data?.error || error?.message || fallback;
};
