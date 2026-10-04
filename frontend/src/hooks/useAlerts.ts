import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';
import { useAlertsStore } from '../store/useStore';
import type { Alert, PaginatedResponse } from '../types';

export function useRankedAlerts() {
  const { filters } = useAlertsStore();

  return useQuery<PaginatedResponse<Alert>>({
    queryKey: ['alerts', 'ranked', filters],
    queryFn: () => api.alerts.getRanked({ top_n: filters.topN, pattern_filter: filters.patternFilter }),
    staleTime: 2 * 60 * 1000,
  });
}

export function useDownloadAlerts() {
  const { filters } = useAlertsStore();

  return async () => {
    const response = await api.alerts.downloadCSV({ top_n: filters.topN, pattern_filter: filters.patternFilter });
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ranked_alerts.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };
}