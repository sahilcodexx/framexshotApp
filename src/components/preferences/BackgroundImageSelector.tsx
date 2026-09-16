import { useState, useCallback, useEffect, useRef, memo } from "react";
import { Store } from "@tauri-apps/plugin-store";
import { toast } from "sonner";
import { Upload, X, Check } from "lucide-react";
import { gradientOptions } from "@/components/editor/BackgroundSelector";
import { Button } from "@/components/ui/button";
import { getAssetCategories, getAssetIdFromPath, getAssetPath, isDataUrl, toStorableValue } from "@/lib/asset-registry";
import { getThumbnailUrl } from "@/lib/thumbnail-utils";
import { cn } from "@/lib/utils";

const assetCategories = getAssetCategories();

type BackgroundType = "transparent" | "white" | "black" | "gray" | "custom" | "image" | "gradient";

interface BackgroundImageSelectorProps {
  onImageSelect: (imageSrc: string) => void;
}

const WidescreenThumbnailItem = memo(function WidescreenThumbnailItem({
  src,
  title,
  isSelected,
  onSelect,
}: {
  src: string;
  title: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const [thumbSrc, setThumbSrc] = useState<string>(src);

  useEffect(() => {
    let isMounted = true;
    getThumbnailUrl(src, 220).then((url) => {
      if (isMounted) setThumbSrc(url);
    });
    return () => {
      isMounted = false;
    };
  }, [src]);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`Select ${title} background`}
      className={cn(
        "group relative w-full aspect-[16/10] rounded-xl overflow-hidden border transition-all duration-[var(--duration-fast)] transform-gpu active:scale-95 text-left",
        isSelected
          ? "border-accent ring-2 ring-accent/60 shadow-lg scale-[1.02]"
          : "border-border/60 hover:border-border hover:scale-[1.02]"
      )}
    >
      <img
        src={thumbSrc}
        alt={title}
        loading="lazy"
        decoding="async"
        className="w-full h-full object-cover transition-transform duration-[var(--duration-medium)] group-hover:scale-105"
      />

      {/* Subtle overlay gradient on hover */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2.5">
        <span className="text-[11px] font-medium text-white tracking-wide truncate">{title}</span>
      </div>

      {isSelected && (
        <div className="absolute inset-0 bg-accent/20 flex items-center justify-center backdrop-blur-[1px]">
          <div className="size-7 rounded-full bg-accent flex items-center justify-center shadow-lg border border-white/20">
            <Check className="size-4 text-white stroke-[3]" aria-hidden="true" />
          </div>
        </div>
      )}
    </button>
  );
});

