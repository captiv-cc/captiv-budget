// ════════════════════════════════════════════════════════════════════════════
// queryClient — instance React Query partagée
// ════════════════════════════════════════════════════════════════════════════

import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 30s : éviter les refetch trop agressifs dans un festival
      staleTime: 30 * 1000,
      gcTime: 5 * 60 * 1000,
      retry: 2,
      refetchOnWindowFocus: false, // pas pertinent en RN
    },
  },
})
