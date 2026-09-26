import { create } from "zustand";

export type ChamberView = "overview" | "graph" | "compare" | "library";

export type HeatHover = { day: number; hour: number; value: number } | null;

type PulseState = {
  view: ChamberView;
  focusId: string | null;
  hover: HeatHover;
  setView: (view: ChamberView) => void;
  setFocus: (focusId: string | null) => void;
  setHover: (hover: HeatHover) => void;
  reset: () => void;
};

export const usePulseStore = create<PulseState>((set) => ({
  view: "overview",
  focusId: null,
  hover: null,
  setView: (view) => set({ view }),
  setFocus: (focusId) => set({ focusId }),
  setHover: (hover) => set({ hover }),
  reset: () => set({ view: "overview", focusId: null, hover: null }),
}));
