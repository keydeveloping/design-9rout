import React, { useEffect, useMemo, useRef, useState } from "react";
import { Handle, Position, useReactFlow, useStore, useUpdateNodeInternals } from "reactflow";
import axios from "axios";
import { FaAngleLeft, FaAngleRight } from "react-icons/fa6";
import { IoTrashOutline } from "react-icons/io5";
import { RiPlayLargeFill } from "react-icons/ri";
import { TbArrowMerge } from "react-icons/tb";
import { toast } from "react-hot-toast";
import { concatModels } from "./utility";
import { getRunId } from "./WorkflowStore";
import NodeOptionsMenu from "./NodeOptionsMenu";
import NodeSendButton from "./NodeSendButton";
import { useGenerationCost } from "./useGenerationCost";

const outputHandles = ["concatOutput"];

const initializeFormData = (schemaProperties) => Object.entries(schemaProperties || {}).reduce((acc, [fieldName, fieldSchema]) => {
  if (fieldSchema.type === "array") acc[fieldName] = fieldSchema.default || fieldSchema.examples || [];
  else if (fieldSchema.type === "object") acc[fieldName] = initializeFormData(fieldSchema.properties || {});
  else if (fieldSchema.default !== undefined) acc[fieldName] = fieldSchema.default;
  else if (fieldSchema.examples?.length > 0) acc[fieldName] = fieldSchema.examples[0];
  else if (fieldSchema.type === "boolean") acc[fieldName] = false;
  else if (["int", "number"].includes(fieldSchema.type)) acc[fieldName] = 0;
  else acc[fieldName] = "";
  return acc;
}, {});

const getConcatImageRefHandle = (index) => `concatImageInputRef-${index}`;
const isConcatImageReferenceHandle = (handleId) => typeof handleId === "string" && handleId.startsWith("concatImageInputRef-");
const getConcatImageReferenceIndex = (handleId) => {
  if (!isConcatImageReferenceHandle(handleId)) return -1;
  const parsed = Number.parseInt(handleId.split("-").pop(), 10);
  return Number.isNaN(parsed) ? -1 : parsed;
};

