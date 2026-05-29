"use client";

import React, { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { clearRuntimeSettings, getRuntimeSettings, saveRuntimeSettings } from "./runtimeSettings";
import { getErrorMessage, runtimeApi } from "./runtimeApi";

const RuntimeSettingsModal = ({ isOpen, onClose, onSaved }) => {
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const settings = getRuntimeSettings();
    setBaseUrl(settings.baseUrl);
    setApiKey(settings.apiKey);
  }, [isOpen]);

  if (!isOpen) return null;

  const draftSettings = {
    baseUrl,
    apiKey,
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    try {
      setIsSaving(true);
      const settings = saveRuntimeSettings(draftSettings);
      onSaved?.(settings);
      toast.success("9router settings saved");
      onClose?.();
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    try {
      setIsTesting(true);
      const response = await runtimeApi.post(
        "/api/settings/runtime/test",
        {},
        {},
        draftSettings
      );
      const count = response?.data?.models_count ?? 0;
      toast.success(`Connection OK${count ? ` • ${count} models` : ""}`);
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to test 9router connection"));
    } finally {
      setIsTesting(false);
    }
  };

  const handleClear = () => {
    const settings = clearRuntimeSettings();
    setBaseUrl(settings.baseUrl);
    setApiKey(settings.apiKey);
    onSaved?.(settings);
    toast.success("9router settings cleared");
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-2xl border border-gray-700 bg-[#1b1e23] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-gray-700/70 p-5">
          <h3 className="text-lg font-semibold text-white">9router Settings</h3>
          <p className="mt-1 text-xs text-gray-400">Stored in this browser only. Not saved to workflow or server.</p>
        </div>
        <div className="flex flex-col gap-4 p-5">
          <label className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-wider text-gray-400">Base URL</span>
            <input
              type="url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="http://localhost:20128"
              className="w-full rounded-xl border border-gray-700 bg-[#151618] px-4 py-3 text-sm text-white placeholder-gray-500 outline-none transition hover:border-gray-600 focus:ring-2 focus:ring-blue-500/50"
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-wider text-gray-400">API Key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="9router key"
              className="w-full rounded-xl border border-gray-700 bg-[#151618] px-4 py-3 text-sm text-white placeholder-gray-500 outline-none transition hover:border-gray-600 focus:ring-2 focus:ring-blue-500/50"
            />
          </label>
        </div>
        <div className="flex flex-wrap justify-end gap-3 border-t border-gray-700/70 bg-[#151618]/50 p-4">
          <button type="button" onClick={handleClear} className="rounded-xl px-5 py-2.5 text-sm font-medium text-red-300 transition hover:bg-red-500/10 hover:text-red-200">
            Clear
          </button>
          <button type="button" onClick={handleTest} disabled={isTesting} className="rounded-xl px-5 py-2.5 text-sm font-medium text-gray-200 transition hover:bg-gray-800 disabled:opacity-50">
            {isTesting ? "Testing..." : "Test Connection"}
          </button>
          <button type="button" onClick={onClose} className="rounded-xl px-5 py-2.5 text-sm font-medium text-gray-400 transition hover:bg-gray-800 hover:text-white">
            Cancel
          </button>
          <button type="submit" disabled={isSaving} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-blue-900/20 transition hover:bg-blue-500 disabled:opacity-50">
            {isSaving ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default RuntimeSettingsModal;
