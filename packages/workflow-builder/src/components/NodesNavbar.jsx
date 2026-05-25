import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AiOutlineAudio, AiOutlineSearch } from "react-icons/ai";
import { FaAngleRight } from "react-icons/fa6";
import { IoImageOutline } from "react-icons/io5";
import { TfiText } from "react-icons/tfi";
import { TbArrowMerge } from "react-icons/tb";
import { LuUpload } from "react-icons/lu";
import { concatModels } from "./utility";

const formatName = (id) => id.replace(/-/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const SPECIAL_MODEL_NAMES = {
  "text-passthrough": "Input Text",
  "image-passthrough": "Input Image",
  "audio-passthrough": "Input Audio",
};

const NodesNavbar = ({ addNode, filterNodeTypes = null, nodeSchemas = {} }) => {
  const [activeSubMenu, setActiveSubMenu] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const menuRef = useRef(null);
  const anchorRef = useRef(null);
  const [menuStyle, setMenuStyle] = useState({ opacity: 0 });

  const getUtilityNodeType = (model) => {
    if (model?.id === "array-separator") return "arraySeparatorNode";
    if (model?.id === "list") return "listNode";
    return "concatNode";
  };

  const getNodeTypeFromSubmenuId = (id) => {
    if (id === 'inputs') return ['textNode', 'imageNode', 'audioNode'];
    if (id === 'text-llms') return 'textNode';
    if (id === 'utilities') return ['concatNode', 'arraySeparatorNode', 'listNode'];
    if (id === 'generate-image') return 'imageNode';
    if (id === 'generate-audio') return 'audioNode';
    return null;
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setActiveSubMenu(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const getCategorizedModels = () => {
    const categories = nodeSchemas?.categories || {};
    const mapModels = (modelsMap) =>
      modelsMap ? Object.entries(modelsMap).map(([id, model]) => ({
        ...model,
        id,
        name: SPECIAL_MODEL_NAMES[id] || model.name || formatName(id)
      })) : [];

    const imageModels = mapModels(categories.image?.models);
    const textModels = mapModels(categories.text?.models);
    const audioModels = mapModels(categories.audio?.models);
    const rawUtilityModels = mapModels(categories.utility?.models);
    const utilityModels = [...rawUtilityModels];

    concatModels.forEach(m => {
      if (!utilityModels.find(um => um.id === m.id)) utilityModels.push(m);
    });

    const isPassthrough = (m) => m?.id && m.id.includes("passthrough");

    return {
      inputs: [
        ...textModels.filter(isPassthrough).map(m => ({ ...m, type: 'textNode' })),
        ...imageModels.filter(isPassthrough).map(m => ({ ...m, type: 'imageNode' })),
        ...audioModels.filter(isPassthrough).map(m => ({ ...m, type: 'audioNode' })),
      ],
      generateImage: imageModels.filter(m => m?.id && !isPassthrough(m)),
      text: textModels.filter(m => !isPassthrough(m)),
      audio: audioModels.filter(m => !isPassthrough(m)),
      utilities: utilityModels,
    };
  };

  const categorizedModels = getCategorizedModels();
  const hasSearch = searchQuery.trim().length > 0;

  const handleAddNode = (type, model) => {
    addNode(type, null, { selectedModel: model });
    setActiveSubMenu(null);
    setSearchQuery("");
  };

  const menuStructure = [
    {
      label: "Inputs",
      items: [{ label: "Input Models", icon: <LuUpload />, hasSubmenu: true, id: "inputs" }]
    },
    {
      label: "Text",
      items: [
        { label: "Speech to Text", icon: <TfiText />, hasSubmenu: true, id: "text-llms" },
        { label: "Utilities", icon: <TbArrowMerge className="rotate-90" />, hasSubmenu: true, id: "utilities" },
      ]
    },
    {
      label: "Image",
      items: [{ label: "Generate Image", icon: <IoImageOutline />, hasSubmenu: true, id: "generate-image" }]
    },
    {
      label: "Audio",
      items: [{ label: "Text to Speech", icon: <AiOutlineAudio />, hasSubmenu: true, id: "generate-audio" }]
    }
  ];

  const getSubmenuItems = (id) => {
    switch (id) {
      case "inputs": return categorizedModels.inputs.map(m => ({ label: m.name, model: m, type: m.type }));
      case "utilities": return categorizedModels.utilities.map(m => ({ label: m.name, model: m, type: getUtilityNodeType(m) }));
      case "generate-image": return categorizedModels.generateImage.map(m => ({ label: m.name, model: m, type: "imageNode" }));
      case "text-llms": return categorizedModels.text.map(m => ({ label: m.name, model: m, type: "textNode" }));
      case "generate-audio": return categorizedModels.audio.map(m => ({ label: m.name, model: m, type: "audioNode" }));
      default: return [];
    }
  };

  const renderSearchResults = () => {
    const allModels = [
      ...categorizedModels.inputs.map(m => ({ ...m, type: m.type })),
      ...categorizedModels.generateImage.map(m => ({ ...m, type: "imageNode" })),
      ...categorizedModels.text.map(m => ({ ...m, type: "textNode" })),
      ...categorizedModels.audio.map(m => ({ ...m, type: "audioNode" })),
      ...categorizedModels.utilities.map(m => ({ ...m, type: getUtilityNodeType(m) })),
    ];
    const filtered = allModels.filter(m => m?.name?.toLowerCase().includes(searchQuery.toLowerCase()));

    return (
      <div className="flex flex-col gap-1 w-full max-h-96 overflow-y-auto">
        {filtered.length > 0 ? filtered.map((item, idx) => (
          <button
            type="button"
            suppressHydrationWarning={true}
            key={idx}
            className="flex items-center gap-2 px-3 py-2 text-xs text-white hover:bg-[#2c3037] rounded cursor-pointer transition text-left"
            onClick={() => handleAddNode(item.type, item)}
          >
            {item.type === "imageNode" && <IoImageOutline />}
            {item.type === "textNode" && <TfiText />}
            {item.type === "audioNode" && <AiOutlineAudio />}
            {(["concatNode", "arraySeparatorNode", "listNode"].includes(item.type)) && <TbArrowMerge className="rotate-90" />}
            <span>{item.name}</span>
          </button>
        )) : (
          <div className="px-3 py-2 text-xs text-gray-500">No results found</div>
        )}
      </div>
    );
  };

  useLayoutEffect(() => {
    if (anchorRef.current && menuRef.current) {
      const anchorRect = anchorRef.current.getBoundingClientRect();
      const menuRect = menuRef.current.getBoundingClientRect();
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;
      const padding = 12;
      let left = anchorRect.left;
      let top = anchorRect.top;
      let maxHeight = "";

      if (left + menuRect.width > windowWidth - padding) left = windowWidth - menuRect.width - padding;
      if (left < padding) left = padding;
      if (top + menuRect.height > windowHeight - padding) top = top - ((top + menuRect.height) - (windowHeight - padding));
      if (top < padding) {
        top = padding;
        maxHeight = `${windowHeight - (padding * 2)}px`;
      }

      setMenuStyle({ position: 'fixed', left: `${left}px`, top: `${top}px`, maxHeight, opacity: 1 });
    }
  }, [searchQuery]);

  const filteredMenuStructure = filterNodeTypes
    ? menuStructure.map(section => ({
        ...section,
        items: section.items.filter(item => {
          const nodeType = getNodeTypeFromSubmenuId(item.id);
          if (Array.isArray(nodeType)) return nodeType.some(type => filterNodeTypes.includes(type));
          return filterNodeTypes.includes(nodeType);
        })
      })).filter(section => section.items.length > 0)
    : menuStructure;

  return (
    <div ref={anchorRef} className="flex flex-col gap-2 relative z-50">
      <div
        ref={menuRef}
        className="flex flex-col gap-2 bg-[#151618] border border-gray-700 p-2 rounded-xl w-60 shadow-xl"
        style={menuStyle}
      >
        <div className="flex items-center relative w-full pl-2 bg-[#1c1e21] border border-gray-600 rounded-lg shrink-0">
          <AiOutlineSearch className="text-gray-400" />
          <input
            type="search"
            placeholder="Search nodes or models"
            className="w-full h-full py-2 px-1 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 bg-transparent"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {!hasSearch ? (
          <div className="flex flex-col gap-3 overflow-y-auto custom-scrollbar min-h-0">
            {filteredMenuStructure.map((section, idx) => (
              <div key={idx} className="flex flex-col gap-1">
                <h3 className="text-[10px] text-gray-500 text-left px-2 font-medium sticky top-0 bg-[#151618] z-10">{section.label}</h3>
                <div className="flex flex-col gap-0.5">
                  {section.items.map((item, i) => (
                    <div
                      key={i}
                      className={`flex items-center justify-between px-2 py-2 rounded-lg cursor-pointer group transition-colors relative ${activeSubMenu === item.id ? "bg-[#2c3037] text-white" : "text-gray-300 hover:bg-[#212326] hover:text-white"}`}
                      onMouseEnter={() => item.hasSubmenu ? setActiveSubMenu(item.id) : setActiveSubMenu(null)}
                      onClick={() => item.hasSubmenu ? setActiveSubMenu(item.id) : item.action?.()}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-gray-400 group-hover:text-white">{item.icon}</span>
                        <span className="text-xs font-medium">{item.label}</span>
                      </div>
                      {item.hasSubmenu && <FaAngleRight size={10} className="text-gray-500" />}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : renderSearchResults()}
        {activeSubMenu && !hasSearch && (
          <Submenu
            activeSubMenu={activeSubMenu}
            getSubmenuItems={getSubmenuItems}
            handleAddNode={handleAddNode}
            parentRef={menuRef}
            onBack={() => setActiveSubMenu(null)}
          />
        )}
      </div>
    </div>
  );
};

const Submenu = ({ activeSubMenu, getSubmenuItems, handleAddNode, parentRef, onBack }) => {
  const [position, setPosition] = useState({ side: "right", top: 0 });
  const submenuRef = useRef(null);

  useLayoutEffect(() => {
    if (parentRef.current && submenuRef.current) {
      const parentRect = parentRef.current.getBoundingClientRect();
      const submenuRect = submenuRef.current.getBoundingClientRect();
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;
      let side = "right";
      if (windowWidth < 640) side = "overlay";
      else if (windowWidth - parentRect.right < 260) side = "left";
      let top = 0;
      if (side !== "overlay") {
        const projectedBottom = parentRect.top + submenuRect.height;
        if (projectedBottom > windowHeight) top = -(projectedBottom - windowHeight) - 10;
      }
      setPosition({ side, top });
    }
  }, [activeSubMenu, parentRef]);

  const getOverlayClass = () => {
    if (position.side === "overlay") return "left-0 top-0 h-full w-full";
    if (position.side === "right") return "left-full ml-2";
    return "right-full mr-2";
  };

  const getIcon = (type) => {
    if (type === "imageNode") return <IoImageOutline />;
    if (type === "audioNode") return <AiOutlineAudio />;
    if (type === "concatNode") return <TbArrowMerge className="rotate-90" />;
    return <TfiText />;
  };

  const items = getSubmenuItems(activeSubMenu);

  return (
    <div
      ref={submenuRef}
      className={`absolute ${getOverlayClass()} bg-[#151618] border border-gray-700 rounded-xl shadow-2xl w-64 max-h-96 overflow-y-auto custom-scrollbar p-2 z-50`}
      style={{ top: position.side === "overlay" ? 0 : position.top }}
      onMouseLeave={() => position.side !== "overlay" && onBack?.()}
    >
      <div className="sm:hidden flex items-center gap-2 px-2 py-2 text-gray-300 cursor-pointer" onClick={onBack}>
        <span>Back</span>
      </div>
      {items.length > 0 ? items.map((item, idx) => (
        <button
          type="button"
          suppressHydrationWarning={true}
          key={idx}
          onClick={() => handleAddNode(item.type, item.model)}
          className="w-full flex items-center gap-3 px-3 py-2 text-xs text-gray-300 hover:text-white hover:bg-[#2c3037] rounded-lg transition-colors text-left"
        >
          <span className="text-gray-400">{getIcon(item.type)}</span>
          <span className="truncate">{item.label}</span>
        </button>
      )) : (
        <div className="px-3 py-2 text-xs text-gray-500">No models available</div>
      )}
    </div>
  );
};

export default NodesNavbar;
