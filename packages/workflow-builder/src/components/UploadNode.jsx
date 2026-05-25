import React, { useState, useEffect, useRef } from "react";
import { toast } from "react-hot-toast";
import { FiUpload } from "react-icons/fi";
import axios from "axios";
import AudioPlayer from "./AudioPlayer";
import VideoPlayer from "./VideoPlayer";

const UploadNode = ({ id, data, formValues, setFormValues, selectedModel, loading, uploadType, acceptType }) => {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [imageMetadata, setImageMetadata] = useState({ width: 0, height: 0, size: null });
  const prevFormValues = useRef(formValues);
  const textareaRef = useRef(null);

  const inputKey = acceptType === "image" ? "image_url" : acceptType === "video" ? "video_url" : "audio_url";
  const currentValue = formValues?.[inputKey] || "";
  const fileInputAccept = acceptType === "image" ? "image/*" : acceptType === "video" ? "video/*" : "audio/*";

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleFileUpload(e);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleFileUpload = (e) => {
    let file = null;

    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      file = e.dataTransfer.files[0];
    } else if (e.target.files && e.target.files.length > 0) {
      file = e.target.files[0];
    } else {
      return;
    }

    const acceptedTypes = acceptType === "image"
      ? ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]
      : acceptType === "video"
        ? ["video/mp4", "video/webm"]
        : ["audio/mpeg", "audio/wav", "audio/webm"];

    if (!acceptedTypes.includes(file.type)) {
      toast.error(`Please upload a valid ${acceptType} file`);
      return;
    }

    const type = file.type.startsWith("video") ? "video_url" : file.type.startsWith("image") ? "image_url" : "audio_url";

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    axios.post("/api/app/upload-file", formData, {
      headers: { "Content-Type": "multipart/form-data" },
      onUploadProgress: (progressEvent) => {
        const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        setUploadProgress(percentCompleted);
      }
    })
    .then((response) => {
      setFormValues(prev => ({ ...prev, [type]: response.data.url }));
      setTimeout(() => {
        setUploading(false);
        setUploadProgress(0);
      }, 500);
    })
    .catch((error) => {
      console.error("Upload failed", error);
      toast.error("Upload failed.", error?.response?.data);
      setUploading(false);
      setUploadProgress(0);
    });
  };

  const handleTextChange = (e) => {
    setFormValues(prev => ({ ...prev, prompt: e.target.value }));
  };

  const handleUrlChange = (e) => {
    setFormValues(prev => ({ ...prev, [inputKey]: e.target.value }));
  };

  const removeData = () => {
    setFormValues(prev => ({ ...prev, [inputKey]: "" }));
  };

  useEffect(() => {
    let outputs = [{ type: "", value: null }];
    let resultUrl;

    if (acceptType === "image") {
      outputs = [{ type: "image_url", value: formValues.image_url || null }];
      resultUrl = formValues.image_url || null;
    } else if (acceptType === "video") {
      outputs = [{ type: "video_url", value: formValues.video_url || null }];
      resultUrl = formValues.video_url || null;
    } else if (acceptType === "audio") {
      outputs = [{ type: "audio_url", value: formValues.audio_url || null }];
      resultUrl = formValues.audio_url || null;
    } else {
      outputs = [{ type: "text", value: formValues.prompt || "" }];
      resultUrl = formValues.prompt || "";
    }

    const incoming = JSON.stringify(prevFormValues.current);
    const current = JSON.stringify(formValues);
    if (incoming === current) return;
    prevFormValues.current = formValues;

    if (data?.onDataChange) {
      data.onDataChange(id, {
        selectedModel,
        formValues,
        loading,
        outputs,
        resultUrl,
      });
    }
  }, [formValues, selectedModel, loading, id, data, acceptType]);

  useEffect(() => {
    if (acceptType !== "image") return;
    if (!currentValue) {
      setImageMetadata({ width: 0, height: 0, size: null });
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      setImageMetadata({ width: img.naturalWidth, height: img.naturalHeight, size: null });
    };
    img.onerror = () => {
      if (cancelled) return;
      setImageMetadata({ width: 0, height: 0, size: null });
    };
    img.src = currentValue;

    return () => {
      cancelled = true;
    };
  }, [acceptType, currentValue]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "0px";
      textarea.style.height = `${Math.max(textarea.scrollHeight, 240)}px`;
    }
  }, [formValues?.prompt]);

  const renderMediaPreview = () => {
    if (!currentValue) {
      return (
        <label
          style={{ minHeight: 160 }}
          className="cursor-pointer flex flex-col items-center justify-center gap-2 text-gray-400 border border-dashed border-gray-600 rounded-lg p-4 w-full flex-1 hover:bg-gray-700/50 h-full"
          htmlFor={`upload-${id}-${acceptType}`}
        >
          <FiUpload size={20} />
          <span className="text-xs capitalize">Upload {acceptType}</span>
          <span className="text-xs text-gray-500">Hint: drag file here or paste URL above.</span>
        </label>
      );
    }

    return (
      <div className="relative flex-1 w-full min-h-0 group">
        {acceptType === "video" ? (
          <VideoPlayer src={currentValue} accentColor="#f97316" />
        ) : acceptType === "image" ? (
          <div className="relative w-full h-full group/image">
            <img src={currentValue} alt="Uploaded" className="w-full h-full object-contain" />
            <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-0 group-hover/image:opacity-100 transition-opacity duration-300 pointer-events-none flex flex-col justify-end">
              <span className="text-xs text-white font-medium tabular-nums">{imageMetadata.width} × {imageMetadata.height}</span>
            </div>
          </div>
        ) : (
          <div className="w-full h-full relative group/audio flex flex-col items-center justify-center">
            <AudioPlayer
              nodeId={id}
              src={currentValue}
              className="flex flex-col items-center justify-center px-5 py-4 w-full h-full relative group transition-all duration-500 select-none bg-black/10 rounded-b-2xl"
            />
          </div>
        )}
      </div>
    );
  };

  const renderUploadBody = () => (
    <div className="flex flex-col gap-3 w-full h-full p-3" onDragOver={handleDragOver} onDrop={handleDrop}>
      <div className="flex items-center gap-2 nodrag nowheel">
        <input
          type="text"
          value={currentValue}
          onChange={handleUrlChange}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder={`Paste ${acceptType} URL`}
          className="bg-zinc-900/70 text-white text-xs py-2 px-3 rounded-lg border border-white/10 transition-all hover:border-white/20 w-full outline-none focus:border-blue-500/50"
        />
        <input
          type="file"
          accept={fileInputAccept}
          className="hidden"
          id={`upload-${id}-${acceptType}`}
          onChange={handleFileUpload}
        />
        <label
          htmlFor={`upload-${id}-${acceptType}`}
          className="flex items-center justify-center gap-1 bg-blue-500 text-white hover:bg-blue-600 text-xs font-medium cursor-pointer rounded-lg px-3 py-2 whitespace-nowrap"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {uploading ? `${uploadProgress}%` : <><FiUpload size={14} /> Upload</>}
        </label>
        {currentValue && (
          <button
            type="button"
            suppressHydrationWarning={true}
            className="text-zinc-400 hover:text-red-500 bg-zinc-900/70 border border-white/10 rounded-lg px-2 py-2 text-xs"
            onClick={removeData}
            onPointerDown={(e) => e.stopPropagation()}
          >
            ×
          </button>
        )}
      </div>
      {uploading && (
        <div className="w-full bg-gray-700/70 rounded h-1 overflow-hidden">
          <div className="bg-blue-500 h-full" style={{ width: `${uploadProgress}%` }}></div>
        </div>
      )}
      {renderMediaPreview()}
    </div>
  );

  return (
    <div className="flex flex-col w-full flex-1 overflow-hidden rounded-b-2xl h-full">
      <div className="flex flex-col items-center justify-center w-full h-full flex-1">
        {uploadType === "text" ? (
          <textarea
            ref={textareaRef}
            className="bg-transparent border border-gray-800 w-full h-full max-h-96 p-2 text-xs text-white resize-none overflow-y-auto custom-scrollbar nodrag nowheel"
            placeholder="Enter your text prompt here..."
            value={formValues?.prompt || ""}
            onChange={handleTextChange}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          />
        ) : uploadType === "upload" && renderUploadBody()}
      </div>
    </div>
  );
};

export default UploadNode;
