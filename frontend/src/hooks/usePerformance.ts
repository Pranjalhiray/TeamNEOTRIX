import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';

export function useAnomalyMetrics() {
  return useQuery({
    queryKey: ['performance', 'anomaly'],
    queryFn: api.performance.getAnomalyMetrics,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSupervisedAnomalyMetrics() {
  return useQuery({
    queryKey: ['performance', 'anomaly-supervised'],
    queryFn: api.performance.getSupervisedAnomalyMetrics,
    staleTime: 5 * 60 * 1000,
  });
}

export function usePatternMetrics() {
  return useQuery({
    queryKey: ['performance', 'pattern'],
    queryFn: api.performance.getPatternMetrics,
    staleTime: 5 * 60 * 1000,
  });
}

export function useRiskMetrics() {
  return useQuery({
    queryKey: ['performance', 'risk'],
    queryFn: api.performance.getRiskMetrics,
    staleTime: 5 * 60 * 1000,
  });
}

export function useEnsembleAUC() {
  return useQuery({
    queryKey: ['performance', 'ensemble'],
    queryFn: api.performance.getEnsembleAUC,
    staleTime: 5 * 60 * 1000,
  });
}

export function useRiskDistribution() {
  return useQuery({
    queryKey: ['performance', 'risk-distribution'],
    queryFn: api.performance.getRiskDistribution,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSHAPGlobal() {
  return useQuery({
    queryKey: ['performance', 'shap-global'],
    queryFn: api.performance.getSHAPGlobal,
    staleTime: 5 * 60 * 1000,
  });
}