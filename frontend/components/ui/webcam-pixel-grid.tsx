"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

type WebcamPixelGridProps = {
  gridCols?: number;
  gridRows?: number;
  maxElevation?: number;
  elevationSmoothing?: number;
  gapRatio?: number;
  className?: string;
};

type GridCell = {
  tone: number;
  accent: boolean;
  notch: boolean;
  depth: number;
};

const NO_POINTER = Number.NEGATIVE_INFINITY;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function hashNoise(row: number, col: number) {
  const value = Math.sin((row + 1) * 12.9898 + (col + 1) * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function parseHex(hex: string) {
  const normalized = hex.trim().replace("#", "");
  const value = normalized.length === 3
    ? normalized.split("").map((digit) => digit + digit).join("")
    : normalized;

  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function rgbString(hex: string, alpha = 1) {
  const { r, g, b } = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function WebcamPixelGrid({
  gridCols = 28,
  gridRows = 18,
  maxElevation = 10,
  elevationSmoothing = 0.065,
  gapRatio = 0.12,
  className,
}: WebcamPixelGridProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const pointerRef = useRef({ x: NO_POINTER, y: NO_POINTER });
  const cellsRef = useRef<GridCell[][]>([]);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    cellsRef.current = Array.from({ length: gridRows }, (_, row) =>
      Array.from({ length: gridCols }, (_, col) => {
        const noise = hashNoise(row, col);
        const stripe = (row + col) % 7 === 0;
        const accent = (col % 9 === 0 && row % 3 === 0) || (row === Math.floor(gridRows * 0.55) && col % 4 === 0);

        return {
          tone: stripe || noise > 0.72 ? 246 : noise > 0.43 ? 44 : 12,
          accent,
          notch: noise > 0.83 || (row % 4 === 0 && col % 6 === 0),
          depth: 0,
        };
      }),
    );
  }, [gridCols, gridRows]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => {
      reducedMotionRef.current = mediaQuery.matches;
    };

    syncPreference();
    mediaQuery.addEventListener("change", syncPreference);

    return () => {
      mediaQuery.removeEventListener("change", syncPreference);
    };
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    const canvas = canvasRef.current;
    if (!frame || !canvas) {
      return;
    }

    let active = true;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const readTheme = () => {
      const styles = getComputedStyle(document.documentElement);

      return {
        background: styles.getPropertyValue("--aw-landing-grid-dark").trim() || "#040506",
        baseLight: styles.getPropertyValue("--aw-landing-grid-light").trim() || "#f3f3ed",
        accent: styles.getPropertyValue("--aw-landing-grid-accent").trim() || "#6dd3c3",
      };
    };

    const resize = () => {
      const { width, height } = frame.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    };

    const render = () => {
      if (!active) {
        return;
      }

      const { width, height } = frame.getBoundingClientRect();
      if (width === 0 || height === 0) {
        animationRef.current = window.requestAnimationFrame(render);
        return;
      }

      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        resize();
      }

      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      const theme = readTheme();
      const cellWidth = width / gridCols;
      const cellHeight = height / gridRows;
      const cellSize = Math.max(cellWidth, cellHeight);
      const gap = cellSize * gapRatio;
      const inset = gap / 2;
      const coverWidth = cellSize * gridCols;
      const coverHeight = cellSize * gridRows;
      const offsetX = (width - coverWidth) / 2;
      const offsetY = (height - coverHeight) / 2;
      const hoverRadius = Math.min(width, height) * 0.28;
      const hasPointer = pointerRef.current.x !== NO_POINTER && pointerRef.current.y !== NO_POINTER && !reducedMotionRef.current;

      context.clearRect(0, 0, width, height);
      context.fillStyle = theme.background;
      context.fillRect(0, 0, width, height);

      for (let row = 0; row < gridRows; row += 1) {
        for (let col = 0; col < gridCols; col += 1) {
          const cell = cellsRef.current[row]?.[col];
          if (!cell) {
            continue;
          }

          const x = offsetX + col * cellSize;
          const y = offsetY + row * cellSize;
          const centerX = x + cellSize / 2;
          const centerY = y + cellSize / 2;

          let targetDepth = 0;
          if (hasPointer) {
            const distance = Math.hypot(pointerRef.current.x - centerX, pointerRef.current.y - centerY);
            const influence = clamp(1 - distance / hoverRadius, 0, 1);
            targetDepth = influence * maxElevation * (cell.accent ? 1.08 : 1);
          }

          cell.depth += (targetDepth - cell.depth) * elevationSmoothing;

          const pressX = cell.depth * 0.36;
          const pressY = cell.depth * 0.88;
          const faceX = x + inset + pressX;
          const faceY = y + inset + pressY;
          const faceSize = cellSize - gap;

          if (cell.depth > 0.08) {
            context.beginPath();
            context.moveTo(x + inset, y + inset);
            context.lineTo(x + cellSize - inset, y + inset);
            context.lineTo(faceX + faceSize, faceY);
            context.lineTo(faceX, faceY);
            context.closePath();
            context.fillStyle = cell.accent ? rgbString(theme.accent, 0.2) : "rgba(255,255,255,0.08)";
            context.fill();

            context.beginPath();
            context.moveTo(x + inset, y + inset);
            context.lineTo(faceX, faceY);
            context.lineTo(faceX, faceY + faceSize);
            context.lineTo(x + inset, y + cellSize - inset);
            context.closePath();
            context.fillStyle = cell.accent ? "rgba(4, 8, 9, 0.64)" : "rgba(4, 8, 9, 0.46)";
            context.fill();
          }

          const lightBias = cell.accent ? 0.9 : 1;
          const shade = clamp(cell.tone - cell.depth * 9 * lightBias, 0, 255);

          if (cell.accent) {
            context.fillStyle = rgbString(theme.accent, 0.94);
          } else {
            context.fillStyle = `rgb(${shade}, ${shade}, ${shade})`;
          }

          context.fillRect(faceX, faceY, faceSize, faceSize);

          context.strokeStyle = cell.accent
            ? rgbString(theme.accent, 0.9)
            : `rgba(255, 255, 255, ${cell.tone > 200 ? 0.22 : 0.08})`;
          context.lineWidth = 0.8;
          context.strokeRect(faceX, faceY, faceSize, faceSize);

          if (cell.notch && !cell.accent) {
            context.fillStyle = cell.tone > 200 ? "rgba(0,0,0,0.42)" : "rgba(255,255,255,0.08)";
            context.fillRect(faceX + faceSize * 0.2, faceY + faceSize * 0.2, faceSize * 0.2, faceSize * 0.2);
          }
        }
      }

      animationRef.current = window.requestAnimationFrame(render);
    };

    resize();
    render();

    const observer = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => resize())
      : null;

    observer?.observe(frame);

    return () => {
      active = false;
      observer?.disconnect();
      window.cancelAnimationFrame(animationRef.current);
    };
  }, [elevationSmoothing, gapRatio, gridCols, gridRows, maxElevation]);

  return (
    <div
      ref={frameRef}
      className={cn("relative h-full w-full overflow-hidden rounded-[inherit]", className)}
      onPointerLeave={() => {
        pointerRef.current = { x: NO_POINTER, y: NO_POINTER };
      }}
      onPointerMove={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        pointerRef.current = {
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        };
      }}
    >
      <canvas ref={canvasRef} aria-hidden className="h-full w-full" />
    </div>
  );
}

export default WebcamPixelGrid;
