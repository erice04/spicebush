import "./RangeSlider.css";

interface RangeSliderProps {
  label: string;
  min: number;
  max: number;
  value: { min: number; max: number };
  step?: number;
  unit?: string;
  digits?: number;
  onChange: (value: { min: number; max: number }) => void;
}

function formatValue(value: number, digits: number, unit: string): string {
  return `${value.toFixed(digits)}${unit ? ` ${unit}` : ""}`;
}

function toTrackInset(percent: number): string {
  return `calc(7px + (100% - 14px) * ${percent} / 100)`;
}

export default function RangeSlider({
  label,
  min,
  max,
  value,
  step = 0.1,
  unit = "",
  digits = 1,
  onChange,
}: RangeSliderProps) {
  const minPercent = max === min ? 0 : ((value.min - min) / (max - min)) * 100;
  const maxPercent = max === min ? 100 : ((value.max - min) / (max - min)) * 100;
  const minThumbOnTop = value.min > max - (max - min) / 2;

  const handleMinChange = (nextMin: number) => {
    onChange({ min: Math.min(nextMin, value.max), max: value.max });
  };

  const handleMaxChange = (nextMax: number) => {
    onChange({ min: value.min, max: Math.max(nextMax, value.min) });
  };

  return (
    <div className="range-slider">
      <div className="range-slider__header">
        <span className="range-slider__label">{label}</span>
        <span className="range-slider__values">
          {formatValue(value.min, digits, unit)} – {formatValue(value.max, digits, unit)}
        </span>
      </div>

      <div className="range-slider__track">
        <div className="range-slider__track-bg" />
        <div
          className="range-slider__track-fill"
          style={{
            left: toTrackInset(minPercent),
            right: toTrackInset(100 - maxPercent),
          }}
        />
        <input
          type="range"
          className="range-slider__thumb range-slider__thumb--min"
          style={{ zIndex: minThumbOnTop ? 5 : 3 }}
          min={min}
          max={max}
          step={step}
          value={value.min}
          onChange={(event) => handleMinChange(Number(event.target.value))}
          aria-label={`${label} minimum`}
        />
        <input
          type="range"
          className="range-slider__thumb range-slider__thumb--max"
          style={{ zIndex: minThumbOnTop ? 4 : 5 }}
          min={min}
          max={max}
          step={step}
          value={value.max}
          onChange={(event) => handleMaxChange(Number(event.target.value))}
          aria-label={`${label} maximum`}
        />
      </div>
    </div>
  );
}
