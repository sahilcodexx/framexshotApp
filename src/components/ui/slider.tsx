import * as React from "react";
import { cn } from "@/lib/utils";

export interface SliderProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
  value?: number[];
  onValueChange?: (value: number[]) => void;
  onValueCommit?: (value: number[]) => void;
}

const SliderComponent = React.forwardRef<HTMLInputElement, SliderProps>(
  ({ className, value = [0], onValueChange, onValueCommit, min = 0, max = 100, step = 1, ...props }, ref) => {
    const valueRef = React.useRef(value[0]);
    const isDraggingRef = React.useRef(false);
    
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = Number(e.target.value);
      valueRef.current = newValue;
      onValueChange?.([newValue]);
    };

    const handlePointerDown = () => {
      isDraggingRef.current = true;
    };

    const handlePointerUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        onValueCommit?.([valueRef.current]);
      }
    };

    const handleKeyUp = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
        onValueCommit?.([valueRef.current]);
      }
    };

    React.useEffect(() => {
      valueRef.current = value[0] ?? 0;
    }, [value]);

    const minNum = Number(min);
    const maxNum = Number(max);
    const valueNum = Number(value[0] ?? 0);
    const percentage = ((valueNum - minNum) / (maxNum - minNum)) * 100;

    return (
      <div className="relative w-full">
        <input
          type="range"
          className={cn(
            "w-full h-1 bg-secondary rounded-full appearance-none cursor-pointer",
            "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-none [&::-webkit-slider-thumb]:border-0",
            "[&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-foreground [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:shadow-none [&::-moz-range-thumb]:border-0",
            className
          )}
          style={{
            background: `linear-gradient(to right, var(--color-foreground) ${percentage}%, var(--color-secondary) ${percentage}%)`,
          }}
          ref={ref}
          value={valueNum}
          onChange={handleChange}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onKeyUp={handleKeyUp}
          min={minNum}
          max={maxNum}
          step={step}
          {...props}
        />
      </div>
    );
  }
);
const Slider = React.memo(SliderComponent);
Slider.displayName = "Slider";

export { Slider };
