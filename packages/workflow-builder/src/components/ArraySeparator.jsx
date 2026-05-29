import React, { useEffect, useRef, useState } from "react";
import { Handle, Position, useReactFlow, useStore, useUpdateNodeInternals } from "reactflow";
import axios from "axios";
import { runtimeApi, getErrorMessage } from "./runtimeApi";
import { FaAngleLeft, FaAngleRight } from "react-icons/fa6";
import { IoTrashOutline } from "react-icons/io5";
import { RiPlayLargeFill } from "react-icons/ri";
import { TbListDetails } from "react-icons/tb";
import { toast } from "react-hot-toast";
import { concatModels } from "./utility";
import { getRunId } from "./WorkflowStore";
import NodeOptionsMenu from "./NodeOptionsMenu";
import NodeSendButton from "./NodeSendButton";

const outputHandles = ["arraySeparatorOutput"];

const getArraySeparatorModel = () => concatModels.find((model) => model.id === "array-separator") || concatModels[0];

const initializeFormData = (schemaProperties) => Object.entries(schemaProperties || {}).reduce((acc, [fieldName, fieldSchema]) => {
  if (fieldSchema.default !== undefined) acc[fieldName] = fieldSchema.default;
  else if (fieldSchema.examples?.length > 0) acc[fieldName] = fieldSchema.examples[0];
  else if (fieldSchema.type === "boolean") acc[fieldName] = false;
  else acc[fieldName] = "";
  return acc;
}, {});

const decodeSeparator = (value) => {
  const raw = value == null ? "" : String(value);
  const normalized = raw.replace(/\r\n/g, "\n").trim();
  const candidate = normalized || "\\n";
  return candidate
    .replace(/\\r/g, "\r")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t");
};

const splitPreview = (formValues) => {
  const text = String(formValues?.text || "");
  const separator = decodeSeparator(formValues?.separator);
  const trimItems = formValues?.trim_items !== false;
  const removeEmpty = formValues?.remove_empty !== false;
  let items = text.split(separator);
  if (trimItems) items = items.map((item) => item.trim());
  if (removeEmpty) items = items.filter(Boolean);
  return items;
};

