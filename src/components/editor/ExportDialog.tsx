import { estimateExportSeconds, formatExportTime } from "@/lib/export-timing";
import { useEffect, useState } from "react";
import { Check, ChevronDown, Download, ImageIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Slider } from "@/components/ui/slider";
import { EXPORT_SCALES, MAX_EXPORT_PIXELS, type ExportStage, type ExportPrefs, type SaveFormat } from "@/lib/export-settings";

const FORMATS: { value: SaveFormat; label: string; description: string }[] = [
  { value: "png", label: "PNG", description: "Lossless · supports transparency" },
  { value: "jpeg", label: "JPG", description: "Small files · great for sharing" },
  { value: "webp", label: "WebP", description: "Compact · supports transparency" },
  { value: "avif", label: "AVIF", description: "Smallest files · slower to encode" },
];

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefs: ExportPrefs;
  onPrefsChange: (prefs: ExportPrefs) => void;
  frameSize: { width: number; height: number } | null;
  previewUrl: string | null;
  isSaving: boolean;
  stage?: ExportStage;
  estimate?: { seconds: number; updatedAt: number } | null;
  error?: string | null;
  onExport: () => void;
}

export function ExportDialog({ open, onOpenChange, prefs, onPrefsChange, frameSize, previewUrl, isSaving, stage = "rendering", estimate, error, onExport }: ExportDialogProps) {
  const format = FORMATS.find((item) => item.value === prefs.format)!;
  const dimensions = frameSize ? `${Math.round(frameSize.width * prefs.scale).toLocaleString()} × ${Math.round(frameSize.height * prefs.scale).toLocaleString()} px` : "Original dimensions";

  const tooLarge = !!frameSize && Math.round(frameSize.width * prefs.scale) * Math.round(frameSize.height * prefs.scale) > MAX_EXPORT_PIXELS;

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!isSaving) onOpenChange(value); }}>
      <DialogContent className="max-w-[420px] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl bg-card p-6 text-foreground shadow-xl gap-5">
        <DialogHeader className="text-left space-y-2">
          <DialogTitle className="text-xl font-semibold tracking-tight">Export screenshot</DialogTitle>
          <DialogDescription className="text-xs">Ready to share. Choose your size and format.</DialogDescription>
        </DialogHeader>

        {previewUrl && <div className="flex h-28 items-center justify-center overflow-hidden rounded-xl border border-border bg-background p-3">
          <img src={previewUrl} alt="Screenshot to export" className="max-h-full max-w-full rounded-md object-contain" />
        </div>}

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs"><span className="font-medium">Output size</span><span className="text-muted-foreground tabular-nums">{dimensions}</span></div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" disabled={isSaving} aria-label="Export size" className="h-12 w-full justify-between rounded-xl border border-border px-3.5 font-medium">
                  <span>{prefs.scale}× <span className="ml-2 font-normal text-muted-foreground">{prefs.scale === 1 ? "Original" : prefs.scale < 1 ? "Reduced" : "Upscaled"}</span></span>
                  <ChevronDown className="size-4 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" sideOffset={6} className="z-[100] w-[var(--radix-dropdown-menu-trigger-width)] rounded-xl p-1.5">
                {EXPORT_SCALES.map((scale) => <DropdownMenuItem key={scale} onSelect={() => onPrefsChange({ ...prefs, scale })} className="cursor-pointer rounded-lg px-3 py-2.5">
                  <span className="w-10 font-medium">{scale}×</span><span className="text-xs text-muted-foreground">{scale === 1 ? "Original size" : scale < 1 ? "Half size" : `${scale} times larger`}</span>
                  {prefs.scale === scale && <Check className="ml-auto size-4" />}
                </DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="space-y-2">
            <span className="text-xs font-medium">File format</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" disabled={isSaving} aria-label="Export format" className="h-14 w-full justify-between rounded-xl border border-border px-3.5">
                  <span className="flex items-center gap-3 text-left"><ImageIcon className="size-4 text-muted-foreground" /><span className="grid gap-0.5"><span className="text-sm font-medium">{format.label}</span><span className="text-[11px] font-normal text-muted-foreground">{format.description}</span></span></span>
                  <ChevronDown className="size-4 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" sideOffset={6} className="z-[100] w-[var(--radix-dropdown-menu-trigger-width)] rounded-xl p-1.5">
                {FORMATS.map((item) => <DropdownMenuItem key={item.value} onSelect={() => onPrefsChange({ ...prefs, format: item.value })} className="cursor-pointer rounded-lg px-3 py-2.5">
                  <span className="grid gap-0.5"><span className="font-medium">{item.label}</span><span className="text-[11px] text-muted-foreground">{item.description}</span></span>
                  {prefs.format === item.value && <Check className="ml-auto size-4" />}
                </DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {prefs.format !== "png" && <div className="space-y-3 rounded-xl border border-border bg-background p-3.5">
            <div className="flex justify-between text-xs"><span className="font-medium">Quality</span><span className="text-muted-foreground tabular-nums">{prefs.quality}%</span></div>
            <Slider aria-label="Export quality" min={1} max={100} value={[prefs.quality]} disabled={isSaving} onValueChange={([quality]) => onPrefsChange({ ...prefs, quality })} />
          </div>}
        </div>

        {!isSaving && !tooLarge && frameSize && <p className="text-center text-xs text-muted-foreground">Estimated export: about {formatExportTime(estimateExportSeconds(frameSize.width, frameSize.height, prefs))}</p>}
        {isSaving && <ExportProgress stage={stage} format={format.label} prefs={prefs} frameSize={frameSize} estimate={estimate} />}
        {(error || tooLarge) && <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">{error || "This size exceeds 100 megapixels. Choose a smaller scale or crop the screenshot."}</p>}

        <DialogFooter className="border-t border-border pt-4 sm:flex-col sm:space-x-0 gap-3">
          <Button className="h-11 w-full gap-2" disabled={isSaving || tooLarge} onClick={onExport}>
            {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            {isSaving ? "Exporting…" : `Export ${format.label}`}
          </Button>
          <p className="text-center text-[10px] text-muted-foreground">{prefs.scale > 1 ? "Upscaling increases dimensions, not source detail." : "Your original screenshot stays unchanged."}</p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExportProgress({ stage, format, prefs, frameSize, estimate }: {
  stage: ExportStage; format: string; prefs: ExportPrefs;
  frameSize: ExportDialogProps["frameSize"]; estimate: ExportDialogProps["estimate"];
}) {
  const [now, setNow] = useState(Date.now);
  const [initial] = useState(() => ({ updatedAt: Date.now(), seconds: estimateExportSeconds(frameSize?.width ?? 1200, frameSize?.height ?? 800, prefs) }));
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const active = estimate ?? initial;
  const remaining = Math.ceil(active.seconds - Math.max(0, now - active.updatedAt) / 1000);
  const finishing = stage === "saving" || stage === "clipboard";
  const step = stage === "saving" || stage === "clipboard" ? 2 : stage === "encoding" ? 1 : 0;
  const labels: Record<ExportStage, string> = {
    rendering: "Rendering screenshot…", preparing: "Preparing image…", resizing: "Resizing image…", estimating: "Measuring encoding speed…",
    encoding: `Encoding ${format}…`, saving: "Saving file…", clipboard: "Copying to clipboard…",
  };
  return <div className="space-y-3 rounded-xl border border-border bg-background p-3.5">
    <div className="flex items-center justify-between gap-3 text-xs"><span role="status" className="flex items-center gap-2 font-medium"><Loader2 className="size-3.5 animate-spin" />{labels[stage]}</span><span className="shrink-0 tabular-nums text-muted-foreground">{finishing ? "Finishing…" : remaining > 0 ? `≈ ${formatExportTime(remaining)} left` : "Longer than estimated"}</span></div>
    <div className="flex gap-1.5" role="progressbar" aria-label="Export progress" aria-valuetext={labels[stage]}>
      {["Prepare", "Encode", "Save"].map((label, index) => <div key={label} className="flex-1 space-y-1.5">
        <div className={`h-1 rounded-full ${index < step ? "bg-primary" : index === step ? "bg-primary/60 animate-pulse" : "bg-secondary"}`} />
        <span className={`text-[10px] ${index <= step ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
      </div>)}
    </div>
    <p className="text-[10px] leading-relaxed text-muted-foreground">{remaining > 0 ? "Approximate time, updated from image size and encoding speed." : "Taking longer than estimated. The encoder is still working."}</p>
  </div>;
}
