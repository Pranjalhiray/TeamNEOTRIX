import { create } from 'zustand';

interface UIState {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
}));

interface InvestigationState {
  selectedTxId: string | null;
  selectedWallet: string | null;
  setSelectedTxId: (txid: string | null) => void;
  setSelectedWallet: (address: string | null) => void;
}

export const useInvestigationStore = create<InvestigationState>((set) => ({
  selectedTxId: null,
  selectedWallet: null,
  setSelectedTxId: (txid) => set({ selectedTxId: txid }),
  setSelectedWallet: (address) => set({ selectedWallet: address }),
}));

interface AlertsState {
  filters: {
    topN: number;
    patternFilter: string[];
  };
  setTopN: (n: number) => void;
  setPatternFilter: (patterns: string[]) => void;
  togglePattern: (pattern: string) => void;
}

export const useAlertsStore = create<AlertsState>((set) => ({
  filters: {
    topN: 50,
    patternFilter: [],
  },
  setTopN: (n) => set((state) => ({ filters: { ...state.filters, topN: n } })),
  setPatternFilter: (patterns) => set((state) => ({ filters: { ...state.filters, patternFilter: patterns } })),
  togglePattern: (pattern) => set((state) => ({
    filters: {
      ...state.filters,
      patternFilter: state.filters.patternFilter.includes(pattern)
        ? state.filters.patternFilter.filter((p) => p !== pattern)
        : [...state.filters.patternFilter, pattern],
    },
  })),
}));

interface GraphState {
  highlightedNodes: Set<string>;
  setHighlightedNodes: (nodes: Set<string>) => void;
  toggleNodeHighlight: (nodeId: string) => void;
}

export const useGraphStore = create<GraphState>((set) => ({
  highlightedNodes: new Set(),
  setHighlightedNodes: (nodes) => set({ highlightedNodes: nodes }),
  toggleNodeHighlight: (nodeId) => set((state) => {
    const newSet = new Set(state.highlightedNodes);
    if (newSet.has(nodeId)) {
      newSet.delete(nodeId);
    } else {
      newSet.add(nodeId);
    }
    return { highlightedNodes: newSet };
  }),
}));