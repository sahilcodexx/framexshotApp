import type { AssetCategory } from "@/components/editor/AssetGrid";

/**
 * Asset Registry
 * 
 * Centralized lookup for bundled assets by ID.
 */

// Background images
import bgImage13 from "@/assets/bg-images/asset-13.jpg";
import bgImage18 from "@/assets/bg-images/asset-18.jpg";
import bgImage19 from "@/assets/bg-images/asset-19.jpg";
import bgImage24 from "@/assets/bg-images/asset-24.avif";
import bgImage25 from "@/assets/bg-images/asset-25.jpg";
import bgImage26 from "@/assets/bg-images/asset-26.jpeg";
import bgImage27 from "@/assets/bg-images/asset-27.jpeg";
import bgImage28 from "@/assets/bg-images/asset-28.jpeg";
import bgImage29 from "@/assets/bg-images/asset-29.jpeg";
import bgImage30 from "@/assets/bg-images/asset-30.jpeg";

// New background images from Downloads
import bgTahoeDark from "@/assets/bg-images/tahoe-dark.jpg";
import bgTahoeLight from "@/assets/bg-images/tahoe-light.jpg";
import bgAbstractPhoto from "@/assets/bg-images/abstract-photo.avif";

import macImage3 from "@/assets/mac/mac-asset-3.jpg";
import macImage5 from "@/assets/mac/mac-asset-5.jpg";
import macImage6 from "@/assets/mac/mac-asset-6.jpeg";
import macImage7 from "@/assets/mac/mac-asset-7.jpg";
import macImage8 from "@/assets/mac/mac-asset-8.jpg";
import macImage9 from "@/assets/mac/mac-asset-9.jpg";
import macImage10 from "@/assets/mac/mac-asset-10.jpg";

// Gradient images
import gradient1 from "@/assets/mesh/mesh1.webp";
import gradient2 from "@/assets/mesh/mesh2.webp";
import gradient3 from "@/assets/mesh/mesh3.webp";
import gradient4 from "@/assets/mesh/mesh4.webp";
import gradient5 from "@/assets/mesh/mesh5.webp";
import gradient6 from "@/assets/mesh/mesh6.webp";
import gradient7 from "@/assets/mesh/mesh7.webp";
import gradient8 from "@/assets/mesh/mesh8.webp";
import gradient9 from "@/assets/mesh/mesh9.webp";
import gradient10 from "@/assets/mesh/mesh10.webp";
import gradient11 from "@/assets/mesh/mesh11.webp";
import gradient12 from "@/assets/mesh/mesh12.webp";
import gradient13 from "@/assets/mesh/mesh13.webp";
import gradient14 from "@/assets/mesh/mesh14.webp";
import gradient15 from "@/assets/mesh/mesh15.webp";
import gradient16 from "@/assets/mesh/mesh16.webp";
import gradient17 from "@/assets/mesh/mesh17.webp";
import gradient18 from "@/assets/mesh/mesh18.jpg";
import gradient19 from "@/assets/mesh/mesh19.jpg";
import gradient20 from "@/assets/mesh/mesh20.jpg";
import gradient21 from "@/assets/mesh/mesh21.jpg";
import gradient22 from "@/assets/mesh/mesh22.jpg";
import gradient23 from "@/assets/mesh/mesh23.jpg";
import gradient24 from "@/assets/mesh/mesh24.jpg";
import gradient25 from "@/assets/mesh/mesh25.jpg";
import gradient26 from "@/assets/mesh/mesh26.png";
import gradient27 from "@/assets/mesh/mesh27.jpg";

/**
 * Map of asset IDs to their runtime-resolved paths
 */
export const assetRegistry: Record<string, string> = {
  // Background images
  "bg-13": bgImage13,
  "bg-18": bgImage18,
  "bg-19": bgImage19,
  "bg-24": bgImage24,
  "bg-25": bgImage25,
  "bg-26": bgImage26,
  "bg-27": bgImage27,
  "bg-28": bgImage28,
  "bg-29": bgImage29,
  "bg-30": bgImage30,
  "tahoe-dark": bgTahoeDark,
  "tahoe-light": bgTahoeLight,
  "abstract-photo": bgAbstractPhoto,
  
  // Mac assets
  "mac-3": macImage3,
  "mac-5": macImage5,
  "mac-6": macImage6,
  "mac-7": macImage7,
  "mac-8": macImage8,
  "mac-9": macImage9,
  "mac-10": macImage10,
  
  // Gradients
  "gradient-1": gradient1,
  "gradient-2": gradient2,
  "gradient-3": gradient3,
  "gradient-4": gradient4,
  "gradient-5": gradient5,
  "gradient-6": gradient6,
  "gradient-7": gradient7,
  "gradient-8": gradient8,
  "gradient-9": gradient9,
  "gradient-10": gradient10,
  "gradient-11": gradient11,
  "gradient-12": gradient12,
  "gradient-13": gradient13,
  "gradient-14": gradient14,
  "gradient-15": gradient15,
  "gradient-16": gradient16,
  "gradient-17": gradient17,
  "gradient-18": gradient18,
  "gradient-19": gradient19,
  "gradient-20": gradient20,
  "gradient-21": gradient21,
  "gradient-22": gradient22,
  "gradient-23": gradient23,
  "gradient-24": gradient24,
  "gradient-25": gradient25,
  "gradient-26": gradient26,
  "gradient-27": gradient27,
};

/** Default background asset ID */
export const DEFAULT_BACKGROUND_ID = "bg-18";

/** Get the runtime path for an asset by ID */
export function getAssetPath(assetId: string): string | null {
  return assetRegistry[assetId] ?? null;
}

