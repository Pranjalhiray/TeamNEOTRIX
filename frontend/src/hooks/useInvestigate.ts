import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';

export function useTransaction(txid: string | null) {
  return useQuery({
    queryKey: ['investigate', 'transaction', txid],
    queryFn: () => api.investigate.getTransaction(txid!),
    enabled: !!txid,
    staleTime: 5 * 60 * 1000,
  });
}

export function useWallet(address: string | null) {
  return useQuery({
    queryKey: ['investigate', 'wallet', address],
    queryFn: () => api.investigate.getWallet(address!),
    enabled: !!address,
    staleTime: 5 * 60 * 1000,
  });
}

export function useTransactionGraph(txid: string | null) {
  return useQuery({
    queryKey: ['investigate', 'transaction-graph', txid],
    queryFn: () => api.investigate.getTransactionGraph(txid!),
    enabled: !!txid,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSHAPExplanation(txid: string | null) {
  return useQuery({
    queryKey: ['investigate', 'shap', txid],
    queryFn: () => api.investigate.getSHAPExplanation(txid!),
    enabled: !!txid,
    staleTime: 5 * 60 * 1000,
  });
}