const PromptConcate = ({ id, data, selected }) => {
  const [selectedModel, setSelectedModel] = useState(data.selectedModel || concatModels[0]);
  const [connectedInputs, setConnectedInputs] = useState({});
  const [connectedOutputs, setConnectedOutputs] = useState({});
  const [formValues, setFormValues] = useState(data.formValues || {});
  const [currentHistoryIndex, setCurrentHistoryIndex] = useState(-1);
  const [currentOutputIndex, setCurrentOutputIndex] = useState(0);
  const textareaRef = useRef(null);
  const runId = data.runId ?? getRunId();
  const nodeSchemas = data.nodeSchemas || {};
  const outputHistory = data.outputHistory || [];
  const { setNodes, setEdges } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const edges = useStore((state) => state.edges);
  const { generationCost } = useGenerationCost(selectedModel, formValues);
  const schemaModel = nodeSchemas?.categories?.utility?.models?.[selectedModel.id];
  const properties = schemaModel?.input_schema?.schemas?.input_data?.properties || selectedModel?.input_params?.properties || {};

  const currentOutputList = currentHistoryIndex !== -1 && outputHistory[currentHistoryIndex]
    ? outputHistory[currentHistoryIndex]?.result?.outputs || []
    : (data.outputs || []);
  const currentOutput = currentOutputList.length > 0
    ? currentOutputList[currentOutputIndex]?.value || currentOutputList[0]?.value || data.resultUrl
    : data.resultUrl;
  const displayValue = typeof currentOutput === "string"
    ? currentOutput
    : currentOutput ? JSON.stringify(currentOutput, null, 2) : "";

  const additionalImageCount = useMemo(() => {
    const list = Array.isArray(formValues.image_urls) ? formValues.image_urls : [];
    return Math.max(1, list.length || 0);
  }, [JSON.stringify(formValues.image_urls || [])]);

  const concatInputConfigs = useMemo(() => {
    const baseInputs = [
      { id: "concatInput", field: "prompt", label: "Prompt", color: "blue", top: 120 },
      { id: "concatInput4", field: "system_prompt", label: "System Prompt", color: "blue", top: 158 },
      { id: "concatImageInput", field: "image_url", label: "Image Input", color: "green", top: 198 },
    ];
    const extraImageInputs = Array.from({ length: additionalImageCount }, (_, index) => ({
      id: getConcatImageRefHandle(index),
      field: "image_urls",
      label: `Image Input ${index + 2}`,
      color: "green",
      top: 236 + (index * 38),
    }));
    return [...baseInputs, ...extraImageInputs];
  }, [additionalImageCount]);

  const inputHandles = concatInputConfigs.map((input) => input.id);
  const inputLabelColumnClass = "right-[calc(100%+16px)] w-28 text-right";

  useEffect(() => {
    const defaults = initializeFormData(properties);
    const validKeys = Object.keys(properties);
    const filteredFormValues = Object.entries(data.formValues || {}).reduce((acc, [key, val]) => {
      if (validKeys.includes(key)) acc[key] = val;
      return acc;
    }, {});
    const nextFormValues = { ...defaults, ...filteredFormValues };
    if (!Array.isArray(nextFormValues.image_urls)) nextFormValues.image_urls = [];
    setFormValues(nextFormValues);
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
  }, [formValues, id, concatInputConfigs.map((input) => `${input.id}:${input.top}`).join("|")]);

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
    data?.onDataChange?.(id, { selectedModel, formValues, cost: generationCost });
  }, [selectedModel, formValues, generationCost]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "0px";
      textarea.style.height = `${Math.max(textarea.scrollHeight, 210)}px`;
    }
  }, [displayValue]);

  useEffect(() => {
    const nextConnectedInputs = {};
    inputHandles.forEach((handle) => {
      nextConnectedInputs[handle] = edges.some((e) => e.target === id && e.targetHandle === handle);
    });
    const nextConnectedOutputs = {};
    outputHandles.forEach((handle) => {
      nextConnectedOutputs[handle] = edges.some((e) => e.source === id && e.sourceHandle === handle);
    });
    setConnectedInputs(nextConnectedInputs);
    setConnectedOutputs(nextConnectedOutputs);
  }, [edges, id, inputHandles.join("|")]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      const validHandles = concatInputConfigs.map((input) => input.id);
      setEdges((prevEdges) => prevEdges.filter((edge) => edge.target !== id || validHandles.includes(edge.targetHandle)));
    }, 2000);
    return () => clearTimeout(timeout);
  }, [concatInputConfigs.map((input) => input.id).join("|"), id, setEdges]);

  const handleAddImageInput = () => {
    setFormValues((prev) => ({
      ...prev,
      image_urls: [...(Array.isArray(prev.image_urls) ? prev.image_urls : []), ""],
    }));
  };

  const pollNodeStatus = (run_id) => {
    const interval = setInterval(() => {
      axios.get(`/api/workflow/run/${run_id}/status`)
        .then((response) => {
          const nodesInRes = response.data.nodes || {};
          const nodeData = nodesInRes[id] || Object.entries(nodesInRes).find(([key]) =>
            key.toLowerCase().replace(/\s+/g, '') === id.toLowerCase().replace(/\s+/g, '')
          )?.[1];
          if (!nodeData || nodeData.length === 0) return;
          const latest = nodeData[0];
          if (latest.status === "succeeded" || latest.status === "completed") {
            const output = latest.result.outputs;
            const val = output[0]?.value || "";
            const currentHistory = data.outputHistory || [];
            const result = latest.result;
            const isAlreadyInHistory = currentHistory.some((h) => h.result?.id === result.id);
            const newHistory = isAlreadyInHistory
              ? currentHistory.map((h) => h.result?.id === result.id ? latest : h)
              : [...currentHistory, latest];
            data?.onDataChange?.(id, { outputs: output, resultUrl: val, isLoading: false, errorMsg: null, outputHistory: newHistory });
            setCurrentHistoryIndex(newHistory.length - 1);
            setCurrentOutputIndex(0);
            clearInterval(interval);
          }
          if (latest.status === "failed") {
            const outputs = latest?.result?.outputs;
            const errorMsg = outputs?.[0]?.value?.error || "Generation failed";
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
      const response = await axios.post(`/api/workflow/${workflow_id}/node/${id}/run`, {
        run_id: runId || undefined,
        model: selectedModel.id,
        params,
        cost: generationCost,
        node_id: "Prompt Concatenator"
      });
      data.onDataChange(id, { runId: response.data.run_id });
      pollNodeStatus(response.data.run_id);
    } catch (error) {
      data.onDataChange(id, { isLoading: false });
      toast.error(error.response?.data?.detail || "Error running node");
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

  return (
    <div
      style={{ minHeight: 280 + (additionalImageCount * 38), '--loader-color': '#2563eb' }}
      className={`nowheel group flex flex-col flex-1 w-80 rounded-2xl border-2 relative transition-all duration-300 ease-in-out ${selected ? "border-blue-600 shadow-[0_0_25px_rgba(37,99,235,0.3)] ring-1 ring-blue-500/20" : "border-zinc-800 hover:border-zinc-700 shadow-lg"} bg-[#0c0d0f]/95 backdrop-blur-sm`}
    >
      {data.isLoading && <div className="loader-border" />}
      <h3 className="absolute -top-5 left-0 text-zinc-400 text-[10px] font-medium tracking-wider uppercase">
        Prompt Concatenator {id.replace(/^\D+/g, "")}
      </h3>
      <div className="flex items-center justify-between bg-gradient-to-r from-[#151618] to-[#1c1e21] rounded-t-2xl border-b border-zinc-800 py-2 px-3">
        <div className="flex items-center gap-2.5">
          <div className={`p-1.5 rounded-lg ${selected ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-400"} transition-colors`}>
            <TbArrowMerge size={14} className="rotate-90" />
          </div>
          <h3 className="text-xs font-bold text-zinc-100">{selectedModel.name}</h3>
        </div>
        <NodeOptionsMenu nodeId={id} onDuplicate={data.duplicateNode} onDelete={handleDeleteNode} />
      </div>
      <div className="flex flex-col gap-3 p-3">
        {outputHistory.length > 0 && (
          <div className="flex items-center justify-end">
            <div className="bg-[#0c0d0f]/95 flex items-center gap-1 p-1 border border-white/10 rounded-full">
              <button type="button" suppressHydrationWarning={true} onClick={handlePrev} disabled={currentHistoryIndex <= 0} className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-white/10 text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"><FaAngleLeft size={10} /></button>
              <span className="text-[9px] font-bold text-white/90 tabular-nums tracking-wide px-1">{currentHistoryIndex + 1}/{outputHistory.length}</span>
              <button type="button" suppressHydrationWarning={true} onClick={handleDeleteHistory} className="p-1 hover:bg-red-500/10 rounded-full text-zinc-400 hover:text-red-500 transition-colors flex items-center justify-center" title="Delete history"><IoTrashOutline size={10} /></button>
              <NodeSendButton id={id} data={data} outputHistory={outputHistory} currentHistoryIndex={currentHistoryIndex} currentOutputIndex={currentOutputIndex} />
              <button type="button" suppressHydrationWarning={true} onClick={handleNext} disabled={currentHistoryIndex >= outputHistory.length - 1} className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-white/10 text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"><FaAngleRight size={10} /></button>
            </div>
          </div>
        )}
        <div className="relative flex flex-col gap-2 bg-zinc-900/30 rounded-xl border border-zinc-800/50 w-full p-2">
          <textarea
            ref={textareaRef}
            readOnly
            value={displayValue}
            placeholder="Run node to generate output..."
            className="w-full min-h-[210px] max-h-96 text-xs leading-relaxed outline-none bg-transparent resize-none text-zinc-100 font-medium placeholder:italic placeholder:opacity-50 custom-scrollbar"
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            suppressHydrationWarning={true}
            onClick={handleAddImageInput}
            className="text-xs text-zinc-400 hover:text-white transition-colors"
          >
            + Add another image input
          </button>
          <button
            type="button"
            suppressHydrationWarning={true}
            onClick={handleRunSingleNode}
            className="flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-medium bg-blue-500 text-white hover:bg-blue-600 transition-all"
          >
            <RiPlayLargeFill size={14} /> Run
          </button>
        </div>
      </div>
      {concatInputConfigs.map((input) => (
        <React.Fragment key={input.id}>
          <Handle
            type="target"
            position={Position.Left}
            id={input.id}
            style={{ top: input.top, width: 12, height: 12, transition: 'all 0.2s ease-in-out' }}
            className={`!rounded-full !border-[3px] transition-all duration-200 !left-[-8px] ${connectedInputs[input.id] ? input.color === "green" ? '!bg-emerald-500 !border-white shadow-[0_0_20px_rgba(16,185,129,1)]' : '!bg-blue-500 !border-white shadow-[0_0_20px_rgba(59,130,246,1)]' : input.color === "green" ? '!bg-black !border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.5)]' : '!bg-black !border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.5)]'} hover:!scale-125`}
            data-type={input.color}
          />
          <p className={`absolute ${inputLabelColumnClass} text-xs whitespace-nowrap transition-opacity duration-200 ${input.color === "green" ? "text-emerald-500" : "text-blue-500"} ${data.activeHandleColor === input.color ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`} style={{ top: `${input.top - 1}px` }}>
            {input.label}
          </p>
        </React.Fragment>
      ))}
      <Handle
        type="source"
        position={Position.Right}
        id="concatOutput"
        style={{ top: 120, width: 12, height: 12, transition: 'all 0.2s ease-in-out' }}
        className={`!rounded-full !border-[3px] transition-all duration-200 !right-[-8px] ${connectedOutputs.concatOutput ? '!bg-blue-500 !border-white shadow-[0_0_20px_rgba(59,130,246,1)]' : '!bg-black !border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.5)]'} hover:!scale-125 hover:shadow-[0_0_20px_rgba(59,130,246,1)]`}
        data-type="blue"
      />
      <p className={`absolute -right-7 top-[120px] text-xs text-blue-500 transition-opacity duration-200 ${data.activeHandleColor === "blue" ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>Text</p>
    </div>
  );
};

export default PromptConcate;