const ArraySeparator = ({ id, data, selected }) => {
  const [selectedModel, setSelectedModel] = useState(data.selectedModel || getArraySeparatorModel());
  const [connectedInputs, setConnectedInputs] = useState({});
  const [connectedOutputs, setConnectedOutputs] = useState({});
  const [formValues, setFormValues] = useState(data.formValues || {});
  const [currentHistoryIndex, setCurrentHistoryIndex] = useState(-1);
  const [currentOutputIndex, setCurrentOutputIndex] = useState(0);
  const runId = data.runId ?? getRunId();
  const nodeSchemas = data.nodeSchemas || {};
  const { setNodes, setEdges } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const edges = useStore((state) => state.edges);
  const schemaModel = nodeSchemas?.categories?.utility?.models?.[selectedModel.id];
  const properties = schemaModel?.input_schema?.schemas?.input_data?.properties || selectedModel?.input_params?.properties || {};
  const outputHistory = data.outputHistory || [];
  const previewItems = splitPreview(formValues);
  const currentOutputList = currentHistoryIndex !== -1 && outputHistory[currentHistoryIndex]
    ? outputHistory[currentHistoryIndex]?.result?.outputs || []
    : (data.outputs || []);
  const renderedItems = currentOutputList.length > 0
    ? currentOutputList.map((item) => item?.value).filter((value) => typeof value === "string")
    : previewItems;

  useEffect(() => {
    const defaults = initializeFormData(properties);
    const validKeys = Object.keys(properties);
    const filtered = Object.entries(data.formValues || {}).reduce((acc, [key, val]) => {
      if (validKeys.includes(key)) acc[key] = val;
      return acc;
    }, {});
    setFormValues({ ...defaults, ...filtered });
  }, [selectedModel.id, schemaModel]);

  useEffect(() => {
    if (data.selectedModel) setSelectedModel(data.selectedModel);
    if (data.triggerRun) {
      handleRunSingleNode();
      data.onDataChange(id, { triggerRun: false });
    }
    if (data.outputHistory?.length > 0 && currentHistoryIndex === -1) {
      setCurrentHistoryIndex(data.outputHistory.length - 1);
      setCurrentOutputIndex(0);
    }
  }, [data.selectedModel, data.triggerRun, data.outputHistory]);

  useEffect(() => {
    updateNodeInternals(id);
  }, [formValues, id]);

  useEffect(() => {
    if (!data.formValues) return;
    const incoming = JSON.stringify(data.formValues);
    const current = JSON.stringify(formValues);
    if (incoming === current) return;
    const timer = setTimeout(() => {
      if (Object.entries(data.formValues || {}).length > 0) setFormValues(data.formValues);
    }, 200);
    return () => clearTimeout(timer);
  }, [data.formValues]);

  useEffect(() => {
    data?.onDataChange?.(id, { selectedModel, formValues });
  }, [selectedModel, formValues]);

  useEffect(() => {
    const connectedInputs = {
      arraySeparatorInput: edges.some((e) => e.target === id && e.targetHandle === "arraySeparatorInput"),
    };
    const connectedOutputs = {};
    outputHandles.forEach((handle) => {
      connectedOutputs[handle] = edges.some((e) => e.source === id && e.sourceHandle === handle);
    });
    setConnectedInputs(connectedInputs);
    setConnectedOutputs(connectedOutputs);
  }, [edges, id]);

  const pollNodeStatus = (run_id) => {
    const interval = setInterval(() => {
      axios.get(`/api/workflow/run/${run_id}/status`)
        .then((response) => {
          const nodesInRes = response.data.nodes || {};
          const nodeData = nodesInRes[id] || Object.entries(nodesInRes).find(([key]) => key.toLowerCase().replace(/\s+/g, '') === id.toLowerCase().replace(/\s+/g, ''))?.[1];
          if (!nodeData || nodeData.length === 0) return;
          const latest = nodeData[0];
          if (latest.status === "succeeded" || latest.status === "completed") {
            const output = latest.result.outputs;
            const val = output[0]?.value || "";
            const currentHistory = data.outputHistory || [];
            const result = latest.result;
            const isAlreadyInHistory = currentHistory.some((h) => h.result?.id === result.id);
            const newHistory = isAlreadyInHistory ? currentHistory.map((h) => h.result?.id === result.id ? latest : h) : [...currentHistory, latest];
            data?.onDataChange?.(id, { outputs: output, resultUrl: val, isLoading: false, errorMsg: null, outputHistory: newHistory });
            setCurrentHistoryIndex(newHistory.length - 1);
            setCurrentOutputIndex(0);
            clearInterval(interval);
          }
          if (latest.status === "failed") {
            const errorMsg = latest?.result?.outputs?.[0]?.value?.error || "Separator failed";
            data.onDataChange(id, { isLoading: false, errorMsg, outputHistory: data.outputHistory || [] });
            toast.error(errorMsg);
            clearInterval(interval);
          }
        })
        .catch(() => {
          clearInterval(interval);
          data.onDataChange(id, { isLoading: false });
        });
    }, 3000);
  };

  const handleRunSingleNode = async () => {
    try {
      data.onDataChange(id, { isLoading: true, errorMsg: null });
      const workflow_id = await data.handleSaveWorkFlow();
      if (!workflow_id) {
        toast.error("Failed to save workflow before running node");
        data.onDataChange(id, { isLoading: false });
        return;
      }
      const modelSchema = nodeSchemas?.categories?.utility?.models[selectedModel.id]?.input_schema?.schemas?.input_data;
      if (!modelSchema || !modelSchema.properties) {
        toast.error("No input schema found for this model");
        data.onDataChange(id, { isLoading: false });
        return;
      }
      const params = {};
      for (const [key, meta] of Object.entries(modelSchema.properties)) {
        params[key] = Object.prototype.hasOwnProperty.call(formValues, key) ? formValues[key] : meta.default ?? null;
      }
      const response = await runtimeApi.post(`/api/workflow/${workflow_id}/node/${id}/run`, {
        run_id: runId || undefined,
        model: selectedModel.id,
        params,
        node_id: "Array Separator"
      });
      data.onDataChange(id, { runId: response.data.run_id });
      pollNodeStatus(response.data.run_id);
    } catch (error) {
      data.onDataChange(id, { isLoading: false });
      toast.error(getErrorMessage(error, "Error running separator"));
    }
  };

  const handleDeleteNode = () => {
    if (window.confirm(`Are you sure you want to delete this ${id} node?`)) {
      setNodes((nds) => nds.filter((n) => n.id !== id));
      setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
      toast.success(`Deleted node ${id}`);
    }
  };

  const handlePrev = (e) => {
    e.stopPropagation();
    if (currentHistoryIndex > 0) {
      setCurrentHistoryIndex(currentHistoryIndex - 1);
      setCurrentOutputIndex(0);
    }
  };

  const handleNext = (e) => {
    e.stopPropagation();
    if (currentHistoryIndex < outputHistory.length - 1) {
      setCurrentHistoryIndex(currentHistoryIndex + 1);
      setCurrentOutputIndex(0);
    }
  };

  const handleDeleteHistory = async (e) => {
    e.stopPropagation();
    const currentHistory = outputHistory[currentHistoryIndex];
    if (!currentHistory?.node_run_id) return;
    try {
      await axios.delete(`/api/workflow/node-run/${currentHistory.node_run_id}`);
      const newHistory = outputHistory.filter((_, index) => index !== currentHistoryIndex);
      data?.onDataChange?.(id, { outputHistory: newHistory, ...(newHistory.length === 0 ? { outputs: [], resultUrl: null } : {}) });
      setCurrentHistoryIndex(newHistory.length === 0 ? -1 : Math.max(0, currentHistoryIndex - 1));
      toast.success("History entry deleted");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to delete history entry");
    }
  };

  const handleFieldChange = (fieldName, value) => {
    setFormValues((prev) => ({ ...prev, [fieldName]: value }));
  };

  return (
    <div
      style={{ minHeight: 170, '--loader-color': '#8b5cf6' }}
      className={`nowheel group flex flex-col flex-1 w-96 rounded-xl border relative transition-all duration-300 ease-in-out ${selected ? "border-violet-500 shadow-[0_0_18px_rgba(139,92,246,0.25)]" : "border-zinc-800 hover:border-zinc-700 shadow-lg"} bg-[#1f2026]/95 backdrop-blur-sm`}
    >
      {data.isLoading && <div className="loader-border" />}
      <h3 className="absolute -top-5 left-0 text-zinc-400 text-[10px] font-medium tracking-wider uppercase">
        Array Separator {id.replace(/^\D+/g, "")}
      </h3>
      <div className="flex items-center justify-between rounded-t-xl border-b border-white/5 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className={`p-1.5 rounded-lg ${selected ? "bg-violet-600 text-white" : "bg-zinc-800 text-zinc-400"} transition-colors`}>
            <TbListDetails size={14} />
          </div>
          <h3 className="text-sm font-semibold text-zinc-100">Array Separator</h3>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-zinc-300">{renderedItems.length} items</span>
          <NodeOptionsMenu nodeId={id} onDuplicate={data.duplicateNode} onDelete={handleDeleteNode} />
        </div>
      </div>
      <div className="flex flex-col gap-3 p-4">
        {outputHistory.length > 0 && (
          <div className="flex items-center justify-end">
            <div className="flex items-center gap-1 rounded-full border border-white/10 bg-black/20 p-1">
              <button type="button" suppressHydrationWarning={true} onClick={handlePrev} disabled={currentHistoryIndex <= 0} className="flex h-6 w-6 items-center justify-center rounded-full text-zinc-400 transition-all hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"><FaAngleLeft size={10} /></button>
              <span className="px-1 text-[10px] font-semibold tabular-nums text-white/90">{currentHistoryIndex + 1}/{outputHistory.length}</span>
              <button type="button" suppressHydrationWarning={true} onClick={handleDeleteHistory} className="flex items-center justify-center rounded-full p-1 text-zinc-400 transition-colors hover:bg-red-500/10 hover:text-red-500" title="Delete history"><IoTrashOutline size={10} /></button>
              <NodeSendButton id={id} data={data} outputHistory={outputHistory} currentHistoryIndex={currentHistoryIndex} currentOutputIndex={currentOutputIndex} />
              <button type="button" suppressHydrationWarning={true} onClick={handleNext} disabled={currentHistoryIndex >= outputHistory.length - 1} className="flex h-6 w-6 items-center justify-center rounded-full text-zinc-400 transition-all hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"><FaAngleRight size={10} /></button>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 text-xs text-zinc-300">
          <span className="font-medium text-zinc-200">Split text by:</span>
          <input
            type="text"
            value={formValues.separator || ""}
            onChange={(e) => handleFieldChange("separator", e.target.value)}
            className="w-20 rounded-md border border-white/10 bg-zinc-900/60 px-2 py-1 text-center text-xs text-white outline-none transition-all focus:border-violet-500"
          />
        </div>
        <div className="rounded-lg border border-white/10 bg-black/10 p-2">
          <div className="flex max-h-40 flex-col gap-2 overflow-y-auto custom-scrollbar">
            {renderedItems.length > 0 ? renderedItems.slice(0, 6).map((item, index) => (
              <div key={`${index}-${item}`} className="rounded-md border border-white/5 bg-black/20 px-3 py-2 text-xs text-zinc-200 break-words">
                {item}
              </div>
            )) : (
              <div className="px-1 py-2 text-xs italic text-zinc-500">Connect text input, set separator, then run.</div>
            )}
          </div>
        </div>
        <div className="flex items-center justify-end">
          <button type="button" suppressHydrationWarning={true} onClick={handleRunSingleNode} className="flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium bg-violet-500 text-white hover:bg-violet-600 transition-all">
            <RiPlayLargeFill size={14} /> Run
          </button>
        </div>
      </div>
      <Handle type="target" position={Position.Left} id="arraySeparatorInput" style={{ top: 100, width: 12, height: 12, transition: 'all 0.2s ease-in-out' }} className={`!rounded-full !border-2 transition-all duration-200 !left-[-7px] ${connectedInputs.arraySeparatorInput ? '!bg-blue-500 !border-white shadow-[0_0_20px_rgba(59,130,246,1)]' : '!bg-black !border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.5)]'} hover:!scale-125`} data-type="blue" />
      <p className={`absolute -left-8 top-[100px] text-xs text-blue-500 transition-opacity duration-200 ${data.activeHandleColor === "blue" ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>Text</p>
      <Handle type="source" position={Position.Right} id="arraySeparatorOutput" style={{ top: 100, width: 12, height: 12, transition: 'all 0.2s ease-in-out' }} className={`!rounded-full !border-2 transition-all duration-200 !right-[-7px] ${connectedOutputs.arraySeparatorOutput ? '!bg-blue-500 !border-white shadow-[0_0_20px_rgba(59,130,246,1)]' : '!bg-black !border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.5)]'} hover:!scale-125`} data-type="blue" />
      <p className={`absolute -right-7 top-[100px] text-xs text-blue-500 transition-opacity duration-200 ${data.activeHandleColor === "blue" ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>List</p>
    </div>
  );
};

export default ArraySeparator;
