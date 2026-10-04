import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';

export function useClusterMetrics() {
  return useQuery({
    queryKey: ['clusters', 'metrics'],
    queryFn: api.clusters.getMetrics,
    staleTime: 5 * 60 * 1000,
  });
}

export function useClusterEmbeddings(sample = 4000) {
  return useQuery({
    queryKey: ['clusters', 'embeddings', sample],
    queryFn: () => api.clusters.getEmbeddings(sample),
    staleTime: 5 * 60 * 1000,
  });
}

export function useCluster(clusterId: number | null) {
  return useQuery({
    queryKey: ['clusters', 'cluster', clusterId],
    queryFn: () => api.clusters.getCluster(clusterId!),
    enabled: clusterId !== null,
    staleTime: 5 * 60 * 1000,
  });
}

export function useClusterIds() {
  return useQuery({
    queryKey: ['clusters', 'ids'],
    queryFn: api.clusters.getClusterIds,
    staleTime: 5 * 60 * 1000,
  });
}