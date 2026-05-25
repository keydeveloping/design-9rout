import React, { useEffect, useMemo, useRef, useState } from "react";
import { Handle, Position, useReactFlow, useStore, useUpdateNodeInternals } from "reactflow";
import { FaAngleLeft, FaAngleRight } from "react-icons/fa6";
import { downloadFile, imageModels } from "./utility";
import { getRunId, getWorkflowId } from "./WorkflowStore";
import axios from "axios";
import { toast } from "react-hot-toast";
import { IoClose, IoImageOutline, IoTrashOutline } from "react-icons/io5";
import UploadNode from "./UploadNode";
import { SlOptions } from "react-icons/sl";
import { MdOutlineFileDownload } from "react-icons/md";
import { HiOutlineViewGrid } from "react-icons/hi";
import NodeSendButton from "./NodeSendButton";
import NodeOptionsMenu from "./NodeOptionsMenu";
import { useGenerationCost } from "./useGenerationCost";

const inputHandles = [
  "imageInput",
  "imageInput2",
  "imageInput3",
  "imageInput4"
];

const outputHandles = [
  "imageOutput",
];

const ImageGeneration = ({ id, data, selected }) => {
  const models = useMemo(() => {
    return data.nodeSchemas?.categories?.image?.models 
      ? Object.values(data.nodeSchemas.categories.image.models) 
      : [];
  }, [data.nodeSchemas]);
  
  const [selectedModel, setSelectedModel] = useState(data.selectedModel || models[1] || models[0] || {});
  const [connectedInputs, setConnectedInputs] = useState({});
  const [connectedOutputs, setConnectedOutputs] = useState({});
  const [formValues, setFormValues] = useState(data.formValues || {});
  const [dropDown, setDropDown] = useState(0);
  const [loading, setLoading] = useState(0);
  const [currentHistoryIndex, setCurrentHistoryIndex] = useState(-1);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [imageMetadata, setImageMetadata] = useState({ width: 0, height: 0, size: null });
  const outputHistory = data.outputHistory || [];
  const prevHistoryLengthRef = useRef(outputHistory.length);
  const workflowId = getWorkflowId();
  const runId = data.runId ?? getRunId();
  const nodeSchemas = data.nodeSchemas || {};
  const { setNodes, setEdges } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const edges = useStore((state) => state.edges);
  const properties = nodeSchemas?.categories?.image?.models?.[selectedModel.id]?.input_schema?.schemas?.input_data?.properties;
  const { generationCost, isRefreshingCost } = useGenerationCost(selectedModel, formValues);
  
  useEffect(() => {
    if (data.cost !== generationCost) {
      data.onDataChange?.(id, { cost: generationCost });
    }
  }, [id, generationCost, data.cost]);

  const initializeFormData = (schemaProperties) => {
    const initialData = {};
    const fieldEntries = Object.entries(schemaProperties || {});

    fieldEntries.forEach(([fieldName, fieldSchema]) => {
      if (fieldSchema.type === "array") {
        if (fieldSchema.items?.type === "object") {
          const examples = fieldSchema.examples;
          if (Array.isArray(examples) && examples.length > 0) {
            initialData[fieldName] = examples.map((ex) => ({ ...ex }));
          } else {
            initialData[fieldName] = [];
          }
        } else {
          initialData[fieldName] = fieldSchema.examples || [];
        }

      } else if (fieldSchema.type === "object") {
        const nestedProps = fieldSchema.properties || {};
        initialData[fieldName] = initializeFormData(nestedProps);

      } else if (fieldSchema.default !== undefined) {
        initialData[fieldName] = fieldSchema.default;

      } else if (fieldSchema.examples && fieldSchema.examples.length > 0) {
        initialData[fieldName] = fieldSchema.examples[0];

      } else {
        switch (fieldSchema.type) {
          case "boolean":
            initialData[fieldName] = false;
            break;
          case "int":
          case "number":
            initialData[fieldName] = 0;
            break;
          default:
            initialData[fieldName] = "";
        }
      }
    });

    return initialData;
  };

  const addFormValuesInTaskData = (properties) => {
    const defaults = initializeFormData(properties);

    const validKeys = Object.keys(properties);
    const filteredFormValues = Object.entries(data.formValues || {}).reduce((acc, [key, val]) => {
      if (validKeys.includes(key)) acc[key] = val;
      return acc;
    }, {});

    const merged = Object.entries({ ...defaults, ...filteredFormValues }).reduce(
      (acc, [key, val]) => {
        const meta = properties[key];
        if (meta?.enum && !meta.enum.includes(val)) {
          acc[key] = meta.default ?? meta.enum[0] ?? "";
        } else {
          acc[key] = val;
        }
        return acc;
      },
      {}
    );

    // Preserve UI-only flags that are not part of the model schema
    const UI_KEYS = ["make_output", "make_input"];
    UI_KEYS.forEach((k) => {
      if (data.formValues?.[k] !== undefined) merged[k] = data.formValues[k];
    });

    setFormValues(merged);
  };

  useEffect(() => {
    setLoading(1);
    if (properties) {
      addFormValuesInTaskData(properties);
    }
    setLoading(0);
  }, [selectedModel]);

  useEffect(() => {
    if (data.selectedModel) {
      setSelectedModel(data.selectedModel);
    }

    if (data.triggerRun) {
      handleRunSingleNode();
      data.onDataChange(id, { triggerRun: false });
    }

    if (data.outputHistory && data.outputHistory.length > 0) {
      if (currentHistoryIndex === -1) {
        setCurrentHistoryIndex(data.outputHistory.length - 1);
        setCurrentImageIndex(0);
      } else if (data.outputHistory.length > prevHistoryLengthRef.current) {
        setCurrentHistoryIndex(data.outputHistory.length - 1);
        setCurrentImageIndex(0);
      }
    }
    prevHistoryLengthRef.current = data.outputHistory ? data.outputHistory.length : 0;
  }, [data.selectedModel, data.triggerRun, data.outputHistory]);

  useEffect(() => {
    updateNodeInternals(id);
  }, [formValues, id]);

  const handleChange = (key, value) => {
    setFormValues(prev => ({ ...prev, [key]: value }));
    setDropDown(-1);
  };

  useEffect(() => {
    if (!data.formValues) return;
    const incoming = JSON.stringify(data.formValues);
    const current = JSON.stringify(formValues);
    if (incoming === current) return;
    
    const timer = setTimeout(() => {
      if (Object.entries(data.formValues || {}).length > 0) {
        setFormValues(data.formValues);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [data.formValues]);

  useEffect(() => {
    if (data?.onDataChange && data?.selectedModel?.id !== "image-passthrough") {
      data.onDataChange(id, { selectedModel, formValues, loading });
    }
  }, [selectedModel, formValues, loading]);
  
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
          const isAlreadyInHistory = currentHistory.some(h => h.result?.id === result.id);
          const newHistory = isAlreadyInHistory 
            ? currentHistory.map(h => h.result?.id === result.id ? latest : h)
            : [...currentHistory, latest];

          data?.onDataChange?.(id, { outputs: output, resultUrl: val, isLoading: false, errorMsg: null, outputHistory: newHistory });
          setCurrentHistoryIndex(newHistory.length - 1);
          setCurrentImageIndex(0);
          clearInterval(interval);
        }

        if (latest.status === "failed") {
          const outputs = latest?.result?.outputs;
          let errorMsg = "Generation failed";

          if (outputs && outputs[0]?.value?.error) {
            errorMsg = outputs[0].value.error; 
          }
          toast.error(`Node ${id} failed`);
          
          const currentHistory = data.outputHistory || [];
          data.onDataChange(id, { isLoading: false, errorMsg, outputHistory: currentHistory });
          clearInterval(interval);
        }
      })
      .catch((error) => {
        console.log(error);
        clearInterval(interval);
        data.onDataChange(id, { isLoading: false });
        toast.error(`Failed to get workflow status Image ${id.replace(/^\D+/g, "")}`);
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

      const modelSchema = nodeSchemas?.categories?.image?.models[selectedModel.id]?.input_schema?.schemas?.input_data;
      if (!modelSchema || !modelSchema.properties) {
        toast.error("No input schema found for this model");
        data.onDataChange(id, { isLoading: false });
        return;
      }
      const params = {};
      const inputSchema = modelSchema.properties;
      const localSources = formValues || {};
      for (const [key, meta] of Object.entries(inputSchema)) {
        if (localSources.hasOwnProperty(key)) {
          params[key] = localSources[key];
        } else {
          params[key] = meta.default ?? null;
        }
      }

      const response = await axios.post(`/api/workflow/${workflow_id}/node/${id}/run`, {
        run_id: runId || undefined,
        model: selectedModel.id,
        params: params,
        cost: generationCost,
        node_id: "AI Image"
      });
      data.onDataChange(id, { runId: response.data.run_id });
      pollNodeStatus(response.data.run_id);
    } catch(error) {
      data.onDataChange(id, { isLoading: false });
      toast.error(error.response?.data?.detail || "Error running node");
      console.error(error);
    };
  };

  const handleDeleteNode = () => {
    if (window.confirm(`Are you sure you want to delete this ${id} node?`)) {
      setNodes((nds) => nds.filter((n) => n.id !== id));
      setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
      toast.success(`Deleted node ${id}`);
    };
  };

  const hasPrompt = properties && "prompt" in properties && !data.selectedModel?.id.includes("passthrough");
  const hasImagesList = properties && "images_list" in properties && !data.selectedModel?.id.includes("passthrough");
  const hasImageUrl = properties && "image_url" in properties && !data.selectedModel?.id.includes("passthrough");
  const hasReferenceImage = properties && "image" in properties && !data.selectedModel?.id.includes("passthrough");

  const hasReferenceImages = (hasImagesList || hasReferenceImage) && !data.selectedModel?.id.includes("passthrough");
  const connectedReferenceHandles = edges
    .filter((e) => e.target === id && (e.targetHandle === "imageInput2" || String(e.targetHandle || "").startsWith("imageInputRef-")))
    .map((e) => e.targetHandle);
  const indexedReferenceHandles = connectedReferenceHandles
    .filter((handle) => String(handle).startsWith("imageInputRef-"))
    .map((handle) => Number.parseInt(String(handle).replace("imageInputRef-", ""), 10))
    .filter((index) => !Number.isNaN(index));
  const referenceImageCount = hasReferenceImages
    ? Math.max(1, Array.isArray(formValues.images_list) ? formValues.images_list.length : 0, indexedReferenceHandles.length ? Math.max(...indexedReferenceHandles) + 1 : 0)
    : 0;
  const referenceHandles = Array.from({ length: referenceImageCount }, (_, index) => ({
    id: `imageInputRef-${index}`,
    top: 126 + (index * 24),
    label: `Image ${index + 1}`,
    connected: connectedInputs[`imageInputRef-${index}`] || connectedInputs.imageInput2 || false,
  }));

  const handleBottom = referenceImageCount > 0 ? referenceHandles[referenceHandles.length - 1].top + 18 : 0;
  const nodeWidth = 250;
  const previewWidth = nodeWidth - 16;
  const previewHeight = previewWidth * ((imageMetadata.height || 1) / (imageMetadata.width || 1));
  const previewSectionHeight = previewHeight + 8;
  const outputSectionMinHeight = Math.max(previewSectionHeight, handleBottom + 8);
  const bottomSectionHeight = hasReferenceImages ? 42 : 0;
  const nodeMinHeight = 52 + outputSectionMinHeight + bottomSectionHeight;
  const outputSectionStyle = { minHeight: outputSectionMinHeight, height: outputSectionMinHeight - bottomSectionHeight, paddingBottom: bottomSectionHeight };
  const bottomSectionStyle = { minHeight: bottomSectionHeight, height: bottomSectionHeight };
  const bottomSectionClassName = "w-full relative z-10";
  const previewFrameStyle = { width: '100%', aspectRatio: `${imageMetadata.width || 1} / ${imageMetadata.height || 1}` };
  const nodeContainerStyle = { minHeight: nodeMinHeight, width: nodeWidth, '--loader-color': '#10b981' };
  const nodeContainerClassName = `
        nowheel group flex flex-col flex-1
        rounded-2xl border-2 relative transition-all duration-300 ease-in-out 
        ${selected 
          ? "border-emerald-600 shadow-[0_0_25px_rgba(16,185,129,0.3)] scale-[1.02] ring-1 ring-emerald-500/20" 
          : "border-zinc-800 hover:border-zinc-700 shadow-lg"} 
        bg-[#0c0d0f]/95 backdrop-blur-sm
      `;
  const previewSectionClassName = "flex items-start justify-center w-full px-2 pt-2 pb-0 rounded-b-2xl transition-all duration-500 overflow-hidden";
  const previewContainerClassName = "relative group/image flex items-center justify-center bg-white rounded-md overflow-hidden max-w-full mx-auto";
  const previewWrapperClassName = "h-full w-full flex items-center justify-center bg-white overflow-hidden";
  const previewImageClassName = "w-full h-full object-contain animate-in fade-in duration-500";
  const previewImageStyleFinal = undefined;
  const previewOverlayClassName = "absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/70 via-black/25 to-transparent opacity-0 group-hover/image:opacity-100 transition-opacity duration-300 pointer-events-none flex flex-col justify-end";
  const previewIndicatorsClassName = "absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1 z-10";
  const previewLoadingClassName = "flex items-center justify-center w-full h-full overflow-hidden bg-white/5 animate-pulse rounded-xl";
  const previewErrorClassName = "text-red-400 text-xs font-medium p-3 bg-red-500/10 rounded-xl border border-red-500/20 m-3 w-full";
  const outputEmptyClassName = "flex flex-col items-center justify-center text-zinc-400 gap-2";

  useEffect(() => {
    const timeout = setTimeout(() => {
      const validHandles = [
        hasPrompt && "imageInput",
        hasImageUrl && "imageInput3",
        hasReferenceImage && "imageInput4",
        hasImagesList && "imageInput2",
        ...referenceHandles.map((handle) => handle.id),
      ].filter(Boolean);

      setEdges((prevEdges) =>
        prevEdges.filter((edge) => {
          if (edge.target !== id) return true;
          return validHandles.includes(edge.targetHandle);
        })
      );
    }, 2000);
    return () => clearTimeout(timeout);
  }, [hasPrompt, hasImageUrl, hasReferenceImage, hasImagesList, id, setEdges]);

  useEffect(() => {
    const connectedInputs = {};
    [...inputHandles, ...referenceHandles.map((handle) => handle.id)].forEach((h) => {
      connectedInputs[h] = edges.some(
        (e) => e.target === id && e.targetHandle === h
      );
    });

    const connectedOutputs = {};
    outputHandles.forEach((h) => {
      connectedOutputs[h] = edges.some(
        (e) => e.source === id && e.sourceHandle === h
      );
    });

    setConnectedInputs(connectedInputs);
    setConnectedOutputs(connectedOutputs);
  }, [edges, id]);

  const handlePrev = (e) => {
    e.stopPropagation();
    if (currentHistoryIndex > 0) {
      const newIndex = currentHistoryIndex - 1;
      setCurrentHistoryIndex(newIndex);
      setCurrentImageIndex(0);
      const viewing = outputHistory[newIndex]?.result?.outputs?.[0]?.value;
      setNodes((nds) => nds.map((n) => {
        if (n.id === id) {
          return { ...n, data: { ...n.data, viewingOutput: viewing } };
        }
        return n;
      }));
    }
  };

  const handleNext = (e) => {
    e.stopPropagation();
    if (currentHistoryIndex < outputHistory.length - 1) {
      const newIndex = currentHistoryIndex + 1;
      setCurrentHistoryIndex(newIndex);
      setCurrentImageIndex(0);
      const viewing = outputHistory[newIndex]?.result?.outputs?.[0]?.value;
      setNodes((nds) => nds.map((n) => {
        if (n.id === id) {
          return { ...n, data: { ...n.data, viewingOutput: viewing } };
        }
        return n;
      }));
    }
  };

  const handleDeleteHistory = async (e) => {
    e.stopPropagation();
    const currentHistory = outputHistory[currentHistoryIndex];
    if (!currentHistory || !currentHistory.node_run_id) return;

    if (window.confirm("Are you sure you want to delete this history entry?")) {
      try {
        await axios.delete(`/api/workflow/node-run/${currentHistory.node_run_id}`);
        const newHistory = outputHistory.filter((_, i) => i !== currentHistoryIndex);
        
        data?.onDataChange?.(id, { 
          outputHistory: newHistory,
          ...(newHistory.length === 0 ? { outputs: [], resultUrl: null } : {})
        });

        if (newHistory.length === 0) {
          setCurrentHistoryIndex(-1);
        } else {
          setCurrentHistoryIndex(Math.max(0, currentHistoryIndex - 1));
        }
        toast.success("History entry deleted");
      } catch (error) {
        toast.error(error.response?.data?.detail || "Failed to delete history entry");
        console.error(error);
      }
    }
  };

  const currentOutputList = currentHistoryIndex !== -1 && outputHistory[currentHistoryIndex]
    ? outputHistory[currentHistoryIndex]?.result?.outputs || []
    : (data.outputs || []);

  const currentOutput = currentOutputList.length > 0
    ? currentOutputList[currentImageIndex]?.value || currentOutputList[0]?.value || data.resultUrl
    : data.resultUrl;

  useEffect(() => {
    if (!currentOutput) {
      setImageMetadata({ width: 0, height: 0, size: null });
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      setImageMetadata({
        width: img.naturalWidth,
        height: img.naturalHeight,
        size: null,
      });
    };
    img.onerror = () => {
      if (cancelled) return;
      setImageMetadata({ width: 0, height: 0, size: null });
    };
    img.src = currentOutput;

    return () => {
      cancelled = true;
    };
  }, [currentOutput]);

  const updateWorkflowThumbnail = async (thumbnail) => {
    const workflow_id = await data.handleSaveWorkFlow();
    if (!workflow_id) {
      toast.error("Workflow id not found");
      return;
    }

    if (!thumbnail) {
      toast.error("Thumbnail URL is required");
      return;
    }
    try { 
      const response = await axios.post(`/api/workflow/${workflow_id}/thumbnail`, { 
        thumbnail 
      });
      if (response.data.success) toast.success("Cover image updated successfully");
    } catch(error) {
      toast.error(error.response?.data?.detail || "Failed to save thumbnail");
      console.error(error);
    };
  };

  return (
    <div 
      style={nodeContainerStyle} 
      className={nodeContainerClassName}
    >
      {data.isLoading && (
        <div className="loader-border" />
      )}
      <div className="flex items-center gap-2 absolute -top-5 left-0">
        <h3 className="text-zinc-400 text-[10px] font-medium tracking-wider uppercase">
          Image {id.replace(/^\D+/g, "")}
        </h3>
        {generationCost !== null && !selectedModel?.id.includes("passthrough") && (
          <span className="text-xs text-green-500 -mt-0.5 font-medium flex items-center gap-1 opacity-80">
            {isRefreshingCost ? (
              <span className="flex items-center gap-1 italic text-emerald-200">
                <div className="w-2 h-2 border-[1.5px] border-emerald-200/30 border-t-emerald-400 rounded-full animate-spin"></div>
              </span>
            ) : (
              <span>
                {generationCost === 0 ? 'Free' : (`$${generationCost}`)}
              </span>
            )}
          </span>
        )}
      </div>
      <div className="flex flex-col">
        <div className="flex items-center justify-between bg-gradient-to-r from-[#151618] to-[#1c1e21] rounded-t-2xl border-b border-zinc-800 p-3">
          <div className="flex items-center gap-2.5">
            <div className={`p-1.5 rounded-lg ${selected ? "bg-emerald-600 text-white" : "bg-zinc-800 text-zinc-400"} transition-colors`}>
              <IoImageOutline size={14} />
            </div>
            <h3 className="text-xs font-bold text-zinc-100">
              {selectedModel.name}
            </h3>
          </div>
          {outputHistory.length > 0 && (
            <div className="absolute -top-12 right-0 bg-[#0c0d0f]/95 flex items-center gap-1 p-1 border border-white/10 rounded-full ml-auto">
              <button 
                type="button"
                suppressHydrationWarning={true}
                onClick={handlePrev}
                disabled={currentHistoryIndex <= 0}
                className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-white/10 text-white/70 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Previous"
              >
                <FaAngleLeft size={10} />
              </button>
              <div className="flex items-center gap-1.5 px-0.5">
                <span className="text-[9px] font-medium text-white/90 tabular-nums tracking-wide">
                  {currentHistoryIndex + 1}/{outputHistory.length}
                </span>
                <div className="w-[1px] h-2.5 bg-white/10" />
                <button 
                  type="button"
                  suppressHydrationWarning={true}
                  onClick={handleDeleteHistory}
                  className="p-1 hover:bg-red-500/10 rounded-full text-zinc-400 hover:text-red-500 transition-colors flex items-center justify-center"
                  title="Delete history"
                >
                  <IoTrashOutline size={10} />
                </button>
                <div className="w-[1px] h-2.5 bg-white/10" />
                <NodeSendButton 
                  id={id} 
                  data={data} 
                  outputHistory={outputHistory} 
                  currentHistoryIndex={currentHistoryIndex} 
                  currentOutputIndex={currentImageIndex}
                />
              </div>
              <button 
                type="button"
                suppressHydrationWarning={true}
                onClick={handleNext}
                disabled={currentHistoryIndex >= outputHistory.length - 1}
                className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-white/10 text-white/70 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Next"
              >
                <FaAngleRight size={10} />
              </button>
            </div>
          )}
          <NodeOptionsMenu 
            nodeId={id}
            onDuplicate={data.duplicateNode}
            onDelete={handleDeleteNode}
            downloadUrl={currentOutput}
            showThumbnailOption={true}
            onSetThumbnail={() => updateWorkflowThumbnail(currentOutput)}
          />
        </div>
      </div>
      {data.selectedModel?.id === "image-passthrough" ? (
        <div className="w-full h-full flex-1">
          <UploadNode id={id} data={data} formValues={formValues} setFormValues={setFormValues} selectedModel={selectedModel} loading={loading} uploadType="upload" acceptType="image" />
        </div>
      ) : (
        <div className={previewSectionClassName} style={outputSectionStyle}>
          {data.isLoading ? (
            <div className={previewLoadingClassName}>
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                <span className="text-[10px] font-bold text-emerald-500 tracking-wider uppercase">Generating...</span>
              </div>
            </div>
          ) : data.errorMsg ? (
            <div className={previewErrorClassName}>
              {data.errorMsg || "Generation failed"}
            </div>
          ) : currentOutput && !data.isLoading ? (
            <div className={previewContainerClassName} style={previewFrameStyle}>
              {currentOutputList.length > 1 && (
                <>
                  <button
                    type="button"
                    suppressHydrationWarning={true}
                    onClick={(e) => {
                      e.stopPropagation();
                      setCurrentImageIndex((prev) => (prev > 0 ? prev - 1 : currentOutputList.length - 1));
                    }}
                    className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/50 text-white opacity-0 group-hover/image:opacity-100 transition-opacity hover:bg-black/70"
                  >
                    <FaAngleLeft size={16} />
                  </button>
                  <button
                    type="button"
                    suppressHydrationWarning={true}
                    onClick={(e) => {
                      e.stopPropagation();
                      setCurrentImageIndex((prev) => (prev < currentOutputList.length - 1 ? prev + 1 : 0));
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/50 text-white opacity-0 group-hover/image:opacity-100 transition-opacity hover:bg-black/70"
                  >
                    <FaAngleRight size={16} />
                  </button>
                </>
              )}
              <div className={previewWrapperClassName}><img
                key={currentOutput}
                src={currentOutput}
                alt="Generated"
                className={previewImageClassName}
                style={previewImageStyleFinal}
              /></div>
              <div className={previewOverlayClassName}>
                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-white/50 uppercase tracking-tighter font-semibold">Dimensions</span>
                    <span className="text-xs text-white font-medium tabular-nums">
                      {imageMetadata.width} × {imageMetadata.height}
                    </span>
                  </div>
                  {imageMetadata.size && (
                    <div className="flex flex-col items-end gap-0.5">
                      <span className="text-[10px] text-white/50 uppercase tracking-tighter font-semibold">File Size</span>
                      <span className="text-xs text-white font-medium tabular-nums">{imageMetadata.size}</span>
                    </div>
                  )}
                </div>
              </div>
              {currentOutputList.length > 1 && (
                <div className={previewIndicatorsClassName}>
                  {currentOutputList.map((_, idx) => (
                    <div
                      key={idx}
                      className={`w-1.5 h-1.5 rounded-full transition-all ${
                        idx === currentImageIndex ? "bg-white scale-125" : "bg-white/40"
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className={outputEmptyClassName}>
              <IoImageOutline size={32} />
              <span className="text-[10px] italic">Result appeared here...</span>
            </div>
          )}
        </div>
      )}
      <Handle 
        type="target" 
        position={Position.Left} 
        id="imageInput" 
        style={{ 
          top: 100,
          opacity: hasPrompt ? 1 : 0,
          pointerEvents: hasPrompt ? 'auto' : 'none',
          width: 12,
          height: 12,
          transition: 'all 0.2s ease-in-out',
        }} 
        className={`
          !rounded-full !border-[3px] !left-[-8px] transition-all
          ${connectedInputs.imageInput 
            ? '!bg-blue-600 !border-zinc-900 shadow-[0_0_15px_rgba(37,99,235,0.8)]' 
            : '!bg-zinc-900 !border-blue-600/50 hover:!border-blue-600 shadow-sm'
          }
        `}
        data-type="blue"
      />
      {hasPrompt && (
        <p 
          className={`absolute -left-8 top-[100px] text-xs text-blue-500 transition-opacity duration-200 ${
            data.activeHandleColor === "blue"
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100"
          }`}
        > 
          Text 
        </p>
      )}
      
      {hasReferenceImages && referenceHandles.map((handle) => (
        <React.Fragment key={handle.id}>
          <Handle
            type="target"
            position={Position.Left}
            id={handle.id}
            style={{
              top: handle.top,
              opacity: 1,
              pointerEvents: 'auto',
              width: 12,
              height: 12,
              transition: 'all 0.2s ease-in-out',
            }}
            className={`!rounded-full !border-[3px] !left-[-8px] transition-all
              ${handle.connected
                ? '!bg-emerald-600 !border-zinc-900 shadow-[0_0_15px_rgba(16,185,129,0.8)]'
                : '!bg-zinc-900 !border-emerald-600/50 hover:!border-emerald-600 shadow-sm'
              }
            `}
            data-type="green"
          />
          <p
            className={`absolute -left-14 text-xs text-green-500 transition-opacity duration-200 ${
              data.activeHandleColor === "green"
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100"
            }`}
            style={{ top: `${handle.top}px` }}
          >
            {handle.label}
          </p>
        </React.Fragment>
      ))}
      {hasReferenceImages && (
        <div className={bottomSectionClassName} style={bottomSectionStyle}>
          <div className="px-2.5 pb-2 pt-1 bg-[#0c0d0f]/95 flex items-center justify-between gap-2 rounded-b-2xl border-t border-zinc-900/80">
            <button
              type="button"
              suppressHydrationWarning={true}
              onClick={(e) => {
                e.stopPropagation();
                setFormValues((prev) => ({
                  ...prev,
                  images_list: [...(Array.isArray(prev.images_list) ? prev.images_list : []), ""],
                }));
                setTimeout(() => updateNodeInternals(id), 0);
              }}
              className="min-w-0 flex-1 truncate text-left text-[10px] text-zinc-400 hover:text-white transition-colors"
            >
              + Add another image input
            </button>
            <button
              type="button"
              suppressHydrationWarning={true}
              onClick={(e) => {
                e.stopPropagation();
                handleRunSingleNode();
              }}
              className="shrink-0 px-2 py-1 rounded-md border border-white/10 bg-black/35 text-white text-[10px] font-medium hover:bg-white hover:text-black transition-colors whitespace-nowrap"
            >
              → Run Model
            </button>
          </div>
        </div>
      )}

      <Handle
        type="source" 
        position={Position.Right} 
        id="imageOutput" 
        style={{ 
          top: 100,
          width: 12,
          height: 12,
          transition: 'all 0.2s ease-in-out',
        }} 
        className={`!rounded-full !border-[3px] !right-[-8px] transition-all
          ${connectedOutputs.imageOutput 
            ? '!bg-emerald-600 !border-zinc-900 shadow-[0_0_15px_rgba(16,185,129,0.8)]' 
            : '!bg-zinc-900 !border-emerald-600/50 hover:!border-emerald-600 shadow-sm'
          }
        `}
        data-type="green"
      />
      <p 
        className={`absolute -right-10 top-[100px] text-xs text-green-500 transition-opacity duration-200 ${
          data.activeHandleColor === "green"
            ? "opacity-100" 
            : "opacity-0 group-hover:opacity-100"
        }`}
      > 
        Image 
      </p>
    </div>
  );
};

export default ImageGeneration;
