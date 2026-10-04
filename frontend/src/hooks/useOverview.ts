import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';

export function useOverviewStats() {
  return useQuery({
    queryKey: ['overview', 'stats'],
    queryFn: api.overview.getStats,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCorrelatedSample(limit = 15) {
  return useQuery({
    queryKey: ['overview', 'correlated-sample', limit],
    queryFn: () => api.overview.getCorrelatedSample(limit),
    staleTime: 5 * 60 * 1000,
  });
}

export function usePatternComposition() {
  return useQuery({
    queryKey: ['overview', 'pattern-composition'],
    queryFn: api.overview.getPatternComposition,
    staleTime: 5 * 60 * 1000,
  });
}

export function useIllicitVsLicit() {
  return useQuery({
    queryKey: ['overview', 'illicit-vs-licit'],
    queryFn: api.overview.getIllicitVsLicit,
    staleTime: 5 * 60 * 1000,
  });
}

export function useFocusAreas() {
  return useQuery({
    queryKey: ['overview', 'focus-areas'],
    queryFn: api.overview.getFocusAreas,
    staleTime: 5 * 60 * 1000,
  });
}