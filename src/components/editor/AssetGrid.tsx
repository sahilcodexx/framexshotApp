import { useState, useEffect, useCallback, useRef, memo } from "react";
import { Store } from "@tauri-apps/plugin-store";
import { toast } from "sonner";
import { Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { getThumbnailUrl } from "@/lib/thumbnail-utils";
import { Button } from "@/components/ui/button";
import { Reveal, Skeleton } from "@/lib/motion";

/**
 * Emil's stagger rule: keep total stagger under ~300ms, so cap the delay at
 * 8 items. The 9th+ items reveal at the same time as the 8th.
 */
const STAGGER_STEP_MS = 32;
const STAGGER_CAP_INDEX = 8;

export interface Asset {
  id: string;
  src: string;
  name: string;
}

export interface AssetCategory {
  name: string;
  assets: Asset[];
}

interface AssetGridProps {
  categories: AssetCategory[];
  selectedImage: string | null;
  backgroundType: string;
  onImageSelect: (imageSrc: string) => void;
}

const ThumbnailButton = memo(function ThumbnailButton({
  asset,
  isSelected,
  onSelect,
  onRemove,
}: {
  asset: Asset;
  isSelected: boolean;
  onSelect: () => void;
  onRemove?: () => void;
}) {
  const [thumbSrc, setThumbSrc] = useState<string>(asset.src);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let isMounted = true;
    setLoaded(false);
    getThumbnailUrl(asset.src, 140).then((url) => {
      if (isMounted) setThumbSrc(url);
    });
    return () => {
      isMounted = false;
    };
  }, [asset.src]);

  return (
    <div className="relative group">
      <button
        type="button"
        onClick={onSelect}
        aria-label={`Select ${asset.name} background`}
        className={cn(
          "relative w-full aspect-square rounded-xl overflow-hidden transition-all duration-[var(--duration-quick)] transform-gpu active:scale-95",
          isSelected
            ? "ring-2 ring-accent ring-offset-2 ring-offset-card shadow-md scale-[1.02]"
            : "ring-1 ring-border/60 hover:ring-border hover:scale-[1.02]"
        )}
      >
        {/* Skeleton placeholder while the image is being decoded */}
        {!loaded && <Skeleton className="absolute inset-0 rounded-xl" />}
        <img
          src={thumbSrc}
          alt={asset.name}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          className={cn(
            "w-full h-full object-cover transition-all duration-[var(--duration-fast)] ease-[var(--ease-smooth-out)] group-hover:scale-105",
            loaded ? "opacity-100" : "opacity-0"
          )}
        />
        {isSelected && (
          <div className="absolute inset-0 bg-accent/20 flex items-center justify-center">
            <div className="size-5 rounded-full bg-accent flex items-center justify-center shadow-lg">
              <svg className="size-3 text-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>
        )}
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="absolute -top-1.5 -right-1.5 size-5 bg-red-500 text-foreground rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md z-10 hover:scale-110"
          aria-label="Remove uploaded image"
        >
          <X className="size-3 stroke-[3]" aria-hidden="true" />
        </button>
      )}
    </div>
  );
});

export const AssetGrid = memo(function AssetGrid({ categories, selectedImage, backgroundType, onImageSelect }: AssetGridProps) {
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load uploaded background images from store
  useEffect(() => {
    const loadUploaded = async () => {
      try {
        const store = await Store.load("settings.json");
        const uploaded = await store.get<string[]>("uploadedBackgroundImages");
        if (uploaded) {
          setUploadedImages(uploaded);
        }
      } catch (err) {
        console.error("Failed to load uploaded images in editor:", err);
      }
    };
    loadUploaded();
  }, []);

  const handleFileUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      if (!file.type.startsWith("image/")) {
        toast.error("Please select a valid image file");
        return;
      }

      const reader = new FileReader();
      reader.onloadend = async () => {
        const dataUrl = reader.result as string;
        const newUploaded = [...uploadedImages, dataUrl];
        setUploadedImages(newUploaded);

        // Apply background immediately to editor
        onImageSelect(dataUrl);

        try {
          const store = await Store.load("settings.json");
          await store.set("uploadedBackgroundImages", newUploaded);
          await store.save();
          toast.success("Custom background uploaded");
        } catch (err) {
          console.error("Failed to save uploaded image:", err);
          toast.error("Failed to save background upload");
        }
      };
      reader.onerror = () => {
        toast.error("Failed to read image file");
      };
      reader.readAsDataURL(file);

      event.target.value = "";
    },
    [uploadedImages, onImageSelect]
  );

  const handleRemoveUploaded = useCallback(
    async (index: number) => {
      const newUploaded = uploadedImages.filter((_, i) => i !== index);
      setUploadedImages(newUploaded);

      try {
        const store = await Store.load("settings.json");
        await store.set("uploadedBackgroundImages", newUploaded);
        await store.save();
        toast.success("Image removed");
      } catch (err) {
        console.error("Failed to remove image:", err);
      }
    },
    [uploadedImages]
  );

  return (
    <div className="space-y-5">
      {/* Top Header & Upload Button */}
      <div className="flex items-center justify-between pb-2 border-b border-border">
        <h3 className="text-xs font-semibold text-foreground tracking-tight">Wallpapers & Media</h3>
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
            className="rounded-full text-xs h-7 px-3 bg-secondary text-foreground hover:bg-secondary/80 font-medium"
          >
            <Upload className="size-3 mr-1.5" aria-hidden="true" />
            Upload
          </Button>
        </div>
      </div>

      {/* Uploaded Images Section */}
      {uploadedImages.length > 0 && (
        <div className="space-y-2">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            Uploaded Photos
          </span>
          <div className="grid grid-cols-4 gap-2">
            {uploadedImages.map((img, index) => (
              <Reveal
                key={`uploaded-${index}`}
                delay={Math.min(index, STAGGER_CAP_INDEX) * STAGGER_STEP_MS}
                duration={220}
              >
                <ThumbnailButton
                  asset={{ id: `uploaded-${index}`, src: img, name: `Custom ${index + 1}` }}
                  isSelected={backgroundType === "image" && selectedImage === img}
                  onSelect={() => onImageSelect(img)}
                  onRemove={() => handleRemoveUploaded(index)}
                />
              </Reveal>
            ))}
          </div>
        </div>
      )}

      {/* Bundled Asset Categories */}
      {categories.map((category) => (
        <div key={category.name} className="space-y-2">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            {category.name}
          </span>
          <div className="grid grid-cols-4 gap-2">
            {category.assets.map((asset, index) => (
              <Reveal
                key={asset.id}
                delay={Math.min(index, STAGGER_CAP_INDEX) * STAGGER_STEP_MS}
                duration={220}
              >
                <ThumbnailButton
                  asset={asset}
                  isSelected={backgroundType === "image" && selectedImage === asset.src}
                  onSelect={() => onImageSelect(asset.src)}
                />
              </Reveal>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
});
