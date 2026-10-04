import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/Select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/Table';
import { ScrollArea } from '../components/ui/ScrollArea';
import { PageHeading } from '../components/layout/PageHeading';
import { useClusterMetrics, useClusterEmbeddings, useCluster, useClusterIds } from '../hooks/useClusters';
import { ClusterScatterPlot } from '../components/charts';
import { Network, Target, Search } from 'lucide-react';

export function Clusters() {
  const metricsQuery = useClusterMetrics();
  const embeddingsQuery = useClusterEmbeddings(4000);
  const clusterIdsQuery = useClusterIds();
  const metrics = metricsQuery.data;
  const embeddings = embeddingsQuery.data;
  const clusterIds = clusterIdsQuery.data;
  const [selectedCluster, setSelectedCluster] = useState<number | null>(null);
  const clusterQuery = useCluster(selectedCluster);
  const clusterData = clusterQuery.data;
  const serviceError = metricsQuery.error ?? embeddingsQuery.error ?? clusterIdsQuery.error;

  const metricCards = [
    { label: 'Embedding NMI', value: metrics?.embedding_nmi?.toFixed(3) || '—' },
    { label: 'Homogeneity', value: metrics?.embedding_homogeneity?.toFixed(3) || '—' },
    { label: 'Completeness', value: metrics?.embedding_completeness?.toFixed(3) || '—' },
    { label: 'V-Measure', value: metrics?.embedding_v_measure?.toFixed(3) || '—' },
  ];

  return (
    <div className="space-y-6 animate-in">
      <PageHeading eyebrow="Entity intelligence" title="Entity clustering" description="Explore address graph embeddings and inspect predicted wallet groups." />
      {serviceError && <div role="alert" className="workspace-error-banner"><Network size={17} /><span><strong>Some clustering data could not be loaded.</strong> {serviceError instanceof Error ? serviceError.message : 'Reconnect to the local analysis service and retry.'}</span><button type="button" className="workspace-retry-link" onClick={() => void Promise.all([metricsQuery.refetch(), embeddingsQuery.refetch(), clusterIdsQuery.refetch()])}>Retry</button></div>}

      <div className="grid gap-4 grid-dashboard">
        {metricCards.map((metric, index) => (
          <Card key={metric.label} className={`metric-card-accent hover-lift stagger-${index + 1}`}>
            <CardContent className="pt-6">
              <p className="text-label-md text-[var(--color-text-muted)]">{metric.label}</p>
              <p className="text-display-sm font-bold text-[var(--color-text-primary)] mt-1">{metric.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="card-hover">
        <CardHeader className="border-b border-[var(--color-border)]">
          <CardTitle className="text-headline-sm flex items-center gap-2">
            <Network className="h-5 w-5" />
            Methodology
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-start gap-4 p-4 bg-[var(--color-background)] border border-[var(--color-border)] rounded-xl">
              <div className="w-10 h-10 rounded-xl bg-[var(--color-accent-subtle)] flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-bold text-[var(--color-accent)]">1</span>
              </div>
              <div>
                <p className="font-medium text-[var(--color-text-primary)]">Union-Find (Common-Input Clustering)</p>
                <p className="text-body-sm text-[var(--color-text-muted)] mt-1">Addresses that co-spend in the same non-mixing transaction are merged into clusters using Union-Find data structure.</p>
              </div>
            </div>
            <div className="flex items-start gap-4 p-4 bg-[var(--color-background)] border border-[var(--color-border)] rounded-xl">
              <div className="w-10 h-10 rounded-xl bg-[var(--color-accent-subtle)] flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-bold text-[var(--color-accent)]">2</span>
              </div>
              <div>
                <p className="font-medium text-[var(--color-text-primary)]">Graph Embedding (TruncatedSVD)</p>
                <p className="text-body-sm text-[var(--color-text-muted)] mt-1">Each address is embedded from its transaction graph adjacency matrix using TruncatedSVD (32 components) for dimensionality reduction.</p>
              </div>
            </div>
            <div className="flex items-start gap-4 p-4 bg-[var(--color-background)] border border-[var(--color-border)] rounded-xl">
              <div className="w-10 h-10 rounded-xl bg-[var(--color-accent-subtle)] flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-bold text-[var(--color-accent)]">3</span>
              </div>
              <div>
                <p className="font-medium text-[var(--color-text-primary)]">K-Means Clustering</p>
                <p className="text-body-sm text-[var(--color-text-muted)] mt-1">MiniBatchKMeans with 500 clusters on normalized embeddings, combined with Union-Find results for final entity predictions.</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="card-hover">
        <CardHeader className="border-b border-[var(--color-border)]">
          <CardTitle className="text-headline-sm flex items-center gap-2">
            <Target className="h-5 w-5" />
            Address Graph-Embedding Space (PCA Projection)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {embeddingsQuery.isLoading ? <div className="model-loading-state"><span className="loading-mark" />Loading wallet embeddings</div> : embeddings?.length ? <ClusterScatterPlot data={selectedCluster !== null && clusterData?.length ? clusterData : embeddings} selectedCluster={selectedCluster} height={420} /> : <div className="data-empty-state"><Network size={21} /><strong>Embedding data is unavailable</strong><span>Reconnect to the local analysis service and retry this view.</span></div>}
          {selectedCluster !== null && <button type="button" className="mt-2 text-xs text-[var(--color-accent)] hover:underline" onClick={() => setSelectedCluster(null)}>Show all wallet clusters</button>}
          <p className="text-body-sm text-[var(--color-text-muted)] mt-3">
            Each point is a wallet projected from its graph embedding. Colors show the known synthetic entity class; hover a point to inspect its address and predicted cluster.
          </p>
        </CardContent>
      </Card>

      <Card className="card-hover">
        <CardHeader className="border-b border-[var(--color-border)] flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <CardTitle className="text-headline-sm flex items-center gap-2">
            <Search className="h-5 w-5" />
            Inspect a Predicted Cluster
          </CardTitle>
          <Select
            value={selectedCluster?.toString() || ''}
            onValueChange={(value) => setSelectedCluster(value ? parseInt(value) : null)}
          >
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Select cluster" />
            </SelectTrigger>
            <SelectContent>
              {clusterIds?.slice(0, 50).map((id) => (
                <SelectItem key={id} value={id.toString()}>
                  Cluster {id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {selectedCluster !== null && clusterData && (
            <>
              <div className="mb-4 flex items-center gap-4 p-4 bg-[var(--color-background)] border border-[var(--color-border)] rounded-xl">
                <div className="w-12 h-12 rounded-xl bg-[var(--color-accent-subtle)] flex items-center justify-center">
                  <span className="text-xl font-bold text-[var(--color-accent)]">{selectedCluster}</span>
                </div>
                <div>
                  <p className="font-medium text-[var(--color-text-primary)]">Cluster {selectedCluster}</p>
                  <p className="text-body-sm text-[var(--color-text-muted)]">{clusterData.length} addresses</p>
                </div>
              </div>
              <ScrollArea className="h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Address</TableHead>
                      <TableHead>Entity Type</TableHead>
                      <TableHead>Is Illicit</TableHead>
                      <TableHead>True Entity</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clusterData.map((wallet, _i) => (
                      <TableRow key={wallet.address.slice(0, 16)}>
                        <TableCell className="font-mono text-xs">{wallet.address.slice(0, 16)}...</TableCell>
                        <TableCell>{wallet.entity_type}</TableCell>
                        <TableCell>
                          {wallet.is_illicit === null || wallet.is_illicit === undefined ? (
                            <Badge variant="secondary">UNKNOWN</Badge>
                          ) : wallet.is_illicit ? (
                            <Badge variant="risk-high">YES</Badge>
                          ) : (
                            <Badge variant="risk-low">NO</Badge>
                          )}
                        </TableCell>
                        <TableCell>{wallet.true_entity}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </>
          )}
          {selectedCluster !== null && clusterQuery.isLoading && <div className="model-loading-state"><span className="loading-mark" />Loading cluster members</div>}
          {selectedCluster !== null && clusterQuery.error && <div role="alert" className="data-empty-state data-empty-error"><Network size={21} /><strong>Cluster members could not be loaded</strong><span>{clusterQuery.error instanceof Error ? clusterQuery.error.message : 'Retry the local analysis service.'}</span><button type="button" className="workspace-retry-link" onClick={() => void clusterQuery.refetch()}>Retry</button></div>}
          {selectedCluster === null && (
            <div className="text-center py-12">
              <Search className="h-12 w-12 text-[var(--color-border)] mx-auto mb-4" />
              <p className="text-body-md text-[var(--color-text-muted)]">Select a cluster to inspect its members</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
