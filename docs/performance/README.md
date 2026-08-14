# Performance Documentation

Production indexes require recorded benchmark evidence at representative scale.
A valid result may reject a candidate or conclude that no new index is needed.

- [Catalog index baseline and decisions](catalog-index-baseline.md)
- [Benchmark runner and safety requirements](../../benchmarks/catalog/README.md)
- [Production rollout and rollback procedures](../production-deployment-runbook.md)

## Rules

- Benchmark only against the disposable benchmark database, never against development, test, or production data.
- Do not turn a benchmark candidate into a production migration without separate evidence and operational review.