export function BackgroundImageSelector({ onImageSelect }: BackgroundImageSelectorProps) {
  const [backgroundType, setBackgroundType] = useState<BackgroundType>("image");
  const [customColor, setCustomColor] = useState("#667eea");
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string>("gradients");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const solidColors: { type: BackgroundType; label: string; color: string }[] = [
    { type: "white", label: "Pure White", color: "#ffffff" },
    { type: "black", label: "Deep Black", color: "#000000" },
    { type: "gray", label: "Neutral Gray", color: "#f5f5f5" },
  ];

  const isSelected = useCallback(
    (assetSrc: string): boolean => {
      if (!selectedImage) return false;
      if (isDataUrl(assetSrc)) {
        return selectedImage === assetSrc;
      }
      const assetId = getAssetIdFromPath(assetSrc);
      return assetId === selectedImage;
    },
    [selectedImage]
  );

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const store = await Store.load("settings.json");
        const storedBgType = await store.get<BackgroundType>("defaultBackgroundType");
        const storedCustomColor = await store.get<string>("defaultCustomColor");
        const storedBg = await store.get<string>("defaultBackgroundImage");
        const uploaded = await store.get<string[]>("uploadedBackgroundImages");

        if (storedBgType) setBackgroundType(storedBgType);
        if (storedCustomColor) setCustomColor(storedCustomColor);
        if (storedBg) setSelectedImage(storedBg);
        if (uploaded) setUploadedImages(uploaded);
      } catch (err) {
        console.error("Failed to load background settings:", err);
      }
    };
    loadSettings();
  }, []);

  const handleImageSelect = useCallback(
    async (imageSrc: string) => {
      const storableValue = toStorableValue(imageSrc);
      if (!storableValue) {
        console.error("Cannot store this image path:", imageSrc);
        toast.error("Failed to save background selection");
        return;
      }

      setBackgroundType("image");
      setSelectedImage(storableValue);
      onImageSelect(imageSrc);

      try {
        const store = await Store.load("settings.json");
        await store.set("defaultBackgroundType", "image");
        await store.set("defaultBackgroundImage", storableValue);
        await store.save();
        toast.success("Default background updated");
      } catch (err) {
        console.error("Failed to save default background:", err);
        toast.error("Failed to save default background");
      }
    },
    [onImageSelect]
  );

  const handleSolidColorSelect = useCallback(async (type: BackgroundType) => {
    setBackgroundType(type);
    setSelectedImage(null);

    try {
      const store = await Store.load("settings.json");
      await store.set("defaultBackgroundType", type);
      if (type === "image") {
        await store.set("defaultBackgroundImage", null);
      }
      await store.save();
      toast.success("Default background updated");
    } catch (err) {
      console.error("Failed to save default background:", err);
      toast.error("Failed to save default background");
    }
  }, []);

  const handleCustomColorChange = useCallback(async (color: string) => {
    setCustomColor(color);
    setBackgroundType("custom");
    setSelectedImage(null);

    try {
      const store = await Store.load("settings.json");
      await store.set("defaultBackgroundType", "custom");
      await store.set("defaultCustomColor", color);
      await store.set("defaultBackgroundImage", null);
      await store.save();
      toast.success("Default background updated");
    } catch (err) {
      console.error("Failed to save default background:", err);
      toast.error("Failed to save default background");
    }
  }, []);

  const handleFileUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      if (!file.type.startsWith("image/")) {
        toast.error("Please select an image file");
        return;
      }

      const reader = new FileReader();
      reader.onloadend = async () => {
        const dataUrl = reader.result as string;
        const newUploadedImages = [...uploadedImages, dataUrl];
        setUploadedImages(newUploadedImages);
        setActiveTab("uploads");

        // Auto select newly uploaded image
        await handleImageSelect(dataUrl);

        try {
          const store = await Store.load("settings.json");
          await store.set("uploadedBackgroundImages", newUploadedImages);
          await store.save();
          toast.success("Image uploaded & set as default background");
        } catch (err) {
          console.error("Failed to save uploaded image:", err);
          toast.error("Failed to save uploaded image");
        }
      };
      reader.onerror = () => {
        toast.error("Failed to read image file");
      };
      reader.readAsDataURL(file);

      event.target.value = "";
    },
    [uploadedImages]
  );

  const handleRemoveUploaded = useCallback(
    async (index: number) => {
      const newUploadedImages = uploadedImages.filter((_, i) => i !== index);
      setUploadedImages(newUploadedImages);

      if (selectedImage === uploadedImages[index]) {
        setSelectedImage(null);
      }

      try {
        const store = await Store.load("settings.json");
        await store.set("uploadedBackgroundImages", newUploadedImages);
        await store.save();
        toast.success("Image removed");
      } catch (err) {
        console.error("Failed to remove image:", err);
        toast.error("Failed to remove image");
      }
    },
    [uploadedImages, selectedImage]
  );

  const tabs = [
    { id: "gradients", label: "Gradients" },
    { id: "wallpapers", label: "Wallpapers" },
    { id: "mac", label: "Mac Assets" },
    { id: "solid", label: "Solid & Custom" },
    { id: "uploads", label: `Uploads (${uploadedImages.length})` },
  ];

  return (
    <div className="space-y-6">
      {/* Category Tabs & Upload Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border/50">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "px-3.5 py-1.5 rounded-full text-xs font-medium transition-all duration-[var(--duration-quick)] whitespace-nowrap",
                activeTab === tab.id
                  ? "bg-accent text-white shadow-sm font-semibold"
                  : "bg-secondary text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileUpload}
            className="hidden"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-full text-xs px-3.5 h-8 font-medium bg-secondary border border-border hover:bg-muted"
          >
            <Upload className="size-3 mr-1.5" aria-hidden="true" />
            Upload Photo
          </Button>
        </div>
      </div>

      {/* Grid Content Container */}
      <div className="[contain:content] [will-change:transform]">
        {/* Gradients Tab */}
        {activeTab === "gradients" && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5">
            {gradientOptions.map((gradient) => {
              const gradientId = gradient.id.replace("mesh-", "gradient-");
              const isGradientSelected = selectedImage === gradientId;
              return (
                <WidescreenThumbnailItem
                  key={gradient.id}
                  src={gradient.src}
                  title={gradient.name}
                  isSelected={backgroundType === "gradient" && isGradientSelected}
                  onSelect={async () => {
                    const assetPath = getAssetPath(gradientId) ?? gradient.src;
                    setBackgroundType("gradient");
                    setSelectedImage(gradientId);
                    onImageSelect(assetPath);

                    try {
                      const store = await Store.load("settings.json");
                      await store.set("defaultBackgroundType", "gradient");
                      await store.set("defaultBackgroundImage", gradientId);
                      await store.save();
                      toast.success("Default background updated");
                    } catch (err) {
                      console.error("Failed to save default background:", err);
                      toast.error("Failed to save default background");
                    }
                  }}
                />
              );
            })}
          </div>
        )}

        {/* Wallpapers Tab */}
        {activeTab === "wallpapers" && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5">
            {assetCategories
              .filter((cat) => !cat.name.toLowerCase().includes("mac"))
              .flatMap((cat) => cat.assets)
              .map((asset) => (
                <WidescreenThumbnailItem
                  key={asset.id}
                  src={asset.src}
                  title={asset.name}
                  isSelected={backgroundType === "image" && isSelected(asset.src)}
                  onSelect={() => handleImageSelect(asset.src)}
                />
              ))}
          </div>
        )}

        {/* Mac Assets Tab */}
        {activeTab === "mac" && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5">
            {assetCategories
              .filter((cat) => cat.name.toLowerCase().includes("mac"))
              .flatMap((cat) => cat.assets)
              .map((asset) => (
                <WidescreenThumbnailItem
                  key={asset.id}
                  src={asset.src}
                  title={asset.name}
                  isSelected={backgroundType === "image" && isSelected(asset.src)}
                  onSelect={() => handleImageSelect(asset.src)}
                />
              ))}
          </div>
        )}

        {/* Solid & Custom Tab */}
        {activeTab === "solid" && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5">
              {solidColors.map(({ type, label, color }) => (
                <button
                  key={type}
                  onClick={() => handleSolidColorSelect(type)}
                  aria-label={`Select ${label} background`}
                  className={cn(
                    "group relative w-full aspect-[16/10] rounded-xl overflow-hidden border p-3 flex flex-col justify-between transition-all duration-[var(--duration-fast)] text-left transform-gpu active:scale-95",
                    backgroundType === type
                      ? "border-accent ring-2 ring-accent/60 shadow-md scale-[1.02]"
                      : "border-border/60 hover:border-border hover:scale-[1.02]"
                  )}
                  style={{ backgroundColor: color }}
                >
                  <span className={cn("text-xs font-medium", type === "white" ? "text-black" : "text-white")}>
                    {label}
                  </span>
                  {backgroundType === type && (
                    <div className="self-end size-6 rounded-full bg-accent flex items-center justify-center shadow-md">
                      <Check className="size-3.5 text-white stroke-[3]" aria-hidden="true" />
                    </div>
                  )}
                </button>
              ))}

              {/* Transparent Option */}
              <button
                onClick={() => handleSolidColorSelect("transparent")}
                aria-label="Select transparent background"
                className={cn(
                  "group relative w-full aspect-[16/10] rounded-xl overflow-hidden border p-3 flex flex-col justify-between transition-all duration-[var(--duration-fast)] text-left bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImNoZWNrZXJib2FyZCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBwYXR0ZXJuVW5pdHM9InVzZXJTcGFjZU9uVXNlIj48cmVjdCB3aWR0aD0iNSIgaGVpZ2h0PSI1IiBmaWxsPSIjZmZmIi8+PHJlY3QgeD0iNSIgd2lkdGg9IjUiIGhlaWdodD0iNSIgZmlsbD0iI2UwZTBlMCIvPjxyZWN0IHk9IjUiIHdpZHRoPSI1IiBoZWlnaHQ9IjUiIGZpbGw9IiNlMGUwZTAiLz48cmVjdCB4PSI1IiB5PSI1IiB3aWR0aD0iNSIgaGVpZ2h0PSI1IiBmaWxsPSIjZmZmIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIGZpbGw9InVybCgjY2hlY2tlcmJvYXJkKSIvPjwvc3ZnPg==')] transform-gpu active:scale-95",
                  backgroundType === "transparent"
                    ? "border-accent ring-2 ring-accent/60 shadow-md scale-[1.02]"
                    : "border-border/60 hover:border-border hover:scale-[1.02]"
                )}
              >
                <span className="text-xs font-semibold text-neutral-800 bg-white/80 px-2 py-0.5 rounded-md w-fit backdrop-blur-sm">
                  Transparent
                </span>
                {backgroundType === "transparent" && (
                  <div className="self-end size-6 rounded-full bg-accent flex items-center justify-center shadow-md">
                    <Check className="size-3.5 text-white stroke-[3]" aria-hidden="true" />
                  </div>
                )}
              </button>

              {/* Custom Hex Color Picker Card */}
              <div
                className={cn(
                  "relative w-full aspect-[16/10] rounded-xl overflow-hidden border p-3 flex flex-col justify-between transition-all duration-[var(--duration-fast)] text-left transform-gpu active:scale-95 cursor-pointer",
                  backgroundType === "custom"
                    ? "border-accent ring-2 ring-accent/60 shadow-md scale-[1.02]"
                    : "border-border/60 hover:border-border hover:scale-[1.02]"
                )}
                style={{ backgroundColor: customColor }}
              >
                <span className="text-xs font-semibold text-white bg-black/40 px-2 py-0.5 rounded-md w-fit backdrop-blur-sm">
                  Custom {customColor}
                </span>
                <input
                  type="color"
                  value={customColor}
                  onChange={(e) => handleCustomColorChange(e.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                />
                {backgroundType === "custom" && (
                  <div className="self-end size-6 rounded-full bg-accent flex items-center justify-center shadow-md">
                    <Check className="size-3.5 text-white stroke-[3]" aria-hidden="true" />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Uploaded Images Tab */}
        {activeTab === "uploads" && (
          <div>
            {uploadedImages.length === 0 ? (
              <div className="py-12 text-center border-2 border-dashed border-border/60 rounded-xl space-y-3">
                <Upload className="size-8 text-muted-foreground mx-auto" />
                <div>
                  <p className="text-xs font-medium text-foreground">No custom backgrounds uploaded yet</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Click "Upload Photo" above to add your custom wallpaper images
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5">
                {uploadedImages.map((img, index) => (
                  <div key={index} className="relative group">
                    <WidescreenThumbnailItem
                      src={img}
                      title={`Upload ${index + 1}`}
                      isSelected={backgroundType === "image" && isSelected(img)}
                      onSelect={() => handleImageSelect(img)}
                    />
                    <button
                      onClick={() => handleRemoveUploaded(index)}
                      className="absolute -top-1.5 -right-1.5 size-6 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md z-10 hover:scale-110"
                      aria-label="Remove image"
                    >
                      <X className="size-3.5 stroke-[3]" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
