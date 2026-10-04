import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';

export function useLinkAnalysis(topK = 60) {
  return useQuery({
    queryKey: ['graph', 'link-analysis', topK],
    queryFn: () => api.graph.getLinkAnalysis(topK),
    staleTime: 5 * 60 * 1000,
  });
}