/** Get the default background image path */
export function getDefaultBackgroundPath(): string {
  return assetRegistry[DEFAULT_BACKGROUND_ID];
}

/** Check if a string is an asset ID */
export function isAssetId(value: string): boolean {
  return value in assetRegistry;
}

/** Check if a string is a data URL */
export function isDataUrl(value: string): boolean {
  return value.startsWith("data:");
}

/** Resolve a stored background value to an actual path */
export function resolveBackgroundPath(storedValue: string | null): string {
  if (!storedValue) {
    return getDefaultBackgroundPath();
  }
  
  if (isAssetId(storedValue)) {
    return assetRegistry[storedValue];
  }
  
  if (isDataUrl(storedValue)) {
    return storedValue;
  }

  // Also check if path matches any registered asset path directly
  for (const [, assetPath] of Object.entries(assetRegistry)) {
    if (assetPath === storedValue) {
      return storedValue;
    }
  }

  return storedValue;
}

/** Find the asset ID for a given path */
export function getAssetIdFromPath(path: string): string | null {
  for (const [id, assetPath] of Object.entries(assetRegistry)) {
    if (assetPath === path) {
      return id;
    }
  }
  return null;
}

export function toStorableValue(path: string | null): string | null {
  if (!path) return null;
  if (isAssetId(path)) return path;
  const assetId = getAssetIdFromPath(path);
  if (assetId) return assetId;
  return path;
}

/** Migrate a legacy stored value to the new format */
export function migrateStoredValue(storedValue: string): string | null {
  if (isAssetId(storedValue)) return storedValue;
  if (isDataUrl(storedValue)) return storedValue;

  // Legacy bg paths like /src/assets/bg-images/asset-18.jpg
  const legacyBgMatch = storedValue.match(/asset-(\d+)/);
  if (legacyBgMatch) {
    const assetId = `bg-${legacyBgMatch[1]}`;
    if (isAssetId(assetId)) return assetId;
  }

  // Legacy mac paths like /src/assets/mac/mac-asset-5.jpg
  const macMatch = storedValue.match(/mac-asset-(\d+)/);
  if (macMatch) {
    const assetId = `mac-${macMatch[1]}`;
    if (isAssetId(assetId)) return assetId;
  }

  // Legacy mesh paths like /src/assets/mesh/mesh1.webp
  const meshMatch = storedValue.match(/mesh(\d+)/);
  if (meshMatch) {
    const assetId = `gradient-${meshMatch[1]}`;
    if (isAssetId(assetId)) return assetId;
  }

  console.warn(`Unable to migrate stored value: ${storedValue}`);
  return DEFAULT_BACKGROUND_ID;
}

export function getAssetCategories(): AssetCategory[] {
  return [
    {
      name: "Wallpapers",
      assets: [
        { id: "tahoe-dark", src: assetRegistry["tahoe-dark"], name: "Tahoe Dark" },
        { id: "tahoe-light", src: assetRegistry["tahoe-light"], name: "Tahoe Light" },
        { id: "abstract-photo", src: assetRegistry["abstract-photo"], name: "Abstract" },
        { id: "gradient-18", src: assetRegistry["gradient-18"], name: "Wallpaper 18" },
        { id: "gradient-19", src: assetRegistry["gradient-19"], name: "Wallpaper 19" },
        { id: "gradient-20", src: assetRegistry["gradient-20"], name: "Wallpaper 20" },
        { id: "gradient-21", src: assetRegistry["gradient-21"], name: "Wallpaper 21" },
        { id: "gradient-22", src: assetRegistry["gradient-22"], name: "Wallpaper 22" },
        { id: "gradient-23", src: assetRegistry["gradient-23"], name: "Wallpaper 23" },
        { id: "gradient-24", src: assetRegistry["gradient-24"], name: "Wallpaper 24" },
        { id: "gradient-25", src: assetRegistry["gradient-25"], name: "Wallpaper 25" },
        { id: "gradient-26", src: assetRegistry["gradient-26"], name: "Wallpaper 26" },
        { id: "gradient-27", src: assetRegistry["gradient-27"], name: "Wallpaper 27" },
        { id: "bg-13", src: assetRegistry["bg-13"], name: "Background 13" },
        { id: "bg-18", src: assetRegistry["bg-18"], name: "Background 18" },
        { id: "bg-19", src: assetRegistry["bg-19"], name: "Background 19" },
        { id: "bg-24", src: assetRegistry["bg-24"], name: "Background 24" },
        { id: "bg-25", src: assetRegistry["bg-25"], name: "Background 25" },
        { id: "bg-26", src: assetRegistry["bg-26"], name: "Background 26" },
        { id: "bg-27", src: assetRegistry["bg-27"], name: "Background 27" },
        { id: "bg-28", src: assetRegistry["bg-28"], name: "Background 28" },
        { id: "bg-29", src: assetRegistry["bg-29"], name: "Background 29" },
        { id: "bg-30", src: assetRegistry["bg-30"], name: "Background 30" },
      ],
    },
    {
      name: "Mac Assets",
      assets: [
        { id: "mac-3", src: assetRegistry["mac-3"], name: "Mac 3" },
        { id: "mac-5", src: assetRegistry["mac-5"], name: "Mac 5" },
        { id: "mac-6", src: assetRegistry["mac-6"], name: "Mac 6" },
        { id: "mac-7", src: assetRegistry["mac-7"], name: "Mac 7" },
        { id: "mac-8", src: assetRegistry["mac-8"], name: "Mac 8" },
        { id: "mac-9", src: assetRegistry["mac-9"], name: "Mac 9" },
        { id: "mac-10", src: assetRegistry["mac-10"], name: "Mac 10" },
      ],
    },
  ];
